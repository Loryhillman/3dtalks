const { randomUUID } = require('node:crypto');
const { validLayout, populateRoom } = require('./roomCreation');
const { validateRoom } = require('./roomValidation');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 5;
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }

function createUserRoomService(pool, validate = validateRoom) {
  async function list(userId) {
    if (!UUID.test(userId || '')) fail('UNAUTHORIZED', 401);
    const { rows } = await pool.query(`SELECT r.id, r.slug, r.name, r.capacity, r.status, r.allow_rejoin,
      r.revision, r.seating_mode, r.created_at,
      occupancy.active, occupancy.held, seats.total AS seat_count,
      GREATEST(0, LEAST(r.capacity, seats.total) - occupancy.active - occupancy.held)::int AS available
      FROM rooms r
      CROSS JOIN LATERAL (SELECT
        count(*) FILTER (WHERE state='active')::int AS active,
        count(*) FILTER (WHERE state='held')::int AS held
        FROM room_seat_claims WHERE room_id=r.id AND expires_at > clock_timestamp()) occupancy
      CROSS JOIN LATERAL (SELECT count(*)::int AS total FROM room_seats WHERE room_id=r.id AND enabled) seats
      WHERE r.owner_user_id=$1 AND r.deleted_at IS NULL ORDER BY r.created_at DESC, r.id`, [userId]);
    return { rooms: rows, quota: { used: rows.length, limit: LIMIT } };
  }
  async function create(userId, body = {}) {
    if (!UUID.test(userId || '')) fail('UNAUTHORIZED', 401);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_ROOM', 400);
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const capacity = body.capacity ?? 6;
    if (!name || name.length > 120 || !Number.isInteger(capacity) || capacity < 1 || capacity > 6 ||
        !UUID.test(body.request_key || '') || Object.keys(body).some(k => !['name', 'capacity', 'request_key'].includes(k))) {
      fail('INVALID_ROOM', 400);
    }
    const payload = { name, capacity, template_key: 'meeting-six' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize quota decisions for this owner, across processes and tabs.
      const owner = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (!owner.rows.length) fail('UNAUTHORIZED', 401);
      const prior = (await client.query(`SELECT * FROM rooms
        WHERE owner_user_id=$1 AND owner_request_key=$2`, [userId, body.request_key])).rows[0];
      if (prior) {
        if (prior.deleted_at) fail('ROOM_DELETED', 410);
        if (!prior.creation_payload || Object.keys(payload).some(k => prior.creation_payload[k] !== payload[k])) fail('REQUEST_KEY_REUSED');
        await client.query('COMMIT');
        return { room: prior, reused: true };
      }
      const count = (await client.query('SELECT count(*)::int AS count FROM rooms WHERE owner_user_id=$1 AND deleted_at IS NULL', [userId])).rows[0].count;
      if (count >= LIMIT) fail('ROOM_QUOTA_EXCEEDED');
      // Include deleted rooms: deleting cannot reset the hourly creation budget.
      // Owner row is already locked; retries were resolved before these checks.
      const recent = (await client.query(`SELECT count(*)::int AS count FROM rooms
        WHERE owner_user_id=$1 AND created_at > clock_timestamp() - interval '1 hour'`, [userId])).rows[0].count;
      if (recent >= 20) fail('ROOM_CREATE_RATE_LIMIT', 429);
      const template = (await client.query(`SELECT * FROM room_templates WHERE template_key=$1
        ORDER BY version DESC LIMIT 1`, [payload.template_key])).rows[0];
      if (!template || !validLayout(template.layout)) fail('INVALID_TEMPLATE', 422);
      const seats = template.layout.reduce((n, o) => n + (o.seats || []).filter(s => s.enabled).length, 0);
      if (capacity > seats) fail('INVALID_TEMPLATE', 422);
      const room = (await client.query(`INSERT INTO rooms
        (slug, name, owner_user_id, owner_request_key, creation_payload, capacity,
         template_key, template_version, seating_mode, status)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,'seated','draft') RETURNING *`,
      ['room-' + randomUUID(), name, userId, body.request_key, JSON.stringify(payload), capacity, template.template_key, template.version])).rows[0];
      await populateRoom(client, room, template, { userId });
      const validation = await validate(room.id, client);
      if (!validation.ok) fail('INVALID_TEMPLATE', 422);
      const opened = (await client.query("UPDATE rooms SET status='open', revision=revision+1, updated_at=now() WHERE id=$1 RETURNING *", [room.id])).rows[0];
      await client.query('COMMIT');
      return { room: opened, reused: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  return { list, create };
}
module.exports = { createUserRoomService };
