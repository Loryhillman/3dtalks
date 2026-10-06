const assert = require('node:assert/strict');
const { ensureRoomTemplates } = require('../src/services/roomTemplateSeed');

let layout;
const snapshots = [];
const fakePool = {
  async query(sql, values) {
    assert.match(sql, /ON CONFLICT \(template_key, version\) DO NOTHING/);
    layout = JSON.parse(values[0]);
    snapshots.push({ sql, layout });
  }
};

(async () => {
  await ensureRoomTemplates(fakePool);
  assert.equal(layout.length, 8);
  assert.equal(layout.filter(item => item.kind === 'room').length, 1);
  assert.equal(layout.filter(item => item.kind === 'table').length, 1);
  const chairs = layout.filter(item => item.kind === 'chair');
  assert.equal(chairs.length, 6);
  assert.equal(new Set(chairs.map(item =>
    `${item.position.x}/${item.position.z}`)).size, 6);
  assert.ok(layout.every(item => item.collision === true && item.components.length > 0));
  assert.equal(snapshots.length, 3);
  assert.equal(snapshots[2].layout.find(item => item.kind === 'room').components.length, 6);
  assert.ok(snapshots[0].layout.every(item => !item.seats), 'v1 must remain unchanged');
  assert.equal(chairs.flatMap(item => item.seats).length, 6);
  assert.equal(new Set(chairs.flatMap(item => item.seats.map(s => s.label))).size, 6);
  console.log('Room template snapshot: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
