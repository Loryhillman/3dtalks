const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { console, URL, AbortController, fetch, location: { href: 'http://localhost:3002/play?room=fixture' } };
context.window = context;
vm.createContext(context);
for (const file of ['lib/three.min.js', 'geometryRenderer.js', 'roomScene.js']) {
  vm.runInContext(fs.readFileSync(require.resolve('../public/js/' + file), 'utf8'), context);
}
const THREE = context.THREE;
const object = id => ({ id, type: 'uploaded_model', model_path: '/models/chair.glb', has_collision: true,
  position_x: 3, position_y: 2, position_z: 1, scale_x: 0.1, scale_y: 0.2, scale_z: 0.3 });
const geometry = id => ({ id, type: 'geometry_building', has_collision: true,
  geometry_data: { components: [{ type: 'box', width: 2, height: 1, depth: 3, position: { x: 0, y: 0, z: 0 } }] } });
function setup() {
  const world = { scene: new THREE.Scene(), generatedBuildings: new Map(), loadedObjects: new Set(), collisionObjects: [] };
  return { world, manager: new context.RoomScene(world) };
}
function source() {
  const root = new THREE.Group(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), material);
  root.add(mesh);
  const counts = { geometry: 0, material: 0, texture: 0 };
  mesh.geometry.addEventListener('dispose', () => counts.geometry++);
  material.addEventListener('dispose', () => counts.material++);
  texture.addEventListener('dispose', () => counts.texture++);
  return { root, counts };
}
const response = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
(async () => {
  const { world, manager } = setup(), original = source();
  let downloads = 0;
  manager.request = async () => { downloads++; return response(); };
  world.gltfLoader = { parse: (_buffer, directory, done) => {
    assert.equal(directory, 'http://localhost:3002/models/'); done({ scene: original.root });
  } };
  const unrelated = new THREE.Group(), unrelatedEntry = { model: unrelated };
  world.scene.add(unrelated);world.generatedBuildings.set(99, unrelatedEntry);world.loadedObjects.add(99);
  world.collisionObjects.push({ id: 99 });
  await manager.load([object(1), object(2)]);
  assert.equal(downloads, 1, 'one GLB source serves duplicate furniture');
  assert.equal(world.collisionObjects.length, 3, 'coincident objects retain independent collisions');
  assert.equal(world.generatedBuildings.get(1).model.scale.x, 0.1);
  assert.equal(world.generatedBuildings.get(1).model.position.y, 2);
  manager.clear();manager.clear();
  assert.deepEqual(original.counts, { geometry: 1, material: 1, texture: 1 });
  assert.equal(world.scene.children.length, 1);
  assert.equal(world.generatedBuildings.get(99), unrelatedEntry);
  assert.equal(world.loadedObjects.size, 1);
  assert.deepEqual(world.collisionObjects, [{ id: 99 }]);

  await assert.rejects(manager.load([geometry(3), { id: 4, type: 'threejs_code' }]), /Unsupported/);
  assert.equal(world.scene.children.length, 1, 'failed snapshot rolls back partial geometry');
  assert.equal(world.collisionObjects.length, 1);
  await assert.rejects(manager.load([geometry(3), geometry(3)]), /duplicated/);
  assert.equal(world.generatedBuildings.size, 1);
  manager.request = async () => ({ ok: false, status: 404 });
  await assert.rejects(manager.load([geometry(3), object(4)]), /HTTP 404/);
  assert.equal(world.scene.children.length, 1, 'missing model never leaves placeholders or partial walls');

  const late = source();let finishParse, startedParse;
  const parsing = new Promise(resolve => { startedParse = resolve; });
  manager.request = async () => response();
  world.gltfLoader = { parse: (_buffer, _dir, done) => { finishParse = done; startedParse(); } };
  const obsolete = manager.load([object(5)]);
  const rejected = assert.rejects(obsolete, error => error.name === 'AbortError');
  await parsing;
  await manager.load([geometry(6)]);
  finishParse({ scene: late.root });
  await rejected;
  assert.deepEqual(late.counts, { geometry: 1, material: 1, texture: 1 });
  assert.equal(world.generatedBuildings.has(5), false, 'late parser cannot restore the previous room');
  assert.equal(world.generatedBuildings.has(6), true);
  manager.clear();

  let fetchStarted;
  const downloading = new Promise(resolve => { fetchStarted = resolve; });
  manager.request = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); });
    fetchStarted();
  });
  const aborted = manager.load([object(7)]);
  const abortCheck = assert.rejects(aborted, error => error.name === 'AbortError');
  await downloading;manager.clear();await abortCheck;
  assert.equal(world.generatedBuildings.size, 1);
  // Existing room-surface material listeners retain ownership of their map.
  const surfaceRoot = new THREE.Group(), surfaceMap = new THREE.Texture();
  let surfaceDisposals = 0;
  surfaceMap.addEventListener('dispose', () => surfaceDisposals++);
  const surfaceMaterial = new THREE.MeshStandardMaterial({ map: surfaceMap });
  surfaceMaterial.userData.roomSurfaceTextureOwned = true;
  surfaceMaterial.addEventListener('dispose', () => surfaceMap.dispose());
  surfaceRoot.add(new THREE.Mesh(new THREE.BoxGeometry(), surfaceMaterial));
  const surfaceRun = manager.begin();surfaceRun.roots.add(surfaceRoot);
  manager.clear();assert.equal(surfaceDisposals, 1);

  // Only the most recent room request may announce that the scene is ready.
  context.localStorage = { getItem: key => key === 'token' ? 'account-token' : 'character' };
  let ready = 0, failed = 0, finishOld, signal;
  context.RoomSeating = { sceneReady: () => ready++, sceneFailed: () => failed++ };
  world.updateLoadingStatus = () => {};world.showLoadingProgress = () => {};
  manager.request = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer account-token');
    if (url.includes('/old/')) {
      signal = options.signal;
      return new Promise(resolve => { finishOld = resolve; });
    }
    return { ok: true, json: async () => ({ success: true, objects: [geometry(8)] }) };
  };
  const oldEnter = manager.enter('old');
  await manager.enter('new');
  assert.equal(signal.aborted, true);
  finishOld({ ok: true, json: async () => ({ success: true, objects: [geometry(9)] }) });
  await oldEnter;
  assert.equal(ready, 1);assert.equal(failed, 0);
  assert.equal(world.generatedBuildings.has(8), true);
  assert.equal(world.generatedBuildings.has(9), false);
  assert.equal(world.isLoadingBuildings, false);
  manager.clear();
  console.log('Room lifecycle: source reuse, independent collisions, disposal, rollback, fetch cancellation and stale parse isolation OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
