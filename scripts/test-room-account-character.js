const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createAccountCharacterService } = require('../src/services/accountCharacter');
let users = [], characters = [], appearances = [], failAppearance = false, pending = Promise.resolve();
const pool = { async connect() {
  let snapshot, unlock;
  return { release() {}, async query(sql, p = []) {
    if (sql === 'BEGIN') {
      const before = pending; pending = new Promise(resolve => { unlock = resolve; }); await before;
      snapshot = structuredClone({ users, characters, appearances }); return { rows: [] };
    }
    if (sql === 'COMMIT' || sql === 'ROLLBACK') {
      if (sql === 'ROLLBACK') ({ users, characters, appearances } = snapshot);
      unlock(); return { rows: [] };
    }
    if (sql.includes('INSERT INTO users')) { users.push({ id: p[0], username: p[1] }); return { rows: [] }; }
    if (sql.includes('FROM users')) return { rows: users.filter(u => u.id === p[0]) };
    if (sql.includes('UPDATE users')) { users.find(u => u.id === p[0]).room_character_id = p[1]; return { rows: [] }; }
    if (sql.includes('SELECT id FROM characters') && sql.includes('AND id=$2')) return { rows: characters.filter(c => c.user_id === p[0] && c.id === p[1]) };
    if (sql.includes('SELECT id FROM characters')) return { rows: characters.filter(c => c.user_id === p[0]).sort((a,b) => a.id.localeCompare(b.id)).slice(0,1) };
    if (sql.includes('INSERT INTO characters')) { characters.push({ id: p[0], user_id: p[1] }); return { rows: [] }; }
    if (sql.includes('INSERT INTO character_appearance')) {
      if (failAppearance) throw new Error('appearance error');
      if (!appearances.includes(p[0])) appearances.push(p[0]); return { rows: [] };
    }
    throw new Error(sql);
  } };
} };
(async () => {
  const service = createAccountCharacterService(pool);
  failAppearance = true;
  await assert.rejects(service.register({ username: 'Test' }), /appearance error/);
  assert.equal(users.length, 0); assert.equal(characters.length, 0);
  failAppearance = false;
  const created = await service.register({ username: 'Test' });
  assert.equal(await service.repair(created.userId), created.characterId);
  appearances = [];
  await service.repair(created.userId); assert.deepEqual(appearances, [created.characterId]);
  characters = []; appearances = [];
  const [a,b] = await Promise.all([service.repair(created.userId), service.repair(created.userId)]);
  assert.equal(a,b); assert.equal(characters.length, 1); assert.equal(appearances.length, 1);
  characters.push({ id: '00000000-0000-0000-0000-000000000000', user_id: created.userId });
  assert.equal(await service.repair(created.userId), a);
  await assert.rejects(service.repair(randomUUID()), { code: 'ACCOUNT_NOT_FOUND' });
  console.log('Account character: registration rollback, concurrent repair, appearance recovery and stable selection OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
