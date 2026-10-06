const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const mainRoom = '00000000-0000-0000-0000-000000000001';
const characterId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
let currentRoom = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
let owned = true;
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith(path.join('src', 'routes', 'monster.js'))) {
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
    if (request === 'uuid') return { v4: () => 'test-id' };
    if (request === '../middleware/auth') return { authenticateToken(req, _res, next) {
      req.user = { userId: 'user-1' }; next();
    } };
    if (request === '../middleware/worldWriteGuard') return { worldWriteGuard(_req, _res, next) { next(); } };
    if (request === '../database/db') return { query: async (sql, values) => {
      if (sql.includes('SELECT 1 FROM characters')) return {
        rows: owned && values[2] === currentRoom ? [{ '?column?': 1 }] : []
      };
      return { rows: [] };
    } };
  }
  return originalLoad(request, parent, isMain);
};
const router = require('../src/routes/monster');
Module._load = originalLoad;
const middleware = routePath => router.stack.find(layer => layer.route?.path === routePath &&
  layer.route.methods.post).route.stack[0].handle;
async function call(routePath, id = characterId) {
  let passed = false;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  middleware(routePath)({ body: { characterId: id }, params: { characterId: id } },
    res, () => { passed = true; });
  await new Promise(resolve => setImmediate(resolve));
  return { passed, status: res.statusCode };
}
(async () => {
  process.env.ROOMS_ENABLED = 'true';
  assert.deepEqual(await call('/:monsterId/take-damage'), { passed: false, status: 403 });
  assert.deepEqual(await call('/character/:characterId/take-damage'), { passed: false, status: 403 });
  currentRoom = mainRoom;
  assert.deepEqual(await call('/:monsterId/take-damage'), { passed: true, status: 200 });
  assert.deepEqual(await call('/character/:characterId/take-damage'), { passed: true, status: 200 });
  owned = false;
  assert.deepEqual(await call('/:monsterId/take-damage'), { passed: false, status: 403 });
  assert.deepEqual(await call('/:monsterId/take-damage', 'invalid'), { passed: false, status: 400 });
  process.env.ROOMS_ENABLED = 'false';
  assert.deepEqual(await call('/:monsterId/take-damage'), { passed: true, status: 200 });
  console.log('Room monster combat scope: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
