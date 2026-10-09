const express = require('express');
const { pool } = require('../database/db');
const { authenticateAdminToken, logAdminAction } = require('../middleware/adminAuth');
const { listRoomObjects } = require('../services/roomObjects');
const { validateRoom } = require('../services/roomValidation');
const { MAIN_ROOM_ID } = require('../services/roomScope');

const router = express.Router();
router.use(authenticateAdminToken);
require('./adminRoomSeats').registerRoomSeatRoutes(router, pool, logAdminAction);
require('./adminRoomTemplates').registerRoomTemplateRoutes(router, pool, logAdminAction);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$/;

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, code, error: message });
}

const { validLayout, populateRoom } = require('../services/roomCreation');

function validTransform(body) {
  const axes = ['position_x', 'position_y', 'position_z',
    'rotation_x', 'rotation_y', 'rotation_z', 'scale_x', 'scale_y', 'scale_z'];
  return axes.every(axis => typeof body[axis] === 'number' &&
    Number.isFinite(body[axis]) &&
    (axis.startsWith('scale_') ? body[axis] >= 0.01 && body[axis] <= 100 :
      Math.abs(body[axis]) <= 10000));
}

function validObjectId(value) {
  const number = Number(value);
  return /^\d+$/.test(String(value)) && Number.isSafeInteger(number) && number > 0;
}

