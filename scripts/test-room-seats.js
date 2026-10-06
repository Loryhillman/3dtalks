const assert = require('node:assert/strict');
const { createRoomSeatService } = require('../src/services/roomSeats');
const roomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const userId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const charA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const charB = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const seatA = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const seatB = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
let claims = [];
let seats = [{ id: seatA, room_id: roomId }];
let failInsert = false;
let status = 'open';
let capacity = 1;
let lock = Promise.resolve();
// Transactional fake to exercise the service's race and rollback behavior.
// Real SQL and constraints are covered separately by check-room-postgres.js.
const pool = { async connect() {
  let unlock;
  let snapshot;
  return { release() {}, async query(sql, p = []) {
    if (sql === 'BEGIN') return { rows: [] };
    if (sql.includes('pg_advisory_xact_lock')) {
      const previous = lock;
      lock = new Promise(resolve => { unlock = resolve; });
      await previous;
      snapshot = structuredClone(claims);
      return { rows: [] };
    }
    if (sql === 'ROLLBACK' || sql === 'COMMIT') {
      if (sql === 'ROLLBACK') claims = snapshot;
      unlock();
      return { rows: [] };
    }
    if (sql.includes('SELECT * FROM rooms')) return { rows: [{ id: roomId, seating_mode: 'seated', capacity, status, allow_rejoin: false }] };
    if (sql.includes('SELECT 1 FROM characters')) return { rows: p[1] === userId ? [1] : [] };
    if (sql.includes('SELECT * FROM world_objects')) return { rows: [{}] };
    if (sql.includes('UPDATE characters SET last_room_id')) return { rows: [] };
    if (sql.includes('DELETE FROM room_seat_claims WHERE expires_at')) {
      claims = claims.filter(c => c.expires_at > Date.now());
      return { rows: [] };
    }
    if (sql.includes('SELECT count(*)::int AS count FROM room_seat_claims')) return { rows: [{ count: claims.filter(c => c.room_id === p[0]).length }] };
    if (sql.includes('SELECT * FROM room_seat_claims')) return { rows: claims.filter(c => c.character_id === p[0]) };
    if (sql.includes('SELECT s.* FROM room_seats')) return { rows: seats.filter(s =>
      !claims.some(c => c.seat_id === s.id && c.character_id !== p[1])) };
    if (sql.includes('DELETE FROM room_seat_claims WHERE character_id')) {
      claims = claims.filter(c => c.character_id !== p[0]); return { rows: [] };
    }
    if (sql.includes('INSERT INTO room_seat_claims')) {
      if (failInsert) throw new Error('insert failed');
      const claim = { seat_id: p[0], room_id: p[1], character_id: p[2], session_id: p[3],
        state: 'active', expires_at: Date.now() + p[4] * 1000 };
      claims.push(claim); return { rows: [claim] };
    }
    if (/^(UPDATE|DELETE FROM) room_seat_claims/.test(sql)) {
      const matches = claims.filter(c => c.room_id === p[0] && c.character_id === p[1] && c.session_id === p[2] &&
        (!sql.includes("state = 'active' AND") || (c.state === 'active' && c.expires_at > Date.now())));
      if (sql.startsWith('DELETE')) claims = claims.filter(c => !matches.includes(c));
      else for (const c of matches) {
        if (sql.includes("SET state = 'held'")) c.state = 'held';
        c.expires_at = Date.now() + p[3] * 1000;
      }
      return { rows: matches };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
} };
const service = createRoomSeatService(pool);
const input = (characterId = charA, sessionId = 'session-1', seatId) => ({ roomId, userId, characterId, sessionId, seatId });

(async () => {
  const results = await Promise.allSettled([service.admit(input()), service.admit(input(charB, 'session-2'))]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'ROOM_FULL');
  assert.equal(claims.length, 1);
  await service.admit(input(charA, 'replacement'));
  assert.equal(await service.release(input()), false, 'old socket must not release a replacement session');
  assert.equal(await service.hold(input()), false, 'old socket must not hold a replacement session');
  await assert.rejects(service.move(input(charA, 'session-1', seatA)), { code: 'SEAT_SESSION_EXPIRED' });
  seats.push({ id: seatB, room_id: roomId });
  await assert.rejects(service.admit(input(charB, 'over-limit')), { code: 'ROOM_FULL' });
  failInsert = true;
  await assert.rejects(service.move(input(charA, 'replacement', seatB)), /insert failed/);
  assert.equal(claims[0].seat_id, seatA, 'failed transfer must restore the original place');
  failInsert = false;
  await service.move(input(charA, 'replacement', seatB));
  assert.equal(claims[0].seat_id, seatB);
  capacity = 2;
  await service.admit(input(charB, 'session-2'));
  await assert.rejects(service.move(input(charA, 'replacement', seatA)), { code: 'SEAT_UNAVAILABLE' });
  assert.equal(claims.find(c => c.character_id === charA).seat_id, seatB,
    'occupied destination must leave the current place unchanged');
  assert.equal(await service.release(input(charB, 'session-2')), true);
  assert.equal(await service.hold(input(charA, 'replacement')), true);
  const expires = claims[0].expires_at;
  assert.equal(await service.hold(input(charA, 'replacement')), false);
  assert.equal(await service.renew(input(charA, 'replacement')), false);
  assert.equal(claims[0].expires_at, expires, 'duplicate disconnect and heartbeat cannot extend a hold');
  await service.admit(input(charA, 'returned'));
  assert.equal(claims[0].seat_id, seatB, 'reconnection retains the original seat');
  status = 'closed';
  await assert.rejects(service.admit(input(charB, 'session-2')), { code: 'ROOM_UNAVAILABLE' });
  status = 'open';
  claims[0].expires_at = Date.now() - 1;
  assert.equal(await service.renew(input(charA, 'returned')), false, 'expired lease cannot be revived by heartbeat');
  capacity = 2;
  await service.admit(input(charB, 'session-2'));
  assert.equal(claims[0].character_id, charB);
  await assert.rejects(service.admit({ ...input(), userId: seatB }), { code: 'CHARACTER_FORBIDDEN' });
  claims=[];seats=[{id:seatA,room_id:roomId,object_id:null,coordinate_space:'rigid',local_position:{x:3,y:1,z:4},local_rotation:{x:0,y:0,z:0}}];
  const standalone=await service.admit(input());
  assert.deepEqual(standalone.pose.position,{x:3,y:1,z:4});
  console.log('Room seats: concurrent admission, session replacement, rollback, expiry and hold OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
