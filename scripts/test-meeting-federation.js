const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/js/federationUI.js'), 'utf8');
function context(pathname, search, active, readyState = 'complete') {
  const calls = { fetch: 0, alerts: [], init: 0 }; let onReady;
  const ctx = { URLSearchParams, location: { pathname, search },
    console: { log() {}, error() {} },
    document: { readyState, addEventListener(type, handler) { if(type === 'DOMContentLoaded') onReady = handler; } },
    async fetch() { calls.fetch++; throw new Error('Federation unavailable'); },
    alert(text) { calls.alerts.push(text); },
    MeetingUI: { active }, calls
  };
  ctx.window = ctx;
  vm.createContext(ctx); vm.runInContext(source, ctx);
  return { ctx, calls, ready: () => onReady?.() };
}
(async () => {
  for (const [pathname, search, active] of [
    ['/play', '?room=meeting', false], ['/play', '', false],
    ['/index.html', '?room=meeting', false], ['/index.html', '', true]
  ]) for (const state of ['loading', 'complete']) {
    const {ctx, calls, ready} = context(pathname, search, active, state);
    ready();
    // Even an explicitly constructed instance must not issue background requests.
    vm.runInContext('new FederationUI(); new FederationUI().handleError(new Error("failure"), "loadingWorldInfo");', ctx);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.fetch, 0); assert.deepEqual(calls.alerts, []);
  }
  const {ctx, calls, ready} = context('/index.html', '?room=main', false, 'loading');
  vm.runInContext('FederationUI.prototype.init = function() { calls.init++; };', ctx);
  ready(); assert.equal(calls.init, 1, 'legacy world still initializes federation');
  ctx.i18n = { tp: key => key };
  vm.runInContext('federationUI.handleError(new Error("Offline"), "loadingWorldInfo");', ctx);
  assert.equal(calls.alerts[0], 'loadingWorldInfo failed: Offline');
  ctx.i18n = { tp: () => 'Translated failure' };
  vm.runInContext('federationUI.handleError(new Error("Offline"), "loadingWorldInfo");', ctx);
  assert.equal(calls.alerts[1], 'Translated failure');
  console.log('Meeting federation: no background requests or alerts; legacy initialization and error translation fallback OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
