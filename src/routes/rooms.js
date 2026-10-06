const express = require('express');
const { pool } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');
const { listRoomObjects } = require('../services/roomObjects');

const router = express.Router();
router.use(authenticateToken);

router.get('/', async (_req, res) => {
  if (process.env.APP_MODE === 'rooms') return res.json({ success: true, rooms: [] });
  try {
    const { rows } = await pool.query(`
      SELECT id, slug, name, capacity, spawn_position, seating_mode
      FROM rooms WHERE status = 'open' ORDER BY name, id
    `);
    res.json({ success: true, rooms: rows });
  } catch (error) {
    console.error('[rooms] list:', error);
    res.status(500).json({ success: false, code: 'ROOM_LIST_ERROR' });
  }
});

async function findAccessibleRoom(slug, userId, characterId) {
  const { rows } = await pool.query(`
    SELECT id, slug, name, capacity, spawn_position, status, allow_rejoin, seating_mode
    FROM rooms WHERE slug = $1 AND status IN ('open', 'closed')
  `, [slug]);
  const room = rows[0];
  if (!room || room.status === 'open') return room;
  if (!room.allow_rejoin) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(characterId || '')) {
    return null;
  }
  const { hasPersistentRoomReturnAccess } = require('../websocket/wsServer');
  if (!(await hasPersistentRoomReturnAccess(room.id, characterId))) return null;
  const owned = await pool.query(`
    SELECT last_position, last_room_id FROM characters WHERE id = $1 AND user_id = $2
  `,
    [characterId, userId]);
  if (!owned.rows.length) return null;
  const position = owned.rows[0].last_position;
  if (owned.rows[0].last_room_id === room.id && position &&
      ['x', 'y', 'z'].every(axis => typeof position[axis] === 'number' &&
        Number.isFinite(position[axis]) && Math.abs(position[axis]) <= 10000)) {
    room.resume_position = position;
  }
  return room;
}

router.get('/:slug', async (req, res) => {
  try {
    const room = await findAccessibleRoom(req.params.slug, req.user.userId, req.query.characterId);
    if (!room) return res.status(404).json({ success: false, code: 'ROOM_NOT_FOUND' });
    res.json({ success: true, room });
  } catch (error) {
    console.error('[rooms] get:', error);
    res.status(500).json({ success: false, code: 'ROOM_ERROR' });
  }
});

router.get('/:slug/objects', async (req, res) => {
  try {
    const room = await findAccessibleRoom(req.params.slug, req.user.userId, req.query.characterId);
    if (!room) return res.status(404).json({ success: false, code: 'ROOM_NOT_FOUND' });
    const objects = await listRoomObjects(room.id);
    res.json({ success: true, objects });
  } catch (error) {
    console.error('[rooms] objects:', error);
    res.status(500).json({ success: false, code: 'ROOM_OBJECTS_ERROR' });
  }
});

module.exports = router;
