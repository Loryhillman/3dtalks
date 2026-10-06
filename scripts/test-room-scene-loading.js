const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { ensureRoomTemplates } = require('../src/services/roomTemplateSeed');
const context = { console, URL }; context.window = context;
vm.createContext(context);
for (const file of ['lib/three.min.js', 'geometryRenderer.js', 'world.js']) {
  vm.runInContext(fs.readFileSync(require.resolve('../public/js/'+file), 'utf8'), context);
}
(async () => {
  let layout;
  await ensureRoomTemplates({ query: async (_sql, values) => { layout = JSON.parse(values[0]); } });
  const objects = layout.map((item, i) => ({ id: i+1, type: 'geometry_building',
    geometry_data: { components: item.components }, has_collision: true,
    position_x: item.position.x, position_y: item.position.y, position_z: item.position.z,
    rotation_y: item.rotation_y, scale_x: 1, scale_y: 1, scale_z: 1 }));
  const world = { scene: new context.THREE.Scene(), loadedObjects: new Set(), generatedBuildings: new Map(), collisionObjects: [] };
  await context.World.prototype.loadRoomScene.call(world, objects);
  assert.equal(world.scene.children.length, 8);
  assert.equal(world.loadedObjects.size, 8);
  const bounds = new context.THREE.Box3().setFromObject(world.generatedBuildings.get(1).model);
  assert.ok(bounds.min.x <= -12 && bounds.max.x >= 12);
  assert.ok(bounds.max.y > 8 && bounds.min.y < 0);
  assert.ok(world.collisionObjects.length > 6);
  await context.World.prototype.loadRoomScene.call(world, objects);
  assert.equal(world.scene.children.length, 8, 'repeat loading must not duplicate geometry');
  await assert.rejects(context.World.prototype.loadRoomScene.call(world, [{ id: 999, type: 'geometry_building' }]), /geometry missing/);
  console.log('Room scene: full hall, furniture and collisions load directly without world streaming OK');
})().catch(error => { console.error(error); process.exitCode=1; });
