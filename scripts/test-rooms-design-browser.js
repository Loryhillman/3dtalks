const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const { chromium } = require('playwright');

// Real page/scripts/styles, fixture API. Does not start Docker or use a database.
const app = express();
app.use(express.json());
app.get(['/rooms', '/join/:slug'], (_req, res) => res.sendFile(path.resolve(__dirname, '../public/rooms.html')));
app.use(express.static(path.resolve(__dirname, '../public')));
const mutations = [];
const commands = [];
const fixtureRooms = [
  { id: 'room', slug: 'test-room', name: 'Переговорная ' + 'ОченьДлинноеИмя'.repeat(6), status: 'open', capacity: 6, revision: 1, active: 2, held: 1, available: 3 },
  { id: 'closed', slug: 'closed-room', name: 'Закрытая комната', status: 'closed', allow_rejoin: true, capacity: 3, revision: 2, active: 1, held: 1, available: 1 },
  { id: 'ended', slug: 'ended-room', name: 'Завершённая встреча', status: 'closed', allow_rejoin: false, capacity: 4, revision: 3, active: 0, held: 0, available: 4 },
  { id: 'draft', slug: 'draft-room', name: 'Черновик', status: 'draft', capacity: 6, revision: 4, active: 0, held: 0, available: 6 }
];
app.use('/api', (req, res) => {
  if (req.path === '/config/language') return res.json({ language: 'ru-RU' });
  if (req.path === '/auth/security-questions') return res.json({ questions: [{ id: 1, question_text: 'Test question' }] });
  if (req.path === '/auth/login') return res.json({ token: 'fixture', userId: 'user', characterId: 'character' });
  if (req.headers.authorization !== 'Bearer fixture') return res.sendStatus(401);
  if (req.path === '/auth/me') return res.json({ user: { id: 'user' }, characterId: 'character' });
  if (req.path === '/my/rooms') {
    if (req.method === 'POST') { mutations.push(req.body); return res.json({ room: { id: 'room' } }); }
    return res.json({ quota: { used: fixtureRooms.length, limit: 5 }, rooms: fixtureRooms });
  }
  if (req.path.startsWith('/my/rooms/') && req.method !== 'GET') { commands.push({ path: req.path, method: req.method, body: req.body }); return res.json({ success: true }); }
  if (req.path === '/rooms/test-room') return res.json({ room: { name: 'Переговорная', capacity: 6 } });
  res.sendStatus(404);
});

async function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  try { await fs.access(chromium.executablePath()); return chromium.executablePath(); } catch (_) {}
  for (const entry of await fs.readdir('/root/.cache/ms-playwright')) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = path.join('/root/.cache/ms-playwright', entry, 'chrome-linux64/chrome');
    try { await fs.access(candidate); return candidate; } catch (_) {}
  }
  throw new Error('Chromium is not installed');
}

