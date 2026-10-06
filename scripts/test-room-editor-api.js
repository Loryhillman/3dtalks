const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const pool = { query: async () => ({ rows: [] }), connect: async () => ({query:(...args)=>pool.query(...args), release(){}}) };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'express') return {
    Router() {
      const router = { stack: [], use() {} };
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        router[method] = (routePath, fn) => router.stack.push({
          route: { path: routePath, methods: { [method]: true },
            stack: [{ handle: fn }] }
        });
      }
      return router;
    }
  };
  if (parent?.filename.endsWith(path.join('src', 'routes', 'adminRooms.js'))) {
    if (request === '../database/db') return { pool };
    if (request === '../middleware/adminAuth') return {
      authenticateAdminToken() {}, logAdminAction: async () => {}
    };
    if (request === '../services/roomObjects') return { listRoomObjects: async () => [] };
  }
  return originalLoad(request, parent, isMain);
};
const router = require('../src/routes/adminRooms');
Module._load = originalLoad;

const roomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherRoom = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const transform = {
  position_x: 1, position_y: 0, position_z: 2,
  rotation_x: 0, rotation_y: 0, rotation_z: 0,
  scale_x: 1, scale_y: 1, scale_z: 1,
  has_collision: true
};

function handler(method, routePath) {
  const layer = router.stack.find(layer => layer.route?.path === routePath &&
    layer.route.methods[method]);
  assert.ok(layer, `${method} ${routePath}`);
  return layer.route.stack.at(-1).handle;
}

async function call(fn, params, body) {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  await fn({ params, body, adminUser: { id: 1 }, ip: '127.0.0.1' }, res);
  return res;
}

(async () => {
  const original = pool.query;
  const queries = [];
  pool.query = async (sql, values) => {
    queries.push({ sql, values });
    return { rows: [] }; // No row matches: another room, non-draft, or missing model.
  };
  try {
    const add = await call(handler('post', '/:id/objects'), { id: roomId },
      { ...transform, name: 'Стул', model_id: 9 });
    assert.equal(add.statusCode, 404);
    assert.match(queries.at(-1).sql, /r\.id = \$1 AND r\.status = 'draft'/);
    assert.match(queries.at(-1).sql, /m\.id = \$2/);
    assert.equal(queries.at(-1).values[0], roomId);

    const move = await call(handler('patch', '/:id/objects/:objectId'),
      { id: roomId, objectId: '42' }, transform);
    assert.equal(move.statusCode, 404);
    assert.match(queries.at(-1).sql, /id = \$2 AND room_id = \$1/);
    assert.match(queries.at(-1).sql, /status = 'draft'/);

    const count = queries.length;
    const remove = await call(handler('delete', '/:id/objects/:objectId'),
      { id: otherRoom, objectId: '42' });
    assert.equal(remove.statusCode, 409);
    assert(queries.slice(count).some(q=>q.sql.includes('FROM rooms WHERE id=$1 FOR UPDATE') && q.values[0]===otherRoom));
    assert(!queries.slice(count).some(q=>q.sql.includes('DELETE FROM world_objects')));
    const afterRemove=queries.length;

    const invalid = await call(handler('post', '/:id/objects'), { id: roomId },
      { ...transform, name: 'Стул', model_id: 9, scale_x: -1 });
    assert.equal(invalid.statusCode, 400);
    assert.equal(queries.length, afterRemove);
    console.log('Room editor API scoping: OK');
  } finally {
    pool.query = original;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
