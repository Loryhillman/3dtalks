const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = { console, URL }; context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../public/js/lib/three.min.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(require.resolve('../public/js/roomSeatAvatar.js'), 'utf8'), context);
const T = context.THREE;
// First frames and failed GLB downloads must render the procedural avatar.
const waiting = new T.Group();
const fallback = new T.Group(); waiting.add(fallback);
waiting.userData.seatFallbackParts = [fallback];
for (let i = 0; i < 3; i++) {
  waiting.position.set(0, 1, 0);
  assert.equal(context.RoomSeatAvatar.apply(waiting), false);
  assert.equal(fallback.visible, true);
  assert.equal(waiting.position.y, 1.3);
}
waiting.userData.glbModel = new T.Group(); waiting.add(waiting.userData.glbModel);
assert.equal(context.RoomSeatAvatar.apply(waiting), true);
assert.equal(waiting.userData.glbModel.visible, false);
const group = new T.Group(), model = new T.Group(); group.add(model);
group.position.set(3, 1, 2); group.rotation.y = .8; model.scale.setScalar(2);
group.userData.glbModel = model;
const bone = (name, parent, x, y) => { const b = new T.Bone(); b.name = name; b.position.set(x,y,0); parent.add(b); return b; };
const hips = bone('mixamorig:Hips', model, 0, 1);
const pairs = [];
for (const side of ['Left', 'Right']) {
  const thigh = bone('mixamorig:'+side+'UpLeg', hips, side === 'Left' ? -.1 : .1, -.1);
  const calf = bone('mixamorig:'+side+'Leg', thigh, 0, -.5);
  const foot = bone('mixamorig:'+side+'Foot', calf, 0, -.5);
  pairs.push([thigh, calf, foot]);
}
const head = bone('mixamorig:Head', hips, 0, 1);
const pose = () => context.RoomSeatAvatar.apply(group, { yaw: .5, pitch: .2 });
assert.equal(pose(), false);
group.updateWorldMatrix(true,true);
assert.ok(hips.getWorldPosition(new T.Vector3()).distanceTo(group.getWorldPosition(new T.Vector3())) < 1e-7);
const forward = new T.Vector3(0,0,1).applyQuaternion(group.quaternion);
for (const [thigh, calf, foot] of pairs) {
  const legDirection = calf.getWorldPosition(new T.Vector3()).sub(thigh.getWorldPosition(new T.Vector3())).normalize();
  assert.ok(legDirection.dot(forward) > .999);
  const lower = foot.getWorldPosition(new T.Vector3()).sub(calf.getWorldPosition(new T.Vector3())).normalize();
  assert.ok(lower.y < -.999);
}
const position = model.position.clone(), rotation = head.quaternion.clone();
for (let i=0;i<100;i++) pose();
assert.ok(model.position.distanceTo(position) < 1e-7, 'pose must not drift between frames');
assert.ok(head.quaternion.angleTo(rotation) < 1e-7, 'head rotation must not accumulate');
group.userData.glbModel = new T.Group(); group.add(group.userData.glbModel);
assert.equal(pose(), true);
assert.equal(group.userData.glbModel.visible, false);
console.log('Room seat avatar: oriented leg chains, hip alignment, stable head and unsupported model fallback OK');
