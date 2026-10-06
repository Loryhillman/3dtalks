const assert = require('node:assert/strict');
const Module = require('node:module');
const handlers = new Map(), middleware = [], queries = [];
let authenticated = false;
const original = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith('/routes/geometryBuilding.js')) {
    if (request === 'express') return { Router: () => ({ use: fn => middleware.push(fn),
      get: (path, fn) => handlers.set('GET'+path, fn), post: (path, fn) => handlers.set('POST'+path, fn),
      delete: (path, fn) => handlers.set('DELETE'+path, fn) }) };
    if (request === '../database/db') return { query: async sql => { queries.push(sql); return { rows: [] }; } };
    if (request === '../services/geometryBuilder') return {};
    if (request === '../middleware/adminAuth') return { authenticateAdminToken(_req, res) { authenticated = true; res.status(401); } };
  }
  return original(request, parent, isMain);
};
(async () => {
  try {
    require('../src/routes/geometryBuilding');
    const response = { code: 200, status(code) { this.code=code; return this; }, json() {} };
    process.env.APP_MODE = 'rooms'; process.env.ROOMS_ENABLED = 'true';
    middleware[0]({}, response, () => { throw new Error('unauthorized request passed'); });
    assert.equal(authenticated, true); assert.equal(response.code, 401);
    await handlers.get('DELETE/:id')({ params: { id: '1' } }, response);
    assert.equal(response.code, 404);
    assert.equal(queries.length, 1, 'protected geometry must not trigger cascading world deletion');
    assert.match(queries[0], /owner_user_id IS NULL/);
    assert.match(queries[0], /NOT EXISTS/);
    process.env.APP_MODE = 'legacy';
    let passed = false; middleware[0]({}, response, () => { passed = true; });
    assert.equal(passed, true);
    console.log('Legacy geometry: rooms-mode admin gate and room geometry deletion guard OK');
  } finally { Module._load = original; }
})().catch(error => { console.error(error); process.exitCode=1; });
