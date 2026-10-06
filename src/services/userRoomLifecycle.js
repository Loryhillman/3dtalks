const { MAIN_ROOM_ID } = require('./roomScope');
const { runRoomOperation } = require('./roomOperationQueue');
const { validateRoom } = require('./roomValidation');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }

function createUserRoomLifecycle(pool, presence = () => require('../websocket/wsServer'), validate = validateRoom) {
  async function apply(actor, roomId, action, body = {}) {
    const userId = actor.userId;
    const adminId = actor.adminId;
    const isAdmin = Number.isInteger(adminId) && adminId > 0;
    if (!isAdmin && !UUID.test(userId || '')) fail('UNAUTHORIZED', 401);
    if (!UUID.test(roomId || '') || roomId === MAIN_ROOM_ID) fail('ROOM_NOT_FOUND', 404);
    const allowed = action === 'settings' ? ['revision', 'name', 'capacity'] : ['revision'];
    if (!['settings', 'open', 'close', 'end', 'delete'].includes(action) ||
        !body || typeof body !== 'object' || Array.isArray(body) ||
        !Number.isInteger(body.revision) || body.revision < 1 ||
        Object.keys(body).some(k => !allowed.includes(k))) fail('INVALID_ROOM', 400);
    if (action === 'settings' && ((body.name === undefined && body.capacity === undefined) ||
        (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 120)) ||
        (body.capacity !== undefined && (!Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 6)))) fail('INVALID_ROOM', 400);

    return runRoomOperation(async () => {
      const client = await pool.connect();
      let committed = false;
      try {
        await client.query('BEGIN');
        // Same owner lock as creation, then seat lock, then room row.
        const observed = isAdmin ? (await client.query('SELECT owner_user_id FROM rooms WHERE id=$1', [roomId])).rows[0] : null;
        if (isAdmin && !observed) fail('ROOM_NOT_FOUND', 404);
        const ownerId = isAdmin ? observed.owner_user_id : userId;
        if (ownerId) {
          const owner = await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
          if (!owner.rows.length) fail('UNAUTHORIZED', 401);
        }
        await client.query('SELECT pg_advisory_xact_lock(73421, 1)');
        const room = (await client.query(isAdmin ? 'SELECT * FROM rooms WHERE id=$1 FOR UPDATE' : 'SELECT * FROM rooms WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', isAdmin ? [roomId] : [roomId, userId])).rows[0];
        if (isAdmin && room && room.owner_user_id !== observed.owner_user_id) fail('ROOM_CHANGED');
        if (!room) fail('ROOM_NOT_FOUND', 404);
        if (room.deleted_at) {
          if (action !== 'delete') fail('ROOM_NOT_FOUND', 404);
          await client.query('COMMIT'); committed = true;
          presence().endRoom(roomId);
          return { room, reused: true };
        }
        if (room.revision !== body.revision) fail('ROOM_CHANGED');
        if (room.status === 'archived' && action !== 'delete') fail('ROOM_UNAVAILABLE');
        let name = room.name, capacity = room.capacity, status = room.status;
        let allowRejoin = room.allow_rejoin;
        const ending = action === 'end' || action === 'delete';
        if (action === 'settings') {
          name = body.name?.trim() ?? name;
          capacity = body.capacity ?? capacity;
          if (capacity !== room.capacity) {
            if (!(room.status === 'draft' || (room.status === 'closed' && !room.allow_rejoin))) fail('ROOM_NOT_ENDED');
            const claims = await client.query('SELECT 1 FROM room_seat_claims WHERE room_id=$1 AND expires_at > clock_timestamp()', [roomId]);
            if (claims.rows.length || presence().roomParticipants(roomId).length) fail('ROOM_HAS_PARTICIPANTS');
            const seats = (await client.query('SELECT count(*)::int AS count FROM room_seats WHERE room_id=$1 AND enabled', [roomId])).rows[0].count;
            if (capacity > seats) fail('INVALID_CAPACITY', 400);
          }
        } else if (action === 'open') {
          if (!['draft', 'closed'].includes(room.status)) fail('ROOM_NOT_CLOSED');
          if (!(await validate(roomId, client)).ok) fail('ROOM_INVALID', 422);
          status = 'open'; allowRejoin = false;
          await client.query('DELETE FROM room_rejoin_grants WHERE room_id=$1', [roomId]);
        } else if (action === 'close') {
          if (room.status !== 'open') fail('ROOM_NOT_OPEN');
          status = 'closed'; allowRejoin = true;
          // Include disconnected held seats as well as live participants.
          const participants = presence().roomParticipants(roomId);
          await client.query(`INSERT INTO room_rejoin_grants (room_id, character_id, expires_at)
            SELECT $1, id, now() + interval '5 minutes' FROM characters
            WHERE id = ANY($2::uuid[]) OR id IN
              (SELECT character_id FROM room_seat_claims WHERE room_id=$1 AND expires_at > clock_timestamp())
            ON CONFLICT (room_id, character_id) DO UPDATE SET expires_at=EXCLUDED.expires_at`, [roomId, participants]);
        } else if (ending) {
          status = action === 'delete' ? 'archived' : 'closed'; allowRejoin = false;
          await client.query('DELETE FROM room_rejoin_grants WHERE room_id=$1', [roomId]);
          await client.query('DELETE FROM room_seat_claims WHERE room_id=$1', [roomId]);
          await client.query('UPDATE characters SET last_room_id=$1 WHERE last_room_id=$2', [MAIN_ROOM_ID, roomId]);
        }
        const updated = (await client.query(`UPDATE rooms SET name=$2, capacity=$3, status=$4,
          allow_rejoin=$5, deleted_at=CASE WHEN $6 THEN now() ELSE deleted_at END,
          revision=revision+1, updated_at=now() WHERE id=$1 RETURNING *`,
        [roomId, name, capacity, status, allowRejoin, action === 'delete'])).rows[0];
        await client.query(`INSERT INTO room_user_actions (room_id, user_id, action, revision, admin_user_id)
          VALUES ($1,$2,$3,$4,$5)`, [roomId, isAdmin ? null : userId, action, updated.revision, isAdmin ? adminId : null]);
        await client.query('COMMIT'); committed = true;
        const disconnected = ending ? presence().endRoom(roomId) : 0;
        if (action === 'open') presence().clearRoomReturnGrants(roomId);
        return { room: updated, disconnected };
      } catch (error) {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    });
  }
  return {
    mutate: (userId, roomId, action, body) => apply({ userId }, roomId, action, body),
    mutateAsAdmin: (adminId, roomId, action, body) => {
      if (!Number.isInteger(adminId) || adminId < 1) fail('UNAUTHORIZED', 401);
      return apply({ adminId }, roomId, action, body);
    }
  };
}
module.exports = { createUserRoomLifecycle };
