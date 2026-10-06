const assert = require('node:assert/strict');
const { validateRoom } = require('../src/services/roomValidation');
const roomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
let seatingMode = 'free';
let seats = [];
const objects = [
  { id: 1, type: 'geometry_building', model_path: 'geometry_building:10',
    position_x: 0, position_y: 0, position_z: 0, scale_x: 1, scale_y: 1, scale_z: 1 },
  { id: 2, type: 'uploaded_model', model_path: '/models/uploaded/chair.glb',
    position_x: 1, position_y: 0, position_z: 0, scale_x: 1, scale_y: 1, scale_z: 1 }
];
const db = { async query(sql, values) {
  if (sql.includes('SELECT seating_mode')) return { rows: [{ seating_mode: seatingMode }] };
  if (sql.includes('FROM room_seats')) return { rows: seats };
  if (sql.includes('FROM world_objects')) {
    assert.deepEqual(values, [roomId]);
    return { rows: objects.map(object => ({ ...object })) };
  }
  return { rows: [{ id: 10, geometry_data: { components: [{ type: 'box' }] } }] };
} };
(async () => {
  const good = await validateRoom(roomId, db, async () => ({ isFile: () => true, size: 100 }));
  assert.equal(good.ok, true);
  assert.equal(good.objectCount, 2);
  const missing = await validateRoom(roomId, db, async () => { throw Error('missing'); });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join(' '), /Не найден файл модели/);
  objects[1].model_path = '/models/uploaded/../../secret.glb';
  const traversal = await validateRoom(roomId, db, async () => ({ isFile: () => true, size: 100 }));
  assert.equal(traversal.ok, false);
  assert.match(traversal.errors.join(' '), /Неверный путь модели/);
  objects[1].model_path = '/models/uploaded/chair.glb';
  seatingMode = 'seated';
  const stat = async () => ({ isFile: () => true, size: 100 });
  assert.match((await validateRoom(roomId, db, stat)).errors.join(' '), /Нет доступных посадочных мест/);
  const seat = { object_id: 1, label: '1', enabled: true, sort_order: 1,
    local_position: { x: 0, y: 1, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 }, map_x: 0, map_y: 0 };
  seats = [seat];
  assert.equal((await validateRoom(roomId, db, stat)).ok, true);
  seats.push({ ...seat, label: '2' });
  assert.match((await validateRoom(roomId, db, stat)).errors.join(' '), /Совпадают посадочные места/);
  console.log('Room validation: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
