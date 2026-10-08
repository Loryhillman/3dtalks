const path = require('node:path');
function registerRoomPages(app) {
  const roomsMode = process.env.APP_MODE === 'rooms';
  if (roomsMode && process.env.ROOMS_ENABLED !== 'true') throw new Error('APP_MODE=rooms requires ROOMS_ENABLED=true');
  if (process.env.ROOMS_ENABLED !== 'true') return;
  const page = file => (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.resolve(__dirname, '../../public', file)); };
  app.get('/rooms', page('rooms.html'));
  app.get('/join/:slug', page('rooms.html'));
  app.get('/play', (req, res) => {
    if (!/^[a-z0-9-]{3,80}$/.test(req.query.room || '') || req.query.room === 'main') return res.redirect('/rooms');
    return page('index.html')(req, res);
  });
  if (roomsMode) {
    for (const url of ['/admin', '/admin.html', '/admin_rooms.html']) app.get(url, page('admin_rooms.html'));
    for (const url of ['/', '/index.html']) app.get(url, (req, res) => {
      if (typeof req.query.room === 'string' && /^[a-z0-9-]{3,80}$/.test(req.query.room) && req.query.room !== 'main') return res.redirect('/join/' + encodeURIComponent(req.query.room));
      return page('rooms.html')(req, res);
    });
  }
}
module.exports = { registerRoomPages };
