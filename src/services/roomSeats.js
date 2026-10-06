const { MAIN_ROOM_ID } = require('./roomScope');
const { roomSeatPose } = require('./roomSeatPose');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_LEASE_SECONDS = 60;
const DISCONNECT_HOLD_SECONDS = 30;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// Internal service: admit must only be called by authenticated admission.
// A client cannot use admit to replace its session or bypass room admission.
function createRoomSeatService(pool) {
  async function transaction(operation) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // One lock for all seat operations, including cross-room transfers.
      // The current application already runs room operations in one process.
      await client.query('SELECT pg_advisory_xact_lock(73421, 1)');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  function identity(input) {
    if (!UUID.test(input.characterId || '') || !UUID.test(input.roomId || '') ||
        typeof input.sessionId !== 'string' || !input.sessionId.length || input.sessionId.length > 128) fail('INVALID_SEAT_REQUEST');
  }

  async function assign(input, isAdmission) {
    identity(input);
    const { roomId, characterId, sessionId, userId, seatId } = input;
    if (!UUID.test(userId || '') || (seatId !== undefined && !UUID.test(seatId))) fail('INVALID_SEAT_REQUEST');
    if (roomId === MAIN_ROOM_ID) fail('SEATING_NOT_ENABLED');
    return transaction(async client => {
      const room = (await client.query('SELECT * FROM rooms WHERE id = $1 FOR UPDATE', [roomId])).rows[0];
      if (!room || room.seating_mode !== 'seated') fail('SEATING_NOT_ENABLED');
      if (!['open', 'closed'].includes(room.status)) fail('ROOM_UNAVAILABLE');
      const owner = await client.query('SELECT 1 FROM characters WHERE id = $1 AND user_id = $2', [characterId, userId]);
      if (!owner.rows.length) fail('CHARACTER_FORBIDDEN');
      await client.query('DELETE FROM room_seat_claims WHERE expires_at <= clock_timestamp()');
      const previous = (await client.query('SELECT * FROM room_seat_claims WHERE character_id = $1', [characterId])).rows[0];
      const current = previous?.room_id === roomId ? previous : null;
      if (!current) {
        const occupancy = await client.query('SELECT count(*)::int AS count FROM room_seat_claims WHERE room_id = $1', [roomId]);
        if (occupancy.rows[0].count >= room.capacity) fail('ROOM_FULL');
      }
      if (!isAdmission && (!current || current.session_id !== sessionId || current.state !== 'active')) fail('SEAT_SESSION_EXPIRED');
      if (room.status === 'closed') {
        if (!room.allow_rejoin) fail('ROOM_UNAVAILABLE');
        const grant = await client.query(`SELECT 1 FROM room_rejoin_grants
          WHERE room_id = $1 AND character_id = $2 AND expires_at > clock_timestamp()`, [roomId, characterId]);
        if (!current && !grant.rows.length) fail('ROOM_UNAVAILABLE');
      }
      const seats = (await client.query(`SELECT s.* FROM room_seats s
        LEFT JOIN world_objects o ON o.id=s.object_id AND o.room_id=s.room_id
        LEFT JOIN room_seat_claims c ON c.seat_id = s.id
        WHERE s.room_id = $1 AND s.enabled AND (c.seat_id IS NULL OR c.character_id = $2)
        ORDER BY s.sort_order, s.id`, [roomId, characterId])).rows;
      const selected = seatId ? seats.find(s => s.id === seatId)
        : seats.find(s => s.id === current?.seat_id) || seats[0];
      if (!selected) fail(seatId ? 'SEAT_UNAVAILABLE' : 'ROOM_FULL');
      const object = selected.object_id === null ? {} : (await client.query('SELECT * FROM world_objects WHERE room_id = $1 AND id = $2',
        [roomId, selected.object_id])).rows[0];
      if (!object) fail('SEAT_UNAVAILABLE');
      const pose = roomSeatPose(selected, object);
      // The old place remains intact if any subsequent operation fails.
      await client.query('DELETE FROM room_seat_claims WHERE character_id = $1', [characterId]);
      const claim = (await client.query(`INSERT INTO room_seat_claims
        (seat_id, room_id, character_id, session_id, state, expires_at)
        VALUES ($1, $2, $3, $4, 'active', clock_timestamp() + $5 * interval '1 second') RETURNING *`,
      [selected.id, roomId, characterId, sessionId, ACTIVE_LEASE_SECONDS])).rows[0];
      if (isAdmission) await client.query('UPDATE characters SET last_room_id = $1 WHERE id = $2 AND user_id = $3',
        [roomId, characterId, userId]);
      if (input.isCurrent && !input.isCurrent()) fail('SEAT_SESSION_EXPIRED');
      return { seat: selected, claim, pose };
    });
  }

  async function updateSession(input, action) {
    identity(input);
    return transaction(async client => {
      const values = [input.roomId, input.characterId, input.sessionId];
      let sql;
      if (action === 'release') {
        sql = `DELETE FROM room_seat_claims WHERE room_id = $1 AND character_id = $2 AND session_id = $3 RETURNING seat_id`;
      } else if (action === 'hold') {
        // A duplicate disconnect must not extend the original hold.
        sql = `UPDATE room_seat_claims SET state = 'held', expires_at = clock_timestamp() + $4 * interval '1 second'
          WHERE room_id = $1 AND character_id = $2 AND session_id = $3
          AND state = 'active' AND expires_at > clock_timestamp() RETURNING seat_id`;
        values.push(DISCONNECT_HOLD_SECONDS);
      } else {
        sql = `UPDATE room_seat_claims SET expires_at = clock_timestamp() + $4 * interval '1 second'
          WHERE room_id = $1 AND character_id = $2 AND session_id = $3
          AND state = 'active' AND expires_at > clock_timestamp() RETURNING seat_id`;
        values.push(ACTIVE_LEASE_SECONDS);
      }
      const changed = (await client.query(sql, values)).rows.length > 0;
      if (changed && action === 'release' && input.leave) {
        await client.query('UPDATE characters SET last_room_id = $1 WHERE id = $2 AND last_room_id = $3',
          [MAIN_ROOM_ID, input.characterId, input.roomId]);
      }
      return changed;
    });
  }

  return {
    // Internal callers must check room access before sending this snapshot.
    list: async roomId => {
      if (!UUID.test(roomId || '') || roomId === MAIN_ROOM_ID) fail('INVALID_SEAT_REQUEST');
      const rows = (await pool.query(`SELECT s.*, row_to_json(o) AS seat_object, c.character_id, p.name AS character_name,
        COALESCE(c.state, 'free') AS occupancy, c.expires_at
        FROM room_seats s
        LEFT JOIN world_objects o ON o.id=s.object_id AND o.room_id=s.room_id
        LEFT JOIN room_seat_claims c ON c.seat_id = s.id AND c.expires_at > clock_timestamp()
        LEFT JOIN characters p ON p.id = c.character_id
        WHERE s.room_id = $1 AND s.enabled ORDER BY s.sort_order, s.id`, [roomId])).rows;
      return rows.map(({seat_object, ...s}) => {
        try {return {...s, ...roomSeatPose(s,seat_object || {})};}
        catch (_) {return {...s, position:null, orientation:null};}
      });
    },
    cleanupExpired: () => transaction(async client => (await client.query(
      'DELETE FROM room_seat_claims WHERE expires_at <= clock_timestamp() RETURNING room_id, seat_id')).rows),
    admit: input => assign(input, true),
    move: input => {
      if (!UUID.test(input.seatId || '')) fail('INVALID_SEAT_REQUEST');
      return assign(input, false);
    },
    release: input => updateSession(input, 'release'),
    hold: input => updateSession(input, 'hold'),
    renew: input => updateSession(input, 'renew'),
    clearRoom: roomId => {
      if (!UUID.test(roomId || '') || roomId === MAIN_ROOM_ID) fail('INVALID_SEAT_REQUEST');
      return transaction(async client => (await client.query(
        'DELETE FROM room_seat_claims WHERE room_id = $1 RETURNING seat_id', [roomId])).rows);
    }
  };
}

module.exports = { createRoomSeatService, ACTIVE_LEASE_SECONDS, DISCONNECT_HOLD_SECONDS };
