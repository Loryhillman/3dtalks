const assert = require('node:assert/strict');
const { listRoomObjects } = require('../src/services/roomObjects');

const roomId = '00000000-0000-0000-0000-000000000042';
const fakePool = { query: async (sql, params) => {
  if (sql.includes('FROM world_objects')) {
    assert.match(sql, /WHERE room_id = \$1/);
    assert.deepEqual(params, [roomId]);
    return { rows: [{ id: 7, room_id: roomId, type: 'geometry_building', model_path: 'geometry_building:3' }] };
  }
  assert.match(sql, /FROM geometry_buildings WHERE id = ANY/);
  assert.deepEqual(params, [[3]]);
  return { rows: [{ id: 3, geometry_data: { components: [{ type: 'box' }] } }] };
} };

(async () => {
  const objects = await listRoomObjects(roomId, fakePool);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].geometry_data.components[0].type, 'box');
  console.log('Room object scope and geometry: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
