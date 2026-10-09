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
let commandFailure, commandGate, releaseCommand, failNextList = false;
let listGate, releaseList, roomOverride, quotaOverride, listGets = 0;
const fixtureRooms = [
  { id: 'room', slug: 'test-room', name: 'Переговорная ' + 'ОченьДлинноеИмя'.repeat(6), status: 'open', capacity: 6, revision: 1, active: 2, held: 1, available: 3 },
  { id: 'closed', slug: 'closed-room', name: 'Закрытая комната', status: 'closed', allow_rejoin: true, capacity: 3, revision: 2, active: 1, held: 1, available: 1 },
  { id: 'ended', slug: 'ended-room', name: 'Завершённая встреча', status: 'closed', allow_rejoin: false, capacity: 4, revision: 3, active: 0, held: 0, available: 4 },
  { id: 'draft', slug: 'draft-room', name: 'Черновик', status: 'draft', capacity: 6, revision: 4, active: 0, held: 0, available: 6 }
];
app.use('/api', async (req, res) => {
  if (req.path === '/config/language') return res.json({ language: 'ru-RU' });
  if (req.path === '/auth/security-questions') return res.json({ questions: [{ id: 1, question_text: 'Test question' }] });
  if (req.path === '/auth/login') return res.json({ token: 'fixture', userId: 'user', characterId: 'character' });
  if (req.headers.authorization !== 'Bearer fixture') return res.sendStatus(401);
  if (req.path === '/auth/me') return res.json({ user: { id: 'user' }, characterId: 'character' });
  if (req.path === '/my/rooms') {
    if (req.method === 'POST') { mutations.push(req.body); return res.json({ room: { id: 'room' } }); }
    listGets++;
    if (listGate) await listGate;
    if (failNextList) { failNextList = false; return res.status(500).json({ code: 'ROOM_SERVICE_ERROR' }); }
    const rooms = roomOverride || fixtureRooms;
    return res.json({ quota: quotaOverride || { used: rooms.length, limit: 5 }, rooms });
  }
  if (req.path.startsWith('/my/rooms/') && req.method !== 'GET') {
    commands.push({ path: req.path, method: req.method, body: req.body });
    if (commandGate) await commandGate;
    if (commandFailure) return res.status(409).json({ code: commandFailure });
    return res.json({ success: true });
  }
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
  assert.equal(await page.locator('h1:visible').count(), 1, 'login has a main heading');
  assert.equal(await page.evaluate(() => document.body.getBoundingClientRect().height >= innerHeight), true, 'light background fills the viewport before login');
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => [...document.fonts].some(font => font.family === 'Inter' && font.status === 'loaded')), true, 'local Inter loads');
  await page.locator('#auth-toggle').click();
  assert.equal(await page.locator('#registration input[name=email]').evaluate(node => node.required), true);
  await page.locator('#auth-toggle').click();
  await page.locator('[name=username]').fill('Test user');
  await page.locator('[name=password]').fill('fixture-password');
  listGate = new Promise(resolve => { releaseList = resolve; }); failNextList = true;
  await page.locator('#auth-submit').click();
  await page.locator('.room-skeleton').first().waitFor();
  assert.equal(await page.locator('.room-skeleton').count(), 3);
  assert.equal(await page.locator('#create-launcher').isDisabled(), true, 'unknown quota blocks creation during first load');
  releaseList(); listGate = null;
  await page.locator('#rooms-error').waitFor();
  assert.equal(await page.locator('.room-skeleton').count(), 0);
  await page.locator('#rooms-retry').click();
  await page.locator('#rooms article').first().waitFor();
  const contrasts = await page.evaluate(() => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
    };
    return ['#create-launcher', '#quota', '.room-occupancy', '.room-status--open', '.room-status--closed'].map(selector => {
      const node = document.querySelector(selector);
      let parent = node, background;
      while (parent) {
        background = getComputedStyle(parent).backgroundColor;
        if (background !== 'rgba(0, 0, 0, 0)') break;
        parent = parent.parentElement;
      }
      const foreground = luminance(getComputedStyle(node).color), backdrop = luminance(background);
      return { selector, ratio: (Math.max(foreground, backdrop) + .05) / (Math.min(foreground, backdrop) + .05) };
    });
  });
  for (const { selector, ratio } of contrasts) assert(ratio >= 4.5, selector + ' text contrast ' + ratio);
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
  await page.setViewportSize({ width: 390, height: 360 });
  await firstMenu.locator('summary').click();
  await page.waitForFunction(() => parseFloat(document.querySelector('.room-menu-items').style.top) >= 64);
  const menuBounds = await firstMenu.locator('.room-menu-items').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  });
  assert(menuBounds.top >= 64 && menuBounds.bottom <= 360 && menuBounds.left >= 0 && menuBounds.right <= 390, 'room menu stays in the visible viewport: ' + JSON.stringify(menuBounds));
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await firstMenu.locator('summary').click();
  await firstMenu.getByRole('button', { name: text.rename, exact: true }).click();
  await page.locator('#edit-dialog').waitFor();
  await page.locator('#edit-room [name=name]').fill('Renamed room');
  await page.locator('#edit-room [type=submit]').click();
  await page.locator('#edit-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(commands[0], { path: '/my/rooms/room', method: 'PATCH', body: { revision: 1, name: 'Renamed room' } });
  const openAction = async (index, label) => {
    const menu = page.locator('.room-menu').nth(index);
    await menu.locator('summary').click();
    await menu.getByRole('button', { name: label, exact: true }).click();
  };
  await openAction(0, text.rename);
  const beforeInvalid = commands.length;
  await page.locator('#edit-room [name=name]').fill('   ');
  await page.locator('#edit-room [type=submit]').click();
  assert.equal(await page.locator('#edit-room [name=name]').getAttribute('aria-invalid'), 'true');
  assert.equal(commands.length, beforeInvalid, 'whitespace name sends no request');
  commandFailure = 'ROOM_CHANGED';
  await page.locator('#edit-room [name=name]').fill('Retry name');
  await page.locator('#edit-room [type=submit]').click();
  await page.waitForFunction(() => !document.querySelector('#edit-dialog').hasAttribute('aria-busy'));
  assert.equal(await page.locator('#edit-dialog').isVisible(), true, 'failed save leaves dialog open');
  assert.equal(await page.locator('#edit-dialog [data-dialog-error]').textContent(), text.ROOM_CHANGED);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.matches('.room-menu summary')), true, 'cancel restores room action focus');
  commandFailure = null;
  await openAction(2, text.capacity);
  await page.locator('#edit-room [name=capacity]').fill('1.5');
  await page.locator('#edit-room [type=submit]').click();
  assert.equal(await page.locator('#edit-room [name=capacity]').getAttribute('aria-invalid'), 'true');
  await page.locator('#edit-room [name=capacity]').fill('2');
  await page.locator('#edit-room [type=submit]').click();
  await page.locator('#edit-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(commands.at(-1), { path: '/my/rooms/ended', method: 'PATCH', body: { revision: 3, capacity: 2 } });
  await openAction(0, text.end);
  assert.equal(await page.locator('#confirm-description').textContent(), text.endConsequences);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), text.cancel, 'dangerous dialog initially focuses Cancel');
  const beforeEnd = commands.length;
  commandGate = new Promise(resolve => { releaseCommand = resolve; });
  await page.locator('#confirm-submit').click();
  await page.waitForFunction(() => document.querySelector('#confirm-dialog').getAttribute('aria-busy') === 'true');
  await page.evaluate(() => document.querySelector('#confirm-room').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#confirm-dialog').isVisible(), true, 'in-flight operation cannot be accidentally dismissed');
  releaseCommand(); commandGate = null;
  await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
  assert.equal(commands.length, beforeEnd + 1, 'double submit sends one mutation');
  assert.deepEqual(commands.at(-1), { path: '/my/rooms/room/end', method: 'POST', body: { revision: 1 } });
  await openAction(0, text.delete);
  assert.equal(await page.locator('#confirm-description').textContent(), text.deleteConsequences);
  await page.locator('#confirm-dialog [data-dialog-close]').first().click();
  assert.equal(await page.locator('#confirm-dialog').isVisible(), false);
  await openAction(0, text.delete);
  commandFailure = 'ROOM_CHANGED';
  await page.locator('#confirm-submit').click();
  await page.waitForFunction(() => !document.querySelector('#confirm-dialog').hasAttribute('aria-busy'));
  assert.equal(await page.locator('#confirm-dialog').isVisible(), true);
  commandFailure = null; failNextList = true;
  await page.locator('#confirm-submit').click();
  await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(expected => [...document.querySelectorAll('.ui-toast')].some(node => node.textContent.includes(expected)), text.savedRefreshFailed);
  assert.deepEqual(commands.at(-1), { path: '/my/rooms/room', method: 'DELETE', body: { revision: 1 } });
  assert.equal(await page.locator('.room-card').count(), 4, 'failed refresh retains previous cards after successful mutation');
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
  await page.locator('#create-dialog').waitFor();
  await page.locator('#create-dialog [data-dialog-close]').first().focus();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.matches('#create [type=submit]')), true, 'dialog traps reverse Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.matches('#create-dialog [data-dialog-close]')), true, 'dialog traps forward Tab');
  assert.equal(await page.locator('#create [name=template_key]').count(), 0, 'single standard template sends no invented field');
  for (const viewport of [{ width: 320, height: 360 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const bounds = await page.locator('#create-dialog').evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, fitsContent: node.scrollWidth <= node.clientWidth };
    });
    assert(bounds.left >= 0 && bounds.right <= viewport.width && bounds.top >= 0 && bounds.bottom <= viewport.height && bounds.fitsContent, 'modal fits narrow/short viewport');
  }
  await page.screenshot({ path: '/tmp/rooms-create-dialog-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#create [name=name]').fill('New room');
  await page.locator('#create [type=submit]').click();
  await page.locator('#create-dialog').waitFor({ state: 'hidden' });
  assert.deepEqual(Object.keys(mutations[0]).sort(), ['capacity', 'name', 'request_key']);
  assert.equal(mutations[0].capacity, 6);
  quotaOverride = { used: 5, limit: 5 };
  await page.locator('#refresh').click();
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(await page.locator('#quota-notice').isVisible(), true);
  assert.equal(await page.locator('#create-launcher').isDisabled(), true, 'quota is not undone by action cleanup');
  quotaOverride = null; roomOverride = [];
  await page.locator('#refresh').click();
  await page.locator('#rooms-empty').waitFor();
  await page.locator('#empty-create').click();
  await page.locator('#create-dialog').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#create-dialog').isVisible(), false);
  roomOverride = null;
  await page.locator('#refresh').click();
  await page.locator('.room-card').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  const oldNames = await page.locator('.room-card h3').allTextContents();
  failNextList = true;
  await page.locator('#refresh').click();
  await page.locator('#rooms-error').waitFor();
  assert.deepEqual(await page.locator('.room-card h3').allTextContents(), oldNames);
  assert.equal(await page.locator('#rooms-error-text').textContent(), text.staleRooms);
  await page.evaluate(() => {
    window.testOnline = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => window.testOnline });
    window.dispatchEvent(new Event('offline'));
  });
  await page.locator('#offline-notice').waitFor();
  assert.equal(await page.locator('#create-launcher').isDisabled(), true);
  assert.equal(await page.locator('#refresh').isDisabled(), true);
  assert.equal(await page.locator('.room-copy').first().isDisabled(), false, 'cached invitations can still be copied offline');
  const beforeRecovery = listGets;
  await page.evaluate(() => { window.testOnline = true; window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('online')); });
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(listGets, beforeRecovery + 1, 'recovery triggers one read, never replays a mutation');
  assert.equal(await page.locator('#offline-notice').isVisible(), false);
  assert.equal(await page.locator('#rooms-error').isVisible(), false);
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
  assert.equal(await page.locator('h1:visible').count(), 1, 'invitation has a main heading');
  assert.equal(await page.locator('#enter').getAttribute('href'), '/play?room=test-room');
  await page.locator('.shell-account summary').click();
  await page.locator('#logout').click();
  await page.locator('#auth').waitFor();
  assert.equal(await page.locator('.shell-sidebar').isVisible(), false, 'account navigation hides on logout');
  assert.equal(await page.evaluate(() => localStorage.getItem('token')), null);
  // Verify notification queue and lifetimes with the real shared component.
  await page.clock.install();
  await page.evaluate(() => {
    window.toastFixture = new AppToasts(() => 'Dismiss');
    toastFixture.show('Success fixture', 'success');
    toastFixture.show('Info fixture', 'info');
    toastFixture.show('Error fixture', 'error');
    toastFixture.show('Queued fixture', 'info');
  });
  assert.equal(await page.locator('.ui-toast').count(), 3);
  await page.clock.runFor(4000);
  assert.equal(await page.locator('.ui-toast').count(), 3);
  assert.equal(await page.getByText('Queued fixture', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('Success fixture', { exact: true }).count(), 0);
  await page.clock.runFor(1000);
  assert.equal(await page.getByText('Info fixture', { exact: true }).count(), 0);
  await page.clock.runFor(5000);
  assert.equal(await page.getByText('Error fixture', { exact: true }).isVisible(), true, 'errors never auto-dismiss');
  await page.locator('.ui-toast--error button').click();
  assert.equal(await page.locator('.ui-toast').count(), 0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => toastFixture.show('Animated fixture', 'success'));
  await page.clock.runFor(4000);
  assert.equal(await page.locator('.ui-toast--leaving').count(), 1, 'normal motion animates dismissal');
  await page.clock.runFor(200);
  assert.equal(await page.locator('.ui-toast').count(), 0);
  await page.setViewportSize({ width: 320, height: 360 });
  await page.evaluate(() => {
    for (let index = 0; index < 3; index++) toastFixture.show(('Long notification ' + index + ' ').repeat(20), 'error');
  });
  const toastBounds = await page.locator('.ui-toasts').last().evaluate(node => {
    const rect = node.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, right: rect.right, scrollable: node.scrollHeight > node.clientHeight };
  });
  assert(toastBounds.top >= 64 && toastBounds.bottom <= 360 && toastBounds.right <= 320 && toastBounds.scrollable, 'long notifications stay below the header and scroll on short screens');
  for (let index = 0; index < 3; index++) {
    await page.locator('.ui-toast--error button').first().click();
    await page.clock.runFor(200);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const locale of ['en-US', 'ru-RU', 'zh-CN']) {
    await page.evaluate(value => { localStorage.setItem('preferredLocale', value); localStorage.setItem('token', 'fixture'); }, locale);
    await page.goto(base + '/rooms');
    await page.locator('#rooms article').first().waitFor();
    assert.equal(await page.locator('h1:visible').count(), 1, 'cabinet has a main heading');
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, locale + ' has no horizontal overflow');
      assert.equal(await page.locator('#create-launcher').textContent(), JSON.parse(await fs.readFile(path.resolve(__dirname, '../public/i18n/' + locale + '.json'), 'utf8')).roomsLobby.create);
    }
  }
  assert.deepEqual(errors, []);
  console.log('Rooms design: skeleton/retry/empty/stale/quota/offline/recovery, toast queue/lifetimes, modal contracts and existing flows OK (fixture API)');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  releaseCommand?.();
  releaseList?.();
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
