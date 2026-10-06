const assert = require('node:assert/strict');
const Module = require('node:module');
const { ensureRoomTemplates } = require('../src/services/roomTemplateSeed');
const roomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const routes = new Map();
let layout, room, seats = 0, objectId = 0;
const pool = { async connect() { return { release() {}, query: pool.query }; }, async query(sql, values) {
  if (sql.includes('FROM room_templates')) return { rows: [{ template_key: 'meeting-six', version: 3, layout }] };
  if (sql.includes('INSERT INTO rooms')) {
    room = { id: roomId, capacity: values[4], seating_mode: values[7], slug: values[1], template_key: values[5], template_version: values[6] };
    return { rows: [room] };
  }
  if (sql.includes('INSERT INTO geometry_buildings')) return { rows: [{ id: 10 }] };
  if (sql.includes('INSERT INTO world_objects')) return { rows: [{ id: ++objectId }] };
  if (sql.includes('INSERT INTO room_seats')) seats++;
  return { rows: [] };
} };
const original = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/routes/adminRooms.js')) {
    if (request === 'express') return { Router() { const router = { use() {} }; for (const method of ['get','post','put','patch','delete']) router[method] = (path, fn) => routes.set(method+path, fn); return router; } };
    if (request === '../database/db') return { pool };
    if (request === '../middleware/adminAuth') return { authenticateAdminToken() {}, logAdminAction: async () => {} };
  }
  return original(request, parent, isMain);
};
require('../src/routes/adminRooms');
Module._load = original;
(async () => {
  await ensureRoomTemplates({ query: async (_sql, values) => { layout = JSON.parse(values[0]); } });
  const response = { status(n) { this.code=n; return this; }, json(body) { this.body=body; } };
  await routes.get('post/')({ body: { name: 'Meeting', slug: 'meeting', capacity: 1,
    creation_key: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }, adminUser: { id: 1 } }, response);
  assert.equal(response.code, 201);
  assert.equal(room.seating_mode, 'seated'); assert.equal(room.capacity, 1);
  assert.equal(seats, 6); assert.equal(room.template_version, 3);
  console.log('Room creation: latest template enables seating and preserves requested capacity with six seats OK');
})().catch(error => { console.error(error); process.exitCode=1; });