router.get('/templates', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT ON (template_key) id, template_key, version, name,
        jsonb_array_length(layout) AS object_count
      FROM room_templates ORDER BY template_key, version DESC
    `);
    res.json({ success: true, templates: rows });
  } catch (error) {
    console.error('[adminRooms] templates:', error);
    fail(res, 500, 'ROOM_TEMPLATES_ERROR', 'Не удалось загрузить шаблоны');
  }
});

router.get('/models', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, COALESCE(NULLIF(display_name, ''), file_name) AS name, path, file_type
      FROM uploaded_models
      WHERE lower(file_type) = 'glb'
      ORDER BY created_at DESC, id DESC
    `);
    res.json({ success: true, models: rows });
  } catch (error) {
    console.error('[adminRooms] models:', error);
    fail(res, 500, 'ROOM_MODELS_ERROR', 'Не удалось загрузить модели');
  }
});

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT r.*, u.username AS owner_name, count(o.id)::int AS object_count
      FROM rooms r LEFT JOIN users u ON u.id=r.owner_user_id
      LEFT JOIN world_objects o ON o.room_id = r.id
      WHERE r.deleted_at IS NULL AND ($1::boolean = false OR r.slug <> 'main')
      GROUP BY r.id, u.username ORDER BY r.created_at DESC
    `, [process.env.APP_MODE === 'rooms']);
    res.json({ success: true, rooms: rows });
  } catch (error) {
    console.error('[adminRooms] list:', error);
    fail(res, 500, 'ROOM_LIST_ERROR', 'Не удалось загрузить комнаты');
  }
});

router.get('/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return fail(res, 400, 'INVALID_ROOM_ID', 'Неверный ID комнаты');
  try {
    const { rows } = await pool.query('SELECT * FROM rooms WHERE id = $1', [req.params.id]);
    if (!rows.length) return fail(res, 404, 'ROOM_NOT_FOUND', 'Комната не найдена');
    res.json({ success: true, room: rows[0] });
  } catch (error) {
    console.error('[adminRooms] get:', error);
    fail(res, 500, 'ROOM_GET_ERROR', 'Не удалось загрузить комнату');
  }
});

router.get('/:id/objects', async (req, res) => {
  if (!UUID.test(req.params.id)) return fail(res, 400, 'INVALID_ROOM_ID', 'Неверный ID комнаты');
  try {
    const room = await pool.query('SELECT id FROM rooms WHERE id = $1', [req.params.id]);
    if (!room.rows.length) return fail(res, 404, 'ROOM_NOT_FOUND', 'Комната не найдена');
    res.json({ success: true, objects: await listRoomObjects(req.params.id) });
  } catch (error) {
    console.error('[adminRooms] objects:', error);
    fail(res, 500, 'ROOM_OBJECTS_ERROR', 'Не удалось загрузить обстановку');
  }
});

require('./adminRoomEnvelope').registerRoomEnvelopeRoutes(router,pool,logAdminAction);

// Room editing is intentionally separate from the legacy /api/world editor.
// The room ID and draft status are part of every mutation's SQL condition.
router.post('/:id/objects', async (req, res) => {
  if (!UUID.test(req.params.id)) return fail(res, 400, 'INVALID_ROOM_ID', 'Неверный ID комнаты');
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!Number.isSafeInteger(body.model_id) || body.model_id < 1 ||
      !name || name.length > 120 || !validTransform(body) ||
      typeof body.has_collision !== 'boolean') {
    return fail(res, 400, 'INVALID_OBJECT', 'Проверьте модель, название и положение');
  }
  try {
    const result = await pool.query(`
      INSERT INTO world_objects
        (room_id, type, name, model_path, model_type,
         position_x, position_y, position_z, rotation_x, rotation_y, rotation_z,
         scale_x, scale_y, scale_z, has_collision, created_at, updated_at)
      SELECT r.id, 'uploaded_model', $3, m.path,
        CASE WHEN lower(m.file_type) IN ('glb', 'gltf') THEN 'gltf' ELSE 'obj' END,
        $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now(), now()
      FROM rooms r JOIN uploaded_models m ON m.id = $2
      WHERE r.id = $1 AND r.status = 'draft'
      FOR UPDATE OF r FOR SHARE OF m
      RETURNING *
    `, [req.params.id, body.model_id, name,
      body.position_x, body.position_y, body.position_z,
      body.rotation_x, body.rotation_y, body.rotation_z,
      body.scale_x, body.scale_y, body.scale_z, body.has_collision]);
    if (!result.rows.length) return fail(res, 404, 'ROOM_OR_MODEL_NOT_FOUND',
      'Черновик или модель не найдены');
    logAdminAction(req.adminUser.id, 'ADD_ROOM_OBJECT', 'world_objects', result.rows[0].id,
      `Room ${req.params.id}`, req.ip).catch(error => console.error('[adminRooms] audit:', error));
    res.status(201).json({ success: true, object: result.rows[0] });
  } catch (error) {
    console.error('[adminRooms] add object:', error);
    fail(res, 500, 'ROOM_OBJECT_CREATE_ERROR', 'Не удалось добавить предмет');
  }
});

router.patch('/:id/objects/:objectId', async (req, res) => {
  if (!UUID.test(req.params.id) || !validObjectId(req.params.objectId)) {
    return fail(res, 400, 'INVALID_OBJECT_ID', 'Неверный ID комнаты или предмета');
  }
  const body = req.body || {};
  if (!validTransform(body) || typeof body.has_collision !== 'boolean') {
    return fail(res, 400, 'INVALID_OBJECT', 'Проверьте положение, размер и столкновения');
  }
  try {
    const result = await pool.query(`
      UPDATE world_objects SET position_x = $3, position_y = $4, position_z = $5,
        rotation_x = $6, rotation_y = $7, rotation_z = $8,
        scale_x = $9, scale_y = $10, scale_z = $11,
        has_collision = $12, updated_at = now()
      WHERE id = $2 AND room_id = $1
        AND room_environment IS NULL
        AND NOT EXISTS (SELECT 1 FROM geometry_buildings g WHERE world_objects.model_path='geometry_building:'||g.id::text AND g.template_id='room_room')
        AND EXISTS (SELECT 1 FROM rooms WHERE id = $1 AND status = 'draft' FOR UPDATE)
      RETURNING *
    `, [req.params.id, Number(req.params.objectId),
      body.position_x, body.position_y, body.position_z,
      body.rotation_x, body.rotation_y, body.rotation_z,
      body.scale_x, body.scale_y, body.scale_z, body.has_collision]);
    if (!result.rows.length) return fail(res, 404, 'ROOM_OBJECT_NOT_FOUND',
      'Предмет не найден в черновике');
    logAdminAction(req.adminUser.id, 'UPDATE_ROOM_OBJECT', 'world_objects', result.rows[0].id,
      `Room ${req.params.id}`, req.ip).catch(error => console.error('[adminRooms] audit:', error));
    res.json({ success: true, object: result.rows[0] });
  } catch (error) {
    console.error('[adminRooms] update object:', error);
    fail(res, 500, 'ROOM_OBJECT_UPDATE_ERROR', 'Не удалось изменить предмет');
  }
});

const objectSeats = require('../services/roomObjectSeats').createRoomObjectSeats(pool);
function objectSeatAction(operation) {
  return async (req,res) => {
    if (!UUID.test(req.params.id) || !validObjectId(req.params.objectId)) return fail(res,400,'INVALID_OBJECT_ID','Неверный предмет');
    try {
      const result=await objectSeats.mutate(req.params.id,Number(req.params.objectId),operation,req.body?.seats);
      logAdminAction(req.adminUser.id,operation==='copy'?'COPY_ROOM_OBJECT':'DELETE_ROOM_OBJECT','world_objects',Number(req.params.objectId),`Room ${req.params.id}`,req.ip).catch(()=>{});
      res.json({success:true,...result});
    } catch(error) {
      if(!error.status)console.error('[adminRooms] object seats:',error);
      fail(res,error.status||500,error.status?error.message:'ROOM_OBJECT_UPDATE_ERROR',error.status?error.message:'Не удалось изменить предмет');
    }
  };
}
router.delete('/:id/objects/:objectId',objectSeatAction('delete'));
router.post('/:id/objects/:objectId/copy',objectSeatAction('copy'));

router.post('/:id/validate', async (req, res) => {
  if (!UUID.test(req.params.id)) return fail(res, 400, 'INVALID_ROOM_ID', 'Неверный ID комнаты');
  try {
    const room = await pool.query('SELECT status FROM rooms WHERE id = $1', [req.params.id]);
    if (!room.rows.length) return fail(res, 404, 'ROOM_NOT_FOUND', 'Комната не найдена');
    res.json({ success: true, validation: await validateRoom(req.params.id, pool) });
  } catch (error) {
    console.error('[adminRooms] validate:', error);
    fail(res, 500, 'ROOM_VALIDATE_ERROR', 'Не удалось проверить комнату');
  }
});

// Both actor types use the same transaction, queue and seat cleanup.
const lifecycle = require('../services/userRoomLifecycle').createUserRoomLifecycle(pool,
  () => require('../websocket/wsServer'), validateRoom);
function lifecycleAction(action) {
  return async (req, res) => {
    try {
      const result = await lifecycle.mutateAsAdmin(req.adminUser.id, req.params.id, action, req.body);
      logAdminAction(req.adminUser.id, action.toUpperCase() + '_ROOM', 'rooms', req.params.id,
        `Room revision ${result.room.revision}`, req.ip).catch(error => console.error('[adminRooms] audit:', error));
      res.json({ success: true, ...result });
    } catch (error) {
      if (!error.status) console.error('[adminRooms] lifecycle:', error);
      fail(res, error.status || 500, error.status ? error.code : 'ROOM_UPDATE_ERROR',
        error.status ? error.code : 'Не удалось изменить комнату');
    }
  };
}
for (const action of ['open', 'close', 'end']) router.post('/:id/' + action, lifecycleAction(action));
router.delete('/:id', lifecycleAction('delete'));

router.patch('/:id', async (req, res) => {
  if (!UUID.test(req.params.id)) return fail(res, 400, 'INVALID_ROOM_ID', 'Неверный ID комнаты');
  const { name, capacity, spawn_position: spawn, revision } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 ||
      !Number.isInteger(capacity) || capacity < 1 || capacity > 100 ||
      !Number.isInteger(revision) || revision < 1 ||
      !spawn || typeof spawn !== 'object' ||
      !['x', 'y', 'z'].every(axis => typeof spawn[axis] === 'number' &&
        Number.isFinite(spawn[axis]) && Math.abs(spawn[axis]) <= 10000)) {
    return fail(res, 400, 'INVALID_ROOM', 'Проверьте название, вместимость, точку входа и версию');
  }
  try {
    const result = await pool.query(`
      UPDATE rooms SET name = $3, capacity = $4, spawn_position = $5::jsonb,
        revision = revision + 1, updated_at = now()
      WHERE id = $1 AND revision = $2 AND status = 'draft'
      RETURNING *
    `, [req.params.id, revision, name.trim(), capacity, JSON.stringify(spawn)]);
    if (!result.rows.length) {
      const current = await pool.query('SELECT status, revision FROM rooms WHERE id = $1', [req.params.id]);
      if (!current.rows.length) return fail(res, 404, 'ROOM_NOT_FOUND', 'Комната не найдена');
      return fail(res, 409, 'ROOM_CHANGED', 'Черновик изменился или уже опубликован');
    }
    logAdminAction(req.adminUser.id, 'UPDATE_ROOM', 'rooms', req.params.id,
      `Updated draft revision ${result.rows[0].revision}`, req.ip)
      .catch(error => console.error('[adminRooms] audit:', error));
    res.json({ success: true, room: result.rows[0] });
  } catch (error) {
    console.error('[adminRooms] update:', error);
    fail(res, 500, 'ROOM_UPDATE_ERROR', 'Не удалось изменить черновик');
  }
});

router.post('/', async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const slug = typeof req.body.slug === 'string' ? req.body.slug.trim().toLowerCase() : '';
  const templateKey = req.body.template_key || 'meeting-six';
  const capacity = Number(req.body.capacity ?? 6);
  const creationKey = req.body.creation_key;
  if (!name || name.length > 120 || !SLUG.test(slug) || slug === 'main' ||
      !Number.isInteger(capacity) || capacity < 1 || capacity > 100 ||
      typeof templateKey !== 'string' || templateKey.length > 80 ||
      !UUID.test(String(creationKey || ''))) {
    return fail(res, 400, 'INVALID_ROOM', 'Проверьте название, адрес, вместимость и ключ запроса');
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const existing = await client.query('SELECT * FROM rooms WHERE creation_key = $1', [creationKey]);
    if (existing.rows.length) {
      await client.query('COMMIT');
      if (existing.rows[0].slug !== slug || existing.rows[0].name !== name ||
          existing.rows[0].capacity !== capacity || existing.rows[0].template_key !== templateKey) {
        return fail(res, 409, 'CREATION_KEY_REUSED', 'Ключ запроса уже использован для другой комнаты');
      }
      return res.json({ success: true, room: existing.rows[0], reused: true });
    }
    const templateResult = await client.query(`
      SELECT * FROM room_templates WHERE template_key = $1
      ORDER BY version DESC LIMIT 1
    `, [templateKey]);
    const template = templateResult.rows[0];
    if (!template || !validLayout(template.layout)) {
      await client.query('ROLLBACK');
      return fail(res, 422, 'INVALID_TEMPLATE', 'Шаблон не найден или повреждён');
    }
    const seatCount = template.layout.reduce((count, item) => count + (item.seats || []).filter(s => s.enabled).length, 0);
    if (seatCount > 100) throw new Error('Too many template seats');
    const roomResult = await client.query(`
      INSERT INTO rooms
        (creation_key, slug, name, created_by_admin_id, capacity,
         template_key, template_version, seating_mode, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft') RETURNING *
    `, [creationKey, slug, name, req.adminUser.id, capacity, template.template_key, template.version,
      seatCount ? 'seated' : 'free']);
    const room = roomResult.rows[0];

    await populateRoom(client, room, template, { adminId: req.adminUser.id });
    await client.query('COMMIT');
    logAdminAction(req.adminUser.id, 'CREATE_ROOM', 'rooms', room.id,
      `Created ${room.slug} from ${template.template_key} v${template.version}`, req.ip)
      .catch(error => console.error('[adminRooms] audit:', error));
    res.status(201).json({ success: true, room });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      const existing = await pool.query('SELECT * FROM rooms WHERE creation_key = $1', [creationKey]);
      if (existing.rows.length) {
        const room = existing.rows[0];
        if (room.slug !== slug || room.name !== name || room.capacity !== capacity ||
            room.template_key !== templateKey) {
          return fail(res, 409, 'CREATION_KEY_REUSED', 'Ключ запроса уже использован для другой комнаты');
        }
        return res.json({ success: true, room, reused: true });
      }
      return fail(res, 409, 'ROOM_EXISTS', 'Такой адрес комнаты уже занят');
    }
    console.error('[adminRooms] create:', error);
    fail(res, 500, 'ROOM_CREATE_ERROR', 'Не удалось создать комнату');
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
