const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createUserRoomLifecycle } = require('../src/services/userRoomLifecycle');
const owner = randomUUID(), id = randomUUID();
let room = { id, owner_user_id: owner, name: 'Meeting', capacity: 6, revision: 1, status: 'open', allow_rejoin: false };
let claims = [1], participants = ['player'], grants = [], audit = [], events = [], failAudit = false;
const pool = { async connect() {
  let snapshot;
  return { release() {}, async query(sql, p = []) {
    if (sql === 'BEGIN') { snapshot = structuredClone({ room, claims, grants, audit }); return { rows: [] }; }
    if (sql === 'ROLLBACK') { ({ room, claims, grants, audit } = snapshot); return { rows: [] }; }
    if (sql === 'COMMIT') { events.push('commit'); return { rows: [] }; }
    if (sql.includes('FROM users')) return { rows: [{ id: p[0] }] };
    if (sql.includes('pg_advisory')) return { rows: [] };
    if (sql.includes('SELECT owner_user_id FROM rooms')) return { rows: [{ owner_user_id: room.owner_user_id }] };
    if (sql.includes('SELECT * FROM rooms')) return { rows: room.id === p[0] && (p.length === 1 || room.owner_user_id === p[1]) ? [structuredClone(room)] : [] };
    if (sql.includes('SELECT 1 FROM room_seat_claims')) return { rows: claims };
    if (sql.includes('SELECT count(*)')) return { rows: [{ count: 6 }] };
    if (sql.includes('INSERT INTO room_rejoin_grants')) { grants = [1]; return { rows: [] }; }
    if (sql.includes('DELETE FROM room_rejoin_grants')) { grants = []; return { rows: [] }; }
    if (sql.includes('DELETE FROM room_seat_claims')) { claims = []; return { rows: [] }; }
    if (sql.includes('UPDATE characters')) return { rows: [] };
    if (sql.includes('UPDATE rooms')) {
      Object.assign(room, { name: p[1], capacity: p[2], status: p[3], allow_rejoin: p[4], deleted_at: p[5] ? new Date() : room.deleted_at, revision: room.revision + 1 });
      return { rows: [structuredClone(room)] };
    }
    if (sql.includes('INSERT INTO room_user_actions')) { if (failAudit) throw new Error('audit failure'); audit.push(p); return { rows: [] }; }
    throw new Error(sql);
  } };
} };
const presence = { roomParticipants: () => participants, endRoom() { assert.equal(events.at(-1), 'commit'); events.push('end'); participants = []; }, clearRoomReturnGrants() { assert.equal(events.at(-1), 'commit'); events.push('clear'); } };
const service = createUserRoomLifecycle(pool, () => presence, async () => ({ ok: true }));
const act = (action, fields = {}) => service.mutate(owner, id, action, { revision: room.revision, ...fields });
(async () => {
  await assert.rejects(service.mutate(randomUUID(), id, 'delete', { revision: 1 }), { code: 'ROOM_NOT_FOUND' });
  await assert.rejects(act('settings', { owner_user_id: randomUUID() }), { code: 'INVALID_ROOM' });
  await assert.rejects(act('settings', { capacity: 1 }), { code: 'ROOM_NOT_ENDED' });
  await act('settings', { name: 'Renamed' }); assert.equal(room.name, 'Renamed');
  await assert.rejects(service.mutate(owner, id, 'end', { revision: 1 }), { code: 'ROOM_CHANGED' });
  await act('close'); assert.equal(room.allow_rejoin, true); assert.equal(claims.length, 1); assert.equal(grants.length, 1);
  failAudit = true;
  await assert.rejects(act('end'), /audit failure/);
  assert.equal(claims.length, 1); assert.equal(grants.length, 1); assert.ok(!events.includes('end'));
  failAudit = false;
  await act('end'); assert.equal(claims.length, 0); assert.equal(room.allow_rejoin, false);
  claims = [1]; await assert.rejects(act('settings', { capacity: 1 }), { code: 'ROOM_HAS_PARTICIPANTS' }); claims = [];
  await act('settings', { capacity: 1 }); assert.equal(room.capacity, 1);
  await act('open'); assert.equal(room.status, 'open');
  const oldRevision = room.revision;
  await service.mutateAsAdmin(1, id, 'delete', { revision: room.revision });
  assert.equal(audit.at(-1)[1], null); assert.equal(audit.at(-1)[4], 1);
  assert.equal(room.status, 'archived'); assert.ok(room.deleted_at);
  assert.equal((await service.mutate(owner, id, 'delete', { revision: oldRevision })).reused, true);
  await assert.rejects(act('open'), { code: 'ROOM_NOT_FOUND' });
  console.log('User lifecycle: ownership, revision, capacity, close/end/delete, rollback and post-commit events OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
