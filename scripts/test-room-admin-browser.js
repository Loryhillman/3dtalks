const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { registerRoomPages } = require('../src/routes/roomPages');
process.env.APP_MODE = 'rooms'; process.env.ROOMS_ENABLED = 'true';
const app = express(); app.use(express.json()); registerRoomPages(app);
app.use(express.static(path.resolve(__dirname, '../public')));
let modelCount = 1, creates = 0, language = 'en-US', uploads = 0, savedProfile = null, denyUsers = false;
const calls = [], unexpected = [];
app.use('/api', (req, res) => {
  calls.push(req.method + ' ' + req.path);
  if (denyUsers && req.path === '/admin/users') return res.status(401).json({ error: 'Expired' });
  if (req.path === '/config/language' && req.method === 'GET') return res.json({ language });
  if (req.headers.authorization !== 'Bearer fixture-admin') return res.status(401).json({ error: 'Unauthorized' });
  if (req.path === '/admin-auth/verify') return res.json({ success: true, adminUser: { username: 'Admin', full_name: 'Fixture admin', email: 'admin@example.test' } });
  if (req.path === '/admin/rooms/templates') return res.json({ success: true, templates: [{ template_key: 'meeting', name: 'Meeting', version: 1, object_count: 7 }] });
  if (req.path === '/admin/rooms' || req.path === '/admin/rooms/') {
    if (req.method === 'POST') { creates++; return res.json({ success: true }); }
    return res.json({ success: true, rooms: [{ id: 'draft', slug: 'test-room', name: '<b>Fixture room</b>', status: 'draft', capacity: 6, object_count: 7, template_key: 'meeting', template_version: 1 }] });
  }
  if (req.path === '/admin/rooms/models/upload') {
    uploads++; modelCount++;
    return res.json({ success: true, model: { id: modelCount, display_name: 'Uploaded fixture', path: '/models/uploaded/fixture.glb' } });
  }
  if (req.path === '/admin/rooms/models') return res.json({ success: true, models: Array.from({ length: modelCount }, (_, i) => ({ id: i + 1, name: 'Chair ' + i, file_type: 'glb', path: '/models/fixture.glb' })) });
  if (req.path === '/admin/users') return res.json({ success: true, users: [{ username: '<script>unsafe</script>', email: 'user@example.test', created_at: '2026-01-01', room_count: 3 }], nextOffset: req.query.offset === '0' ? 50 : null });
  if (req.path === '/admin-auth/profile') { savedProfile = req.body; return res.json({ success: true }); }
  if (req.path === '/config/language' && req.method === 'PUT') { language = req.body.language; return res.json({ success: true }); }
  if (req.path === '/admin-auth/change-password') return res.json({ success: true });
  unexpected.push(req.path); res.status(404).json({ error: 'Unexpected legacy API' });
});
const server = http.createServer(app);
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(); const errors = [], scripts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (req.url().includes('/js/')) scripts.push(req.url()); });
  const seed = () => {
    if (!sessionStorage.getItem('fixture-seeded')) {
      localStorage.setItem('adminToken', 'fixture-admin'); sessionStorage.setItem('fixture-seeded', '1');
    }
  };
  await page.addInitScript(seed);
  await page.goto(base + '/admin.html'); await page.waitForSelector('#admin-app:not([hidden])');
  assert.equal(await page.locator('[data-panel]').count(), 4);
  assert.equal(await page.locator('#rooms-admin-list b').count(), 0, 'room names are text, not HTML');
  assert.equal(await page.locator('#room-template-list a').getAttribute('href'), '/room_editor.html?template=meeting');
  await page.locator('#room-create-name').fill('New room'); await page.locator('#room-create-form button').click();
  await page.waitForFunction(() => document.querySelector('#room-create-message').textContent.includes('created'));
  assert.equal(creates, 1);
  await page.locator('[data-panel="models"]').click(); await page.waitForSelector('#admin-models tbody tr');
  await page.locator('#model-file').setInputFiles({ name: 'chair.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('fixture') });
  await page.locator('#model-upload-form button').click(); await page.waitForFunction(() => document.querySelectorAll('#admin-models tbody tr').length === 2);
  assert.equal(uploads, 1);
  await page.locator('[data-panel="users"]').click(); await page.waitForSelector('#admin-users tbody tr');
  assert.equal(await page.locator('#admin-users script').count(), 0);
  await page.locator('#users-more').click(); await page.waitForFunction(() => document.querySelectorAll('#admin-users tbody tr').length === 2);
  assert(await page.locator('#users-more').isHidden());
  await page.locator('[data-panel="settings"]').click();
  await page.locator('#profile-name').fill('Updated admin'); await page.locator('#profile-form button').click();
  await page.waitForFunction(() => document.querySelector('#admin-name').textContent === 'Updated admin');
  assert.equal(savedProfile.full_name, 'Updated admin');
  await page.locator('#default-language').selectOption('ru-RU'); await page.locator('#language-form button').click();
  await page.waitForFunction(() => document.querySelector('#admin-message').textContent === 'Saved');
  assert.equal(language, 'ru-RU');
  await page.locator('#admin-locale').selectOption('ru-RU'); await page.waitForFunction(() => document.documentElement.lang === 'ru');
  assert.equal(await page.locator('h1').textContent(), 'Управление переговорными');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const panel of ['rooms', 'models', 'users', 'settings']) {
    await page.locator('[data-panel="' + panel + '"]').click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), panel + ' mobile layout does not overflow');
  }
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  assert(scripts.every(src => !/\/admin\.js|adminConfig|adminSky|adminAgent|adminMaintenance/.test(src)));
  await page.locator('#admin-logout').click(); await page.waitForURL('**/admin_login.html');
  assert.equal(await page.evaluate(() => localStorage.getItem('adminToken')), null);
  const guest = await browser.newPage(); await guest.goto(base + '/admin.html'); await guest.waitForURL('**/admin_login.html');
  const expired = await browser.newPage(); await expired.addInitScript(seed);
  await expired.goto(base + '/admin.html'); await expired.waitForSelector('#admin-app:not([hidden])');
  denyUsers = true; await expired.locator('[data-panel="users"]').click(); await expired.waitForURL('**/admin_login.html');
  assert.equal(await expired.evaluate(() => localStorage.getItem('adminToken')), null, 'expired administrator session cleared');
  assert(calls.some(call => call === 'POST /admin/rooms/models/upload'));
  console.log('Room admin Chromium: dedicated page, drafts/templates, authenticated model upload, users, profile/language, mobile layout and sign-in redirect OK (fixture API)');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
});
