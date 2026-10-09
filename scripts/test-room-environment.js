const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const E = require('../public/js/roomEnvironment');
const { validLayout } = require('../src/services/roomTemplateLayout');
const { roomSeatPose } = require('../src/services/roomSeatPose');
const transform = { position: { x: 10, y: 1, z: -20 }, rotation: { x: 0, y: Math.PI / 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
const environment = { version: 1, bounds: { min: { x: -4, y: 0, z: -3 }, max: { x: 4, y: 3, z: 3 } } };
const item = { type: 'room_environment', kind: 'room', name: 'Office', model_id: 1,
  model_path: '/models/uploaded/office.glb', collision: false, environment, ...transform };
const close = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
assert.equal(E.validItem(item), true);
// New data is not accepted by production layout until the complete persistence path is implemented.
assert.equal(validLayout([item]), false);
for (const invalid of [null, { ...environment, version: 2 }, { ...environment, bounds: { min: environment.bounds.max, max: environment.bounds.min } }]) {
  assert.equal(E.valid(invalid, transform), false);
}
for (const override of [{ collision: true }, { type: 'uploaded_model' }, { kind: 'furniture' }, { model_id: '1' },
  { model_path: 'https://example.test/office.glb' }, { model_path: '/models/uploaded/../office.glb' },
  { seats: [{}] }, { name: '' }, { scale: { x: -1, y: -1, z: -1 } }, { scale: { x: 1, y: 2, z: 1 } },
  { rotation: { x: .1, y: 0, z: 0 } }, { position: { x: NaN, y: 0, z: 0 } }]) assert.equal(E.validItem({ ...item, ...override }), false);
assert.equal(E.valid({ version: 1, bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 201, y: 3, z: 6 } } }, transform), false);
assert.equal(E.valid(environment, { ...transform, position: { x: 9999, y: 0, z: 0 } }), false, 'world corners must fit coordinate limits');
const edge = E.toWorld({ x: 4, y: 1, z: 0 }, transform);
close(edge.x, 10); close(edge.y, 2); close(edge.z, -24);
assert.equal(E.contains(edge, environment, transform), true);
assert.equal(E.contains({ ...edge, z: edge.z - .005 }, environment, transform), true);
assert.equal(E.contains({ ...edge, z: edge.z - .02 }, environment, transform), false);
assert.equal(E.contains(edge, environment, transform, Infinity), false);
assert.equal(E.contains({ ...edge, x: '10' }, environment, transform), false);
const box = E.worldBounds(environment, transform);
close(box.min.x, 7); close(box.max.x, 13); close(box.min.z, -24); close(box.max.z, -16);
for (const yaw of [0, Math.PI / 2, -.75, Math.PI]) {
  const t = { ...transform, rotation: { x: 0, y: yaw, z: 0 } };
  const local = { x: 2, y: 1.2, z: -2 }, roundtrip = E.toLocal(E.toWorld(local, t), t);
  for (const axis of ['x', 'y', 'z']) close(roundtrip[axis], local[axis]);
}
const millimetres = { version: 1, bounds: { min: { x: -4000, y: 0, z: -3000 }, max: { x: 4000, y: 3000, z: 3000 } } };
const millimetreTransform = { ...transform, scale: { x: .001, y: .001, z: .001 } };
assert.equal(E.valid(millimetres, millimetreTransform), true);
assert.equal(E.contains(edge, millimetres, millimetreTransform), true);
assert.equal(E.contains({ ...edge, z: edge.z - .02 }, millimetres, millimetreTransform), false, 'tolerance is in metres regardless of source units');
const resized = E.withWidth(environment, transform, 16);
assert.equal(resized.scale.x, 2); assert.equal(transform.scale.x, 1, 'resizing does not mutate the original draft');
assert.throws(() => E.withWidth(environment, transform, 500), /INVALID_ROOM_ENVIRONMENT/);
assert.throws(() => E.worldBounds({ version: 2 }, transform), /INVALID_ROOM_ENVIRONMENT/);
// Room scaling must never be reused for independent rigid seating.
const seat = { coordinate_space: 'rigid', local_position: { x: 1, y: 1, z: 1 }, local_rotation: { x: 0, y: 0, z: 0 } };
assert.deepEqual(roomSeatPose(seat, { scale_x: 1 }), roomSeatPose(seat, { scale_x: .001 }));
const context = { window: {} }; vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../public/js/roomEnvironment'), 'utf8'), context);
assert.equal(context.window.RoomEnvironment.validItem(item), true, 'same contract works as a classic browser script');
assert.equal(context.window.RoomEnvironment.contains(edge, environment, transform), true);
console.log('GLB environment contract: bounds, yaw, source units, physical sizing, invalid data and independent seating OK');
