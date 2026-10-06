const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const roomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const characterId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
let allowed = false;
let owned = true;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'express') return { Router() {
    const router = { stack: [], use() {} };
    router.get = (routePath, fn) => router.stack.push({
      route: { path: routePath, methods: { get: true }, stack: [{ handle: fn }] }
    });
    return router;
  } };
  if (parent?.filename.endsWith(path.join('src', 'routes', 'rooms.js'))) {
    if (request === '../database/db') return { pool: { async query(sql) {
      if (sql.includes('FROM rooms')) return { rows: [{ id: roomId, status: 'closed', allow_rejoin: true }] };
      return { rows: owned ? [{ last_room_id: roomId,
        last_position: { x: 5, y: 2, z: 1 } }] : [] };
    } } };
    if (request === '../middleware/auth') return { authenticateToken() {} };
    if (request === '../services/roomObjects') return { listRoomObjects: async () => [] };
    if (request === '../websocket/wsServer') return { hasPersistentRoomReturnAccess: async () => allowed };
  }
  return originalLoad(request, parent, isMain);
};
const router = require('../src/routes/rooms');
const getRoom = router.stack.find(layer => layer.route?.path === '/:slug').route.stack[0].handle;
async function call(char) {
  const response = { statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await getRoom({ params: { slug: 'room' }, query: { characterId: char },
    user: { userId: 'user-1' } }, response);
  return response;
}
(async () => {
  try {
    assert.equal((await call(characterId)).statusCode, 404);
    allowed = true;
    const returned = await call(characterId);
    assert.equal(returned.statusCode, 200);
    assert.deepEqual(returned.body.room.resume_position, { x: 5, y: 2, z: 1 });
    owned = false;
    assert.equal((await call(characterId)).statusCode, 404);
    assert.equal((await call('invalid')).statusCode, 404);
    console.log('Room HTTP return access: OK');
  } finally {
    Module._load = originalLoad;
  }
})().catch(error => { Module._load = originalLoad; console.error(error); process.exitCode = 1; });
