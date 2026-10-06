const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const roomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MAIN_ROOM_ID = '00000000-0000-0000-0000-000000000001';
const sqlSeen = [];
let endedRoom = null;
let room = { id: roomId, owner_user_id: null, status: 'open', name: 'Test', capacity: 6, revision: 1 };
const pool = { async query(sql, values) {
  sqlSeen.push({ sql, values });
  if (sql.includes('SELECT owner_user_id')) return { rows: [{ owner_user_id: null }] };
  if (sql.includes('SELECT * FROM rooms')) return { rows: [{ ...room }] };
  if (sql.includes('UPDATE rooms')) { room = { ...room, status: values[3], allow_rejoin: values[4], revision: room.revision + 1 }; return { rows: [room] }; }
  return { rows: [] };
}, async connect() { return { query: pool.query, release() {} }; } };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'express') return { Router() {
    const router = { stack: [], use() {} };
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      router[method] = (routePath, fn) => router.stack.push({
        route: { path: routePath, methods: { [method]: true }, stack: [{ handle: fn }] }
      });
    }
    return router;
  } };
  if (parent?.filename.endsWith(path.join('src', 'routes', 'adminRooms.js'))) {
    if (request === '../database/db') return { pool };
    if (request === '../middleware/adminAuth') return {
      authenticateAdminToken() {}, logAdminAction: async () => {}
    };
    if (request === '../services/roomObjects') return { listRoomObjects: async () => [] };
    if (request === '../services/roomValidation') return { validateRoom: async () => ({ ok: true }) };
    if (request === '../websocket/wsServer') return {
      roomParticipants: () => ['cccccccc-cccc-cccc-cccc-cccccccccccc'],
      invalidateRoomReturnAccess() {},
      endRoom: id => { endedRoom = id; return 2; }
    };
  }
  return originalLoad(request, parent, isMain);
};
const router = require('../src/routes/adminRooms');
const { runRoomOperation } = require('../src/services/roomOperationQueue');
function handler(routePath) {
  return router.stack.find(layer => layer.route?.path === routePath &&
    layer.route.methods.post).route.stack[0].handle;
}
async function call(fn, id) {
  const response = { statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await fn({ params: { id }, body: { revision: room.revision }, adminUser: { id: 1 }, ip: '127.0.0.1' }, response);
  return response;
}
(async () => {
  try {
    const invalid = await call(handler('/:id/end'), MAIN_ROOM_ID);
    assert.equal(invalid.statusCode, 404);
    assert.equal(sqlSeen.length, 0);
    let releaseAdmission;
    const admission = runRoomOperation(() => new Promise(resolve => { releaseAdmission = resolve; }));
    const closing = call(handler('/:id/close'), roomId);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sqlSeen.length, 0, 'closing must wait for admission before taking its participant snapshot');
    releaseAdmission();
    await admission;
    const closed = await closing;
    assert.equal(closed.body.success, true);
    assert.equal(closed.body.room.status, 'closed');
    assert.equal(closed.body.room.allow_rejoin, true);
    assert.ok(sqlSeen.some(item => item.sql.includes('INSERT INTO room_rejoin_grants')));
    const ended = await call(handler('/:id/end'), roomId);
    assert.equal(ended.body.disconnected, 2);
    assert.equal(endedRoom, roomId);
    assert.equal(ended.body.room.allow_rejoin, false);
    assert.ok(sqlSeen.some(item => item.sql.includes('INSERT INTO room_user_actions') && item.values[4] === 1));
    assert.ok(sqlSeen.some(item => item.sql.includes('DELETE FROM room_rejoin_grants')));
    assert.ok(sqlSeen.some(item => item.sql.includes('DELETE FROM room_seat_claims')));
    assert.ok(sqlSeen.some(item => JSON.stringify(item.values) === JSON.stringify([MAIN_ROOM_ID, roomId])));
    await assert.rejects(runRoomOperation(() => { throw new Error('test failure'); }));
    assert.equal(await runRoomOperation(() => 'queue recovered'), 'queue recovered');
    console.log('Room lifecycle: OK');
  } finally {
    Module._load = originalLoad;
  }
})().catch(error => { Module._load = originalLoad; console.error(error); process.exitCode = 1; });
