const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { getPrefab } = require('../src/services/worldPrefabs');
const context = vm.createContext({ console, URL, window: {} });
vm.runInContext(fs.readFileSync('public/js/lib/three.min.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('public/js/geometryRenderer.js', 'utf8') + '\nthis.Renderer = GeometryRenderer;', context);
vm.runInContext(fs.readFileSync('public/js/player.js', 'utf8'), context);
const THREE = context.THREE || context.window.THREE;
assert.ok(THREE, 'Bundled THREE is available');
const Renderer = context.Renderer;
for (const angle of [0, Math.PI / 4, Math.PI / 2]) {
  for (const scale of [1, 2]) {
    const room = Renderer.renderFromComponents(getPrefab('room').components, THREE);
    room.userData.componentCollision = true;
    room.position.set(30, 0, -20);
    room.rotation.y = angle;
    room.scale.setScalar(scale);
    const objects = Renderer.buildCollisionObjects(room, { id: 99 }, THREE);
    assert.equal(objects.length, 7);
    const player = Object.create(context.window.Player.prototype);
    player.world = { collisionObjects: objects };
    player.worldObject = { userData: { isGlbLoaded: true } };
    const at = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(room.matrixWorld);
    assert.equal(player.checkSideCollision(at(0, 0, 0)), false, 'Interior stays accessible');
    assert.equal(player.checkSideCollision(at(0, 0, 8)), false, 'Doorway stays accessible');
    assert.equal(player.checkSideCollision(at(6, 0, 8)), true, 'Front wall blocks movement');
    assert.equal(player.checkSideCollision(at(10, 0, 0)), true, 'Side wall blocks movement');
    assert.equal(player.checkSideCollision(at(0, 0, -8)), true, 'Back wall blocks movement');
    // Same flags and local bounds survive cloning for the model cache.
    const cached = room.clone();
    assert.equal(Renderer.buildCollisionObjects(cached, { id: 100 }, THREE).length, 7);
  }
}
console.log('Room collisions: doorway, interior, walls, rotation, scaling and cache clone passed');
