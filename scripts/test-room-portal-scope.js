const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const mainRoom = '00000000-0000-0000-0000-000000000001';
let lastRoom = 'other-room';
let owned = true;
let logCount = 0;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith(path.join('src', 'routes', 'portal.js'))) {
    if (request === 'express') return { Router() {
      const router = { stack: [] };
      for (const method of ['get', 'post', 'put', 'delete']) {
        router[method] = (routePath, ...handlers) => router.stack.push({
          route: { path: routePath, methods: { [method]: true },
            stack: handlers.map(handle => ({ handle })) }
        });
      }
      return router;
    } };
    if (request === '../middleware/auth') return { authenticateToken() {} };
    if (request === '../database/db') return { query: async sql => {
      if (sql.includes('FROM portals WHERE id')) return { rows: [{
        id: 'portal-1', required_level: 1, cooldown_seconds: 0,
        target_position: { x: 5, y: 2, z: 0 }, portal_type: 'local'
      }] };
      if (sql.includes('FROM characters WHERE id')) return {
        rows: owned ? [{ level: 5, last_room_id: lastRoom }] : []
      };
      if (sql.includes('INSERT INTO portal_logs')) logCount++;
      return { rows: [] };
    } };
  }
  return originalLoad(request, parent, isMain);
};
const router = require('../src/routes/portal');
const usePortal = router.stack.find(layer => layer.route?.path === '/use')
  .route.stack.at(-1).handle;
process.env.ROOMS_ENABLED = 'true';
async function call() {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  await usePortal({ body: { portal_id: 'portal-1', character_id: 'char-1' },
    user: { userId: 'user-1' } }, res);
  return res;
}
(async () => {
  try {
    assert.equal((await call()).statusCode, 403);
    assert.equal(logCount, 0);
    lastRoom = mainRoom;
    assert.equal((await call()).statusCode, 200);
    assert.equal(logCount, 1);
    owned = false;
    assert.equal((await call()).statusCode, 404);
    assert.equal(logCount, 1);
    console.log('Room portal scope: OK');
  } finally {
    Module._load = originalLoad;
  }
})().catch(error => { Module._load = originalLoad; console.error(error); process.exitCode = 1; });
