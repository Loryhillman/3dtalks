const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function context(entries = {}, templates = []) {
  const values = { ...entries }, reads = [], calls = [];
  const storage = new Proxy(values, { get(target, key) {
    if (key === 'getItem') return name => { reads.push(name); return target[name] ?? null; };
    if (key === 'setItem') return (name, value) => { target[name] = String(value); };
    if (key === 'removeItem') return name => { delete target[name]; };
    return target[key];
  } });
  const ctx = { console: { log() {}, warn() {}, info() {} }, localStorage: storage,
    i18n: { t: key => key }, fetch: async url => {
      calls.push(url);
      return { ok: true, json: async () => url === '/api/my/avatar'
        ? { config: { mode: 'standard', headType: 'cube' } } : { templates } };
    } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const file of ['legacyAvatarSession.js', 'roomAvatarSession.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../public/js/' + file), 'utf8'), ctx);
  }
  return { ctx, values, reads, calls };
}
(async () => {
  const room = context({ token: 'account-token', selectedTemplateId: 'old', selectedTemplateWeaponConfig: 'broken JSON' });
  const account = await room.ctx.RoomAvatarSession.prepare();
  assert.equal(account.accountAvatar.headType, 'cube');
  assert.equal(account.selectedGlbUrl, null); assert.equal(account.selectedWeaponConfig, null);
  assert.deepEqual(room.reads, ['token']); assert.deepEqual(room.calls, ['/api/my/avatar']);
  const defaultWorld = context(); const defaultSession = await defaultWorld.ctx.LegacyAvatarSession.prepare();
  assert.equal(defaultSession.finalGlbUrl, null); assert.deepEqual(defaultWorld.calls, []);
  const old = context({ selectedTemplateId: '1' }, [{ id: 1, glb_url: '/legacy.glb', anim_walk_url: '/walk.glb', bone_mapping_config: { head: 'Head' }, weapon_id: 2, weapon_config: { power: 5 } }]);
  const legacy = await old.ctx.LegacyAvatarSession.prepare();
  assert.equal(legacy.finalGlbUrl, '/legacy.glb'); assert.equal(legacy.selectedAnimUrls.walk, '/walk.glb');
  assert.equal(legacy.boneMapConfig.head, 'Head'); assert.equal(legacy.selectedWeaponConfig.weapon_id, 2);
  const animations = [];
  legacy.scheduleLoadAnims(legacy.selectedAnimUrls, legacy.finalGlbUrl, { _loadPlayerAnimGlb: (...args) => animations.push(args) }, 'character');
  assert.deepEqual(animations, [['character', 'walk', '/walk.glb']], 'animation loader has explicit world and character dependencies');
  const deleted = context({ token: 'account-token', selectedTemplateId: 'gone', selectedTemplateGlbUrl: '/uploads/gone.glb' });
  assert.equal((await deleted.ctx.LegacyAvatarSession.prepare()).finalGlbUrl, null);
  assert.equal(deleted.values.selectedTemplateId, undefined); assert.equal(deleted.values.token, 'account-token');
  room.ctx.fetch = async () => ({ ok: false });
  await assert.rejects(room.ctx.RoomAvatarSession.prepare(), /avatar.SERVICE_ERROR/);
  room.ctx.fetch = async () => ({ ok: true, json: async () => ({ config: [] }) });
  await assert.rejects(room.ctx.RoomAvatarSession.prepare(), /avatar.SERVICE_ERROR/);
  console.log('Avatar sessions: account/legacy storage separation, explicit animation dependencies, deleted-template cleanup and failed account requests OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
