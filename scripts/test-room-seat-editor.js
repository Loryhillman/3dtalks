const assert = require('node:assert/strict');
const Module = require('node:module');
const { registerRoomSeatRoutes } = require('../src/routes/adminRoomSeats');
const { validSeatLayout } = require('../src/services/roomSeatLayout');
const roomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
let room = { id: roomId, status: 'draft', revision: 1 };
let occupied = false;
const seen = [];
const client = { release() {}, async query(sql, p) {
  seen.push({ sql, p });
  if (sql.includes('SELECT * FROM rooms')) return { rows: [room] };
  if (sql.includes('SELECT 1 FROM room_seat_claims')) return { rows: occupied ? [1] : [] };
  if (sql.includes('SELECT id FROM world_objects')) return { rows: [{ id: 7 }] };
  if (sql.includes('UPDATE rooms SET')) return { rows: [{ ...room, revision: 2 }] };
  return { rows: [] };
} };
const pool = { connect: async () => client, query: client.query };
const routes = new Map();
const router = { get(path, fn) { routes.set('GET '+path, fn); }, post(path, fn) { routes.set('POST '+path, fn); } };
registerRoomSeatRoutes(router, pool, async () => {});
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '../websocket/wsServer' && parent.filename.endsWith('adminRoomSeats.js')) return { roomParticipants: () => [] };
  return load(request, parent, isMain);
};
const seat = { object_id: 7, label: '1', sort_order: 1, enabled: true,
  local_position: { x: 0, y: 1, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 }, map_x: 0, map_y: 0 };
async function call(path, body) {
  const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
  await routes.get('POST '+path)({ params: { id: roomId }, body, adminUser: { id: 1 } }, res);
  return res;
}
(async () => {
  try {
    assert.equal(validSeatLayout([{ ...seat, label: 3 }]), false);
    assert.equal(validSeatLayout([seat, seat]), false);
    assert.equal(validSeatLayout([{ ...seat, local_position: { x: Infinity, y: 0, z: 0 } }]), false);
    assert.equal((await call('/:id/seats', { revision: 1, seats: [], seating_mode: 'seated' })).statusCode, 400);
    assert.equal((await call('/:id/seats', { revision: 1, seats: [seat] })).statusCode, 200);
    assert.ok(seen.some(q => q.sql.includes('INSERT INTO room_seats') && q.p[1] === roomId));
    seen.length = 0;
    assert.equal((await call('/:id/seats', { revision: 1, seats: [{ ...seat, object_id: 9 }] })).statusCode, 400);
    assert.ok(!seen.some(q => q.sql.includes('DELETE FROM room_seats')));
    assert.equal((await call('/:id/seats', { revision: 5, seats: [seat] })).statusCode, 409);
    occupied = true;
    assert.equal((await call('/:id/seats', { revision: 1, seats: [seat] })).statusCode, 409);
    occupied = false;
    room = { ...room, status: 'closed', allow_rejoin: true };
    assert.equal((await call('/:id/edit', { revision: 1 })).statusCode, 409);
    room.allow_rejoin = false;
    assert.equal((await call('/:id/edit', { revision: 1 })).statusCode, 200);
    console.log('Room seat editor: scope, validation, revision and active meeting protection OK');
  } finally { Module._load = load; }
})().catch(error => { console.error(error); process.exitCode = 1; });
