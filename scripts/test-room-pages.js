const assert = require('node:assert/strict');
const { registerRoomPages } = require('../src/routes/roomPages');
const original = { mode: process.env.APP_MODE, enabled: process.env.ROOMS_ENABLED };
try {
  const routes = new Map(), app = { get: (route, handler) => routes.set(route, handler) };
  process.env.APP_MODE = 'rooms'; process.env.ROOMS_ENABLED = 'false';
  assert.throws(() => registerRoomPages(app), /requires/);
  process.env.ROOMS_ENABLED = 'true'; registerRoomPages(app);
  const run = (route, query = {}) => { const result = {}; routes.get(route)({ query }, { setHeader() {}, sendFile: file => { result.file = file; }, redirect: url => { result.redirect = url; } }); return result; };
  assert.ok(run('/').file.endsWith('/rooms.html'));
  assert.ok(run('/index.html').file.endsWith('/rooms.html'));
  assert.ok(run('/admin.html').file.endsWith('/admin_rooms.html'));
  assert.equal(run('/', { room: 'meeting-one' }).redirect, '/join/meeting-one');
  assert.equal(run('/play', { room: 'main' }).redirect, '/rooms');
  assert.equal(run('/play', { room: '//evil.example' }).redirect, '/rooms');
  assert.ok(run('/play', { room: 'meeting-one' }).file.endsWith('/index.html'));
  routes.clear(); process.env.APP_MODE = 'legacy'; registerRoomPages(app);
  assert.equal(routes.has('/'), false, 'legacy root preserved');
  assert.equal(routes.has('/admin.html'), false, 'legacy admin page preserved');
  console.log('Room pages: rooms mode, legacy links, room-only play and configuration guard OK');
} finally {
  for (const [key, value] of [['APP_MODE', original.mode], ['ROOMS_ENABLED', original.enabled]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
