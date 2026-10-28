const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');
const { registerLegacyAdminRoutes } = require('../src/services/worldIntegrations');
const originalLoad = Module._load;
const originalMode = process.env.APP_MODE;
const originalSecret = process.env.ADMIN_JWT_SECRET;
process.env.APP_MODE = 'rooms';
process.env.ADMIN_JWT_SECRET = 'test-only-admin-secret';
let queries = [];
Module._load = function(name, parent, ...args) {
  if (parent?.filename.includes('/src/') && name === '../database/db') return { query: async (sql, params) => {
    if (sql.includes('FROM admin_users')) return { rows: [{ id: 1, is_active: true }] };
    queries.push({ sql, params });
    return { rows: Array.from({ length: params[0] ? 1 : 51 }, (_, i) => ({ id: i, username: 'User ' + i, room_count: 2 })) };
  } };
  return originalLoad(name, parent, ...args);
};
const users = require('../src/routes/adminRoomUsers');
Module._load = originalLoad;
let server;
(async () => {
  const app = express();
  app.use('/api/admin/users', users);
  registerLegacyAdminRoutes(app, () => { throw Error('Legacy admin must not load'); });
  app.get('/api/admin/rooms/models', (_req, res) => res.json({ success: true }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/api/admin/users')).status, 401);
  const userToken = jwt.sign({ userId: 1 }, process.env.ADMIN_JWT_SECRET);
  assert.equal((await fetch(base + '/api/admin/users', { headers: { Authorization: 'Bearer ' + userToken } })).status, 403);
  const headers = { Authorization: 'Bearer ' + jwt.sign({ type: 'admin', adminUserId: 1 }, process.env.ADMIN_JWT_SECRET) };
  let response = await fetch(base + '/api/admin/users', { headers });
  assert.equal(response.status, 200);
  let data = await response.json();
  assert.equal(data.users.length, 50); assert.equal(data.nextOffset, 50);
  response = await fetch(base + '/api/admin/users?offset=50', { headers });
  data = await response.json(); assert.equal(data.users.length, 1); assert.equal(data.nextOffset, null);
  assert.deepEqual(queries.map(q => q.params), [[0], [50]]);
  assert(queries.every(q => !/password|hash|avatar_config|SELECT u\.\*/i.test(q.sql)), 'account directory excludes sensitive fields');
  for (const offset of ['-1', 'NaN', '1.2', '1000001']) {
    assert.equal((await fetch(base + '/api/admin/users?offset=' + offset, { headers })).status, 400);
  }
  for (const [method, path] of [['DELETE', '/users/1'], ['PUT', '/users/1/role'], ['GET', '/worlds'], ['POST', '/portals'], ['PUT', '/characters/1/stats']]) {
    assert.equal((await fetch(base + '/api/admin' + path, { method, headers })).status, 404);
  }
  assert.equal(queries.length, 2, 'blocked legacy mutations never reached account queries');
  assert.equal((await fetch(base + '/api/admin/rooms/models')).status, 200, 'room endpoints remain reachable');
  console.log('Room administration: administrator-only account directory, bounded pagination, legacy mutations disabled, room routes preserved OK');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  for (const [key, value] of [['APP_MODE', originalMode], ['ADMIN_JWT_SECRET', originalSecret]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
