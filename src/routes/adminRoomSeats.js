const { validSeatLayout, insertSeat } = require('../services/roomSeatLayout');
const { MAIN_ROOM_ID } = require('../services/roomScope');
const { runRoomOperation } = require('../services/roomOperationQueue');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Registered on the existing authenticated admin router.
function registerRoomSeatRoutes(router, pool, logAdminAction) {
  router.get('/:id/seats', async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'INVALID_ROOM_ID' });
    try {
      const result = await pool.query('SELECT * FROM room_seats WHERE room_id=$1 ORDER BY sort_order,id', [req.params.id]);
      res.json({ success: true, seats: result.rows });
    } catch (error) { res.status(500).json({ error: 'SEATS_READ_ERROR' }); }
  });

  async function mutate(req, res, editing) {
    const id = req.params.id;
    const { seats, revision, seating_mode } = req.body || {};
    if (!UUID.test(id) || id === MAIN_ROOM_ID || !Number.isInteger(revision) || revision < 1 ||
        (!editing && (!validSeatLayout(seats) ||
          (seating_mode !== undefined && !['free', 'seated'].includes(seating_mode)) ||
          (seating_mode === 'seated' && !seats.some(s => s.enabled))))) return res.status(400).json({ error: 'INVALID_SEAT_LAYOUT' });
    let client;
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(73421, 1)');
      const room = (await client.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!room || room.revision !== revision || (editing ? room.status !== 'closed' || room.allow_rejoin : room.status !== 'draft')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'ROOM_CHANGED_OR_ACTIVE' });
      }
      const claims = await client.query('SELECT 1 FROM room_seat_claims WHERE room_id=$1 AND expires_at > clock_timestamp()', [id]);
      if (claims.rows.length || require('../websocket/wsServer').roomParticipants(id).length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'ROOM_HAS_PARTICIPANTS' });
      }
      if (!editing) {
        const objects = (await client.query('SELECT id FROM world_objects WHERE room_id=$1', [id])).rows;
        const ids = new Set(objects.map(o => o.id));
        const existing = new Set((await client.query('SELECT id FROM room_seats WHERE room_id=$1', [id])).rows.map(s => s.id));
        if (seats.some(s => (s.object_id !== null && !ids.has(s.object_id)) || (s.id && !existing.has(s.id)))) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'SEAT_OBJECT_OUTSIDE_ROOM' });
        }
        await client.query('DELETE FROM room_seats WHERE room_id=$1', [id]);
        for (const seat of seats) await insertSeat(client, id, seat);
      }
      const result = await client.query(`UPDATE rooms SET revision=revision+1, updated_at=now(),
        seating_mode=COALESCE($3, seating_mode),
        status=CASE WHEN $2 THEN 'draft' ELSE status END WHERE id=$1 RETURNING *`, [id, editing, editing ? null : seating_mode || null]);
      await client.query('COMMIT');
      logAdminAction(req.adminUser.id, editing ? 'EDIT_ROOM' : 'SAVE_ROOM_SEATS', 'rooms', id,
        editing ? 'Returned ended room to draft' : `Saved ${seats.length} seats`, req.ip).catch(() => {});
      res.json({ success: true, room: result.rows[0] });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      console.error('[adminRoomSeats]', error);
      res.status(500).json({ error: 'SEATS_WRITE_ERROR' });
    } finally { client?.release(); }
  }
  router.post('/:id/seats', (req, res) => runRoomOperation(() => mutate(req, res, false)));
  router.post('/:id/edit', (req, res) => runRoomOperation(() => mutate(req, res, true)));
}

module.exports = { registerRoomSeatRoutes };
