const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createUserRoomService } = require('../src/services/userRooms');
const { ensureRoomTemplates } = require('../src/services/roomTemplateSeed');
let rooms = [], layout, geometries = [], objects = [], seats = [];
let pending = Promise.resolve();
const owner = randomUUID(), other = randomUUID();
const pool = { async connect() {
  let unlock, snapshot;
  return { release() {}, async query(sql, p = []) {
    if (sql === 'BEGIN') return { rows: [] };
    if (sql.includes('FROM users')) {
      const previous = pending; pending = new Promise(resolve => { unlock = resolve; }); await previous;
      snapshot = structuredClone({ rooms, geometries, objects, seats });
      return { rows: [{ id: p[0] }] };
    }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      if (sql === 'ROLLBACK') ({ rooms, geometries, objects, seats } = snapshot);
      unlock(); return { rows: [] };
    }
    if (sql.includes('owner_request_key=$2')) return { rows: rooms.filter(r => r.owner_user_id === p[0] && r.owner_request_key === p[1]) };
    if (sql.includes("interval '1 hour'")) return { rows: [{ count: rooms.filter(r => r.owner_user_id === p[0]).length }] };
    if (sql.includes('count(*)')) return { rows: [{ count: rooms.filter(r => r.owner_user_id === p[0] && !r.deleted_at).length }] };
    if (sql.includes('FROM room_templates')) return { rows: [{ template_key: 'meeting-six', version: 3, layout }] };
    if (sql.includes('INSERT INTO rooms')) {
      const room = { id: randomUUID(), slug: p[0], name: p[1], owner_user_id: p[2], owner_request_key: p[3], creation_payload: JSON.parse(p[4]), capacity: p[5], status: 'draft' };
      rooms.push(room); return { rows: [room] };
    }
    if (sql.includes('INSERT INTO geometry_buildings')) {
      assert.equal(p[0], null); assert.ok([owner, other].includes(p[4]));
      geometries.push(p); return { rows: [{ id: geometries.length }] };
    }
    if (sql.includes('INSERT INTO world_objects')) { objects.push(p); return { rows: [{ id: objects.length }] }; }
    if (sql.includes('INSERT INTO room_seats')) { seats.push(p); return { rows: [] }; }
    if (sql.includes('UPDATE rooms')) { const room = rooms.find(r => r.id === p[0]); room.status = 'open'; return { rows: [room] }; }
    throw new Error(sql);
  } };
} };
(async () => {
  await ensureRoomTemplates({ query: async (_sql, p) => { layout = JSON.parse(p[0]); } });
  const service = createUserRoomService(pool, async () => ({ ok: true }));
  const body = () => ({ name: 'Meeting', capacity: 1, request_key: randomUUID() });
  await assert.rejects(service.create(owner, { ...body(), owner_user_id: other }), { code: 'INVALID_ROOM' });
  await assert.rejects(service.create(owner, { ...body(), capacity: 7 }), { code: 'INVALID_ROOM' });
  const first = body();
  const result = await service.create(owner, first);
  assert.equal(result.room.status, 'open'); assert.equal(result.room.capacity, 1);
  assert.equal(geometries.length, 8); assert.equal(seats.length, 6);
  assert.equal((await service.create(owner, first)).room.id, result.room.id);
  await assert.rejects(service.create(owner, { ...first, name: 'Other' }), { code: 'REQUEST_KEY_REUSED' });
  assert.notEqual((await service.create(other, first)).room.id, result.room.id, 'keys are scoped to owner');
  const broken = createUserRoomService(pool, async () => ({ ok: false }));
  const counts = [rooms.length, objects.length, geometries.length, seats.length];
  await assert.rejects(broken.create(owner, body()), { code: 'INVALID_TEMPLATE' });
  assert.deepEqual([rooms.length, objects.length, geometries.length, seats.length], counts);
  for (let i = 0; i < 3; i++) await service.create(owner, body());
  const race = await Promise.allSettled([service.create(owner, body()), service.create(owner, body())]);
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(race.find(r => r.status === 'rejected').reason.code, 'ROOM_QUOTA_EXCEEDED');
  assert.equal((await service.create(owner, first)).reused, true, 'retry works even at quota');
  rooms.find(r => r.id === result.room.id).deleted_at = new Date();
  await assert.rejects(service.create(owner, first), { code: 'ROOM_DELETED' });
  await service.create(owner, body());
  for (const r of rooms) if (r.owner_user_id === owner) r.deleted_at = new Date();
  while (rooms.filter(r => r.owner_user_id === owner).length < 20) {
    const created = await service.create(owner, body());
    rooms.find(r => r.id === created.room.id).deleted_at = new Date();
  }
  await assert.rejects(service.create(owner, body()), { code: 'ROOM_CREATE_RATE_LIMIT', status: 429 });
  console.log('User rooms: ownership, idempotency, quota race and complete rollback OK (transactional fake)');
})().catch(error => { console.error(error); process.exitCode = 1; });