let server, browser;
(async () => {
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  browser = await chromium.launch({ executablePath: await executable(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = 'http://127.0.0.1:' + server.address().port;
  await page.goto(base + '/rooms');
  await page.locator('#auth').waitFor();
  assert.equal(await page.evaluate(() => document.body.getBoundingClientRect().height >= innerHeight), true, 'light background fills the viewport before login');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Inter' && font.status === 'loaded')), true, 'local Inter loads');
  await page.locator('#auth-toggle').click();
  assert.equal(await page.locator('#registration input[name=email]').evaluate(node => node.required), true);
  await page.locator('#auth-toggle').click();
  await page.locator('[name=username]').fill('Test user');
  await page.locator('[name=password]').fill('fixture-password');
  await page.locator('#auth-submit').click();
  await page.locator('#rooms article').first().waitFor();
  assert.equal(await page.locator('#rooms a').getAttribute('href'), '/play?room=test-room');
  const text = require('../public/i18n/ru-RU.json').roomsLobby;
  assert.equal(await page.locator('.room-card').count(), 4);
  for (const [index, expected, absent] of [
    [0, [text.rename, text.closeAction, text.end, text.delete], [text.openAction, text.capacity]],
    [1, [text.openAction, text.end], [text.closeAction, text.capacity]],
    [2, [text.openAction, text.capacity], [text.end, text.closeAction]],
    [3, [text.openAction, text.capacity], [text.end, text.closeAction]]
  ]) {
    const labels = await page.locator('.room-card').nth(index).locator('.room-menu-items button').allTextContents();
    for (const label of expected) assert(labels.includes(label), 'available room action: ' + label);
    for (const label of absent) assert(!labels.includes(label), 'unavailable action is absent: ' + label);
  }
  const firstMenu = page.locator('.room-menu').first();
  await firstMenu.locator('summary').focus(); await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), text.rename, 'keyboard enters room actions');
  await page.keyboard.press('Escape');
  assert.equal(await firstMenu.getAttribute('open'), null);
  await firstMenu.locator('summary').click();
  await page.locator('.room-menu').nth(1).locator('summary').click();
  assert.equal(await firstMenu.getAttribute('open'), null, 'opening another menu closes the previous one');
  await page.locator('.rooms-dashboard-heading h1').click();
  assert.equal(await page.locator('.room-menu[open]').count(), 0);
  page.once('dialog', dialog => dialog.accept('Renamed room'));
  await firstMenu.locator('summary').click();
  await firstMenu.getByRole('button', { name: text.rename, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.deepEqual(commands[0], { path: '/my/rooms/room', method: 'PATCH', body: { revision: 1, name: 'Renamed room' } });
  await page.setViewportSize({ width: 1440, height: 900 });
  const toggle = page.locator('.shell-toggle');
  await toggle.click();
  await page.waitForFunction(() => Math.round(document.querySelector('.shell-sidebar').getBoundingClientRect().width) === 64);
  assert.equal(await page.locator('.shell-sidebar').evaluate(node => node.getBoundingClientRect().width), 64);
  await page.reload();
  await page.locator('#rooms article').first().waitFor();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'collapsed state survives reload');
  const roomsLink = page.locator('.shell-nav a[href="/rooms"]');
  await roomsLink.focus();
  assert.equal(await roomsLink.locator('span').evaluate(node => getComputedStyle(node).visibility), 'visible', 'collapsed label is visible on keyboard focus');
  assert.equal(await roomsLink.getAttribute('aria-current'), 'page');
  await toggle.click();
  await page.waitForFunction(() => Math.round(document.querySelector('.shell-sidebar').getBoundingClientRect().width) === 248);
  await page.locator('.shell-account summary').click();
  assert.equal(await page.locator('.shell-account').getAttribute('open'), '');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.shell-account').getAttribute('open'), null);
  for (const width of [320, 390, 768, 1200, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForFunction(() => Math.abs(document.querySelector('.shell-header').getBoundingClientRect().left - (innerWidth < 768 ? 0 : document.querySelector('.shell-sidebar').getBoundingClientRect().width)) < 1);
    const columns = await page.locator('#rooms').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    assert.equal(columns, width >= 1440 ? 3 : width === 1200 ? 2 : 1, 'grid uses available content width at ' + width);
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, nodes: [...document.querySelectorAll('body *')].filter(node => node.getBoundingClientRect().right > innerWidth + 1).map(node => node.className || node.id || node.tagName).slice(0, 8) }));
    assert(overflow.scroll <= width, 'no page overflow: ' + JSON.stringify(overflow));
    if (width < 768) {
      const targets = await page.locator('button:visible, input:visible, select:visible').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
      assert(targets.every(height => height >= 44), 'mobile controls have 44px targets');
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await toggle.click();
  assert.equal(await page.locator('.shell-sidebar').getAttribute('aria-modal'), 'true');
  assert.equal(await page.locator('main').evaluate(node => node.inert), true);
  assert.equal(await page.locator('body').evaluate(node => node.style.overflow), 'hidden');
  await page.locator('.shell-nav a').last().focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('shell-brand')), true, 'Tab wraps inside the drawer');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/avatar.html');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('main').evaluate(node => node.inert), false);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('shell-toggle')), true, 'closing returns focus');
  await toggle.click();
  await page.locator('.shell-backdrop').click({ position: { x: 350, y: 300 } });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  await page.locator('.shell-close').click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  await page.setViewportSize({ width: 1440, height: 900 });
  assert.equal(await page.locator('main').evaluate(node => node.inert), false, 'breakpoint change releases drawer focus/scroll lock');
  await page.locator('#create-launcher').click();
  await page.locator('#create [name=name]').fill('New room');
  await page.locator('#create [type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#create button').disabled);
  assert.deepEqual(Object.keys(mutations[0]).sort(), ['capacity', 'name', 'request_key']);
  assert.equal(mutations[0].capacity, 6);
  await page.locator('#create-panel > summary').click();
  // Hidden form retains its native controls; use the invitation field for focus checks.
  await page.locator('#join input[name=link]').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'keyboard focus is visible');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('#refresh').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
  const cover = page.locator('.room-cover').first();
  await cover.locator('img').evaluate(node => node.dispatchEvent(new Event('error')));
  assert.equal(await cover.locator('img').isVisible(), false);
  assert.equal(await cover.locator('.room-cover-caption').isVisible(), true, 'failed cover retains a labelled fallback');
  const ratio = await cover.evaluate(node => node.getBoundingClientRect().width / node.getBoundingClientRect().height);
  assert(Math.abs(ratio - 16 / 9) < .01, 'fallback preserves 16:9 layout');
  await page.evaluate(() => scrollTo(0, 100));
  assert.equal(await page.locator('.shell-header').evaluate(node => Math.round(node.getBoundingClientRect().top)), 0, 'header stays at the top while scrolling');
  assert.equal(await page.locator('.shell-header').evaluate(node => node.getBoundingClientRect().height), 64);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: '/tmp/rooms-design-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/rooms-design-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/join/test-room');
  await page.locator('#enter').waitFor();
  assert.equal(await page.locator('#enter').getAttribute('href'), '/play?room=test-room');
  await page.locator('.shell-account summary').click();
  await page.locator('#logout').click();
  await page.locator('#auth').waitFor();
  assert.equal(await page.locator('.shell-sidebar').isVisible(), false, 'account navigation hides on logout');
  assert.equal(await page.evaluate(() => localStorage.getItem('token')), null);
  assert.deepEqual(errors, []);
  console.log('Rooms design: responsive cards/covers/fallback, state-based actions/revision, menus, auth/invitation/creation, shell, keyboard, logout and reduced motion OK (fixture API)');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
