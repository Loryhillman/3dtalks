const assert = require('node:assert/strict');
const { roomSeatPose } = require('../src/services/roomSeatPose');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const pose = roomSeatPose({ local_position: { x: 1, y: 2, z: 0 } },
  { position_x: 10, scale_x: 2, rotation_y: Math.PI / 2 });
close(pose.position.x, 10); close(pose.position.y, 2); close(pose.position.z, -2);
close(pose.orientation.y, Math.SQRT1_2); close(pose.orientation.w, Math.SQRT1_2);
const tilted = roomSeatPose({ local_position: { x: 1, y: 0, z: 0 }, local_rotation: { y: Math.PI / 2 } },
  { rotation_z: Math.PI / 2, rotation_x: Math.PI / 2 });
close(tilted.position.x, 0); close(tilted.position.y, 0); close(tilted.position.z, 1);
close(Object.values(tilted.orientation).reduce((sum, n) => sum + n * n, 0), 1);
assert.throws(() => roomSeatPose({ local_position: { x: Infinity } }, {}), /INVALID_SEAT_TRANSFORM/);
console.log('Room seat pose: scaling, translation, Euler rotation and invalid transforms OK');
