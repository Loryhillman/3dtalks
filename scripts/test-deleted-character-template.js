const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual pre-player template loader without WebGL or a server.
const source = fs.readFileSync(path.join(__dirname, '../public/js/main.js'), 'utf8');
const start = source.indexOf('    const loadTemplateFromApi =');
const end = source.indexOf('    // 在创建 Player 之前', start);
assert(start >= 0 && end > start);
const loader = source.slice(start, end);

async function run(response, templateId = 'removed') {
  const storage = { selectedTemplateId: templateId, selectedTemplateGlbUrl: '/uploads/old.glb',
    selectedTemplateAnim_idle: '/uploads/old-idle.glb', selectedTemplateWeaponConfig: '{}', token: 'keep' };
  Object.defineProperties(storage, {
    removeItem: { value(key) { delete this[key]; } },
    setItem: { value(key, value) { this[key] = String(value); } }
  });
  const context = {
    localStorage: storage, selectedTemplateId: templateId,
    selectedGlbUrl: '/uploads/old.glb', selectedWeaponConfig: { weapon_id: 'old' },
    selectedAnimUrls: { idle: '/uploads/old-idle.glb' }, MVP_ANIM_KEYS: ['idle'],
    _currentTmplData: { id: templateId }, console: { log() {}, warn() {}, info() {} },
    fetch: async () => response
  };
  try {
    const value = await vm.runInNewContext(loader + '\nloadTemplateFromApi(selectedGlbUrl)', context);
    return { context, storage, value };
  } catch (error) { return { context, storage, error }; }
}

(async () => {
  const deleted = await run({ ok: true, json: async () => ({ templates: [] }) });
  assert.equal(deleted.value, null);
  assert.equal(deleted.context.selectedGlbUrl, null);
  assert.equal(deleted.context.selectedWeaponConfig, null);
  assert.equal(Object.keys(deleted.context.selectedAnimUrls).length, 0);
  assert.deepEqual(Object.keys(deleted.storage), ['token']);

  const existing = await run({ ok: true, json: async () => ({ templates: [
    { id: 'available', glb_url: '/uploads/old.glb', name: 'Available' }
  ] }) }, 'available');
  assert.ifError(existing.error);
  assert.equal(existing.value, '/uploads/old.glb');
  assert.equal(existing.storage.selectedTemplateId, 'available');

  for (const response of [
    { ok: false, status: 500 },
    { ok: true, json: async () => ({ error: 'temporary failure' }) },
    { ok: true, json: async () => { throw new Error('invalid JSON'); } }
  ]) {
    const failed = await run(response);
    assert(failed.error);
    assert.equal(failed.storage.selectedTemplateId, 'removed');
    assert.equal(failed.context.selectedGlbUrl, '/uploads/old.glb');
    assert.equal(failed.context.selectedAnimUrls.idle, '/uploads/old-idle.glb');
  }
  console.log('Deleted template fallback and failure preservation: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
