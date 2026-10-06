const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

let roomIsMain = true;
let owned = true;
let characterOwned = true;
const characterId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith(path.join('middleware', 'mainWorldUserGuard.js'))) {
    if (request === './auth') return { authenticateToken(req, _res, next) {
      if (req.headers.authorization) { req.user = { userId: 'user-1' }; next(); }
      else _res.status(401).json({ error: 'Unauthorized' });
    } };
    if (request === '../database/db') return { query: async (sql, values) => ({ rows:
      sql.includes('FROM characters') ? (roomIsMain && characterOwned && values[0] === characterId && values[1] === 'user-1' ? [1] : []) : (owned ? [1] : [])
    }) };
  }
  return originalLoad(request, parent, isMain);
};
const { mainWorldUserGuard } = require('../src/middleware/mainWorldUserGuard');
Module._load = originalLoad;

async function call(guard, req = {}) {
  let passed = false;
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  const headers = { authorization: 'Bearer token', 'x-character-id': characterId, ...req.headers };
  await guard({ body: {}, params: {}, ...req, headers,
    get(name) { return headers[name.toLowerCase()]; } }, res, () => { passed = true; });
  await new Promise(resolve => setImmediate(resolve));
  return { passed, status: res.statusCode };
}

(async () => {
  const self = mainWorldUserGuard(null, req => req.body.ownerId);
  const shop = mainWorldUserGuard('SELECT 1 FROM shops WHERE id = $1 AND merchant_id = $2');
  process.env.ROOMS_ENABLED = 'true';
  assert.deepEqual(await call(self, { body: { ownerId: 'user-1' } }), { passed: true, status: 200 });
  assert.deepEqual(await call(self, { body: { ownerId: 'other' } }), { passed: false, status: 403 });
  assert.deepEqual(await call(shop, { body: { shopId: 'shop-1' } }), { passed: true, status: 200 });
  owned = false;
  assert.deepEqual(await call(shop, { body: { shopId: 'shop-1' } }), { passed: false, status: 403 });
  roomIsMain = false;
  assert.deepEqual(await call(self, { body: { ownerId: 'user-1' } }), { passed: false, status: 403 });
  roomIsMain = true;
  characterOwned = false;
  assert.deepEqual(await call(self, { body: { ownerId: 'user-1' } }), { passed: false, status: 403 });
  characterOwned = true;
  assert.deepEqual(await call(self, { headers: { 'x-character-id': '' }, body: { ownerId: 'user-1' } }), { passed: false, status: 400 });
  assert.deepEqual(await call(self, { headers: { authorization: '' }, body: { ownerId: 'user-1' } }), { passed: false, status: 401 });
  process.env.ROOMS_ENABLED = 'false';
  assert.deepEqual(await call(self, { body: { ownerId: 'other' } }), { passed: true, status: 200 });
  console.log('Room main-world user guard: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
