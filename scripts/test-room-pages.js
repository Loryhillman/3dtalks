const assert = require('node:assert/strict');
const { registerRoomPages } = require('../src/routes/roomPages');
const original = { mode: process.env.APP_MODE, enabled: process.env.ROOMS_ENABLED };
(async () => {
try {
  const routes = new Map(), app = { get: (route, handler) => routes.set(route, handler) };
  process.env.APP_MODE = 'rooms'; process.env.ROOMS_ENABLED = 'false';
  assert.throws(() => registerRoomPages(app), /requires/);
  process.env.ROOMS_ENABLED = 'true'; registerRoomPages(app);
  const run = async (route, query = {}) => { const result = {}; const res = { setHeader() {}, type() { return res; }, send: html => { result.html = html; }, sendFile: file => { result.file = file; }, redirect: url => { result.redirect = url; } }; await routes.get(route)({ query }, res, error => { throw error; }); return result; };
  assert.ok((await run('/')).file.endsWith('/rooms.html'));
  assert.ok((await run('/index.html')).file.endsWith('/rooms.html'));
  assert.ok((await run('/admin.html')).file.endsWith('/admin_rooms.html'));
  assert.equal((await run('/', { room: 'meeting-one' })).redirect, '/join/meeting-one');
  assert.equal((await run('/play', { room: 'main' })).redirect, '/rooms');
  assert.equal((await run('/play', { room: '//evil.example' })).redirect, '/rooms');
  const meeting = (await run('/play', { room: 'meeting-one' })).html;
  assert(meeting.includes('roomAvatarSession.js')); assert(meeting.includes('meetingMain.js')); assert(meeting.includes('meetingPlayer.js')); assert(!/src="js\/player\.js/.test(meeting)); assert(!/src="js\/main\.js/.test(meeting)); assert(!meeting.includes('data-world-only'));
  assert(!meeting.includes('js/federationUI.js')); assert(!meeting.includes('js/legacyAvatarSession.js'));
  routes.clear(); process.env.APP_MODE = 'legacy'; registerRoomPages(app);
  assert.equal(routes.has('/'), false, 'legacy root preserved');
  assert.equal(routes.has('/admin.html'), false, 'legacy admin page preserved');
  console.log('Room pages: rooms mode, legacy links, room-only play and configuration guard OK');
} finally {
  for (const [key, value] of [['APP_MODE', original.mode], ['ROOMS_ENABLED', original.enabled]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

})().catch(error => { console.error(error); process.exitCode = 1; });
