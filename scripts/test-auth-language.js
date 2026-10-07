/** New visitor defaults, English fallback, and localized registration failures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(require.resolve('../public/i18n/i18n.js'), 'utf8');
const catalog = locale => JSON.parse(fs.readFileSync(path.join(__dirname, '../public/i18n', locale + '.json'), 'utf8'));
async function language({ saved, server, failedCatalog } = {}) {
  const context = vm.createContext({ window: {}, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: key => key === 'preferredLocale' ? saved : null, setItem() {} },
    async fetch(url) {
      if (url === '/api/config/language') return { ok: true, json: async () => ({ language: server }) };
      const locale = url.split('/').at(-1).replace('.json', '');
      return { ok: locale !== failedCatalog, status: 404, json: async () => catalog(locale) };
    }
  });
  vm.runInContext(source, context);
  await context.window.i18n.init();
  return context.window.i18n;
}
(async () => {
  assert.equal((await language()).currentLocale, 'en-US');
  assert.equal((await language({ server: 'invalid' })).currentLocale, 'en-US');
  assert.equal((await language({ server: 'en-US', saved: 'ru-RU' })).currentLocale, 'ru-RU');
  const fallback = await language({ saved: 'ru-RU', failedCatalog: 'ru-RU' });
  assert.equal(fallback.t('world.startGame'), 'Start Game');
  const i18n = await language({ saved: 'ru-RU' });
  let response;
  const context = vm.createContext({ window: { i18n }, localStorage: { getItem() { return null; }, setItem() {} },
    fetch: async () => response, clearSession() {}, showAuth() {},
    t: (key, params) => i18n.tp('roomsLobby.' + key, params || {}) });
  const lobby = fs.readFileSync(require.resolve('../public/js/roomsLobby.js'), 'utf8');
  vm.runInContext(lobby.slice(lobby.indexOf('  async function api('), lobby.indexOf('  async function action(')), context);
  response = { ok: false, status: 429, headers: { get: () => '42' }, json: async () => ({ code: 'REGISTER_RATE_LIMITED', errorKey: 'authLimits.registerMinute', messageParams: { seconds: 42 } }) };
  await assert.rejects(context.api('/api/auth/register'), error => error.message === i18n.tp('authLimits.registerMinute', { seconds: 42 }) && error.message !== i18n.t('roomsLobby.failed'));
  response.json = async () => ({ code: 'UNKNOWN_LIMIT' });
  await assert.rejects(context.api('/api/auth/register'), error => error.message === i18n.tp('authLimits.rateLimited', { seconds: 42 }));
  console.log('English default and fallback, explicit Russian preference, localized registration cooldowns: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
