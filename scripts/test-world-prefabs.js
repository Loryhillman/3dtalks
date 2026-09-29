const assert = require('node:assert/strict');
const { getPrefab, createPrefab } = require('../src/services/worldPrefabs');
(async () => {
  assert.equal(getPrefab('unknown'), null);
  for (const kind of ['room', 'table', 'chair']) {
    const prefab = getPrefab(kind);
    assert.ok(prefab.components.length > 0);
    for (const c of prefab.components) {
      assert.equal(c.type, 'box');
      assert.ok([c.width, c.height, c.depth].every(n => n > 0));
    }
  }
  assert.equal(getPrefab('room').collision, true);
  // Room entrance is four world units wide and 4.8 units high.
  const front = getPrefab('room').components.filter(c => c.position.z === 8);
  assert.equal(front.length, 3);
  assert.ok(front.every(c => c.position.y - c.height / 2 >= 4.8 ||
    Math.abs(c.position.x) - c.width / 2 >= 2));
  for (const fail of [false, true]) {
    const calls = [];
    let released = false;
    const pool = { connect: async () => ({
      query: async (sql, values) => {
        calls.push({ sql, values });
        if (sql.includes('INSERT INTO geometry_buildings')) return { rows: [{ id: 42 }] };
        if (sql.includes('INSERT INTO world_objects')) {
          if (fail) throw new Error('Simulated insert failure');
          assert.equal(values[2], 'geometry_building:42');
          assert.deepEqual(values.slice(3, 6), [10, 0, 20]);
          return { rows: [{ id: 99 }] };
        }
      }, release: () => { released = true; }
    }) };
    const result = createPrefab(pool, 'chair', 'Chair', { x: 10, y: 0, z: 20 }, 1);
    if (fail) await assert.rejects(result, /Simulated/);
    else assert.equal((await result).id, 99);
    assert.equal(calls.at(-1).sql, fail ? 'ROLLBACK' : 'COMMIT');
    assert.ok(released);
  }
  console.log('Prefab geometry and atomic persistence checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
