const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const { chromium } = require('playwright');
const { officeGlb } = require('./room-environment-fixtures');

// Real shipped Three.js/GLTFLoader, synthetic files, no application API/DB/Docker.
const app = express();
app.get('/', (_req, res) => res.send('<!doctype html><script src="/js/lib/three.min.js"></script><script src="/js/lib/GLTFLoader.js"></script><script src="/js/roomEnvironment.js"></script><script src="/js/roomEnvironmentView.js"></script>'));
app.get('/office.glb', (_req, res) => res.type('model/gltf-binary').send(officeGlb()));
app.get('/millimetres.glb', (_req, res) => res.type('model/gltf-binary').send(officeGlb({ units: 1000 })));
if (process.argv[2]) app.get('/sample.glb', (_req, res) => res.sendFile(path.resolve(process.argv[2])));
app.use(express.static(path.resolve(__dirname, '../public')));
async function executable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  try { await fs.access(chromium.executablePath()); return chromium.executablePath(); } catch (_) {}
  for (const entry of await fs.readdir('/root/.cache/ms-playwright')) {
    if (!entry.startsWith('chromium-')) continue;
    const candidate = path.join('/root/.cache/ms-playwright', entry, 'chrome-linux64/chrome');
    try { await fs.access(candidate); return candidate; } catch (_) {}
  }
  throw new Error('Chromium is not installed');
}
let server, browser;
(async () => {
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  browser = await chromium.launch({ executablePath: await executable(), headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  const results = await page.evaluate(async () => {
    const results = [];
    for (const [file, scale] of [['/office.glb', 1], ['/millimetres.glb', .001]]) {
      const gltf = await new THREE.GLTFLoader().parseAsync(await (await fetch(file)).arrayBuffer(), '');
      const bounds = new THREE.Box3().setFromObject(gltf.scene);
      const environment = { version: 1, bounds: { min: { ...bounds.min }, max: { ...bounds.max } } };
      const transform = { position: { x: 10, y: 0, z: -10 }, rotation: { x: 0, y: .73, z: 0 }, scale: { x: scale, y: scale, z: scale } };
      const group = new THREE.Group();
      group.position.set(10, 0, -10); group.rotation.y = .73; group.scale.setScalar(scale); group.add(gltf.scene); group.updateMatrixWorld(true);
      const localPoint = new THREE.Vector3(2 / scale, 1 / scale, -1 / scale);
      const actualPoint = group.localToWorld(localPoint.clone());
      const point = RoomEnvironment.toWorld(localPoint, transform);
      const object = { room_environment: environment };
      for (const prefix of ['position','rotation','scale']) for (const axis of ['x','y','z']) object[prefix+'_'+axis] = transform[prefix][axis];
      const viewBox = RoomEnvironmentView.bounds(object);
      const helper = RoomEnvironmentView.helper(object); helper.updateMatrixWorld(true);
      const helperPoint = helper.localToWorld(localPoint.clone());
      const fits = [];
      for (const aspect of [.3, 2]) {
        const camera = new THREE.PerspectiveCamera(60,aspect,.1,1000);
        const controls = {target:new THREE.Vector3(),update(){camera.lookAt(this.target);camera.updateMatrixWorld(true);}};
        RoomEnvironmentView.fit(camera,controls,viewBox);
        for (const x of [viewBox.min.x,viewBox.max.x]) for (const y of [viewBox.min.y,viewBox.max.y]) for (const z of [viewBox.min.z,viewBox.max.z]) {
          const p = new THREE.Vector3(x,y,z).project(camera);
          fits.push(Math.abs(p.x)<=1 && Math.abs(p.y)<=1 && Math.abs(p.z)<=1);
        }
      }
      const target = viewBox.getCenter(new THREE.Vector3());
      const desired = target.clone().add(new THREE.Vector3(30000,0,30000));
      const constrained = RoomEnvironmentView.constrain(target,desired,object);
      const clipped = RoomEnvironment.contains(constrained,environment,transform);
      results.push({ size: bounds.getSize(new THREE.Vector3()).multiplyScalar(scale).toArray(),
        fits, clipped, helperDifference:helperPoint.distanceTo(actualPoint),
        valid: RoomEnvironment.valid(environment, transform), contained: RoomEnvironment.contains(point, environment, transform),
        difference: actualPoint.distanceTo(new THREE.Vector3(point.x, point.y, point.z)),
        bounds: RoomEnvironment.worldBounds(environment, transform), meshes: gltf.scene.children.length });
      const geometries = new Set(), materials = new Set();
      gltf.scene.traverse(node => { if (node.geometry) geometries.add(node.geometry); for (const material of [].concat(node.material || [])) materials.add(material); });
      for (const geometry of geometries) geometry.dispose(); for (const material of materials) material.dispose();
    }
    return results;
  });
  for (const result of results) {
    assert.equal(result.valid, true); assert.equal(result.contained, true); assert.equal(result.meshes, 8);
    assert(result.fits.every(Boolean), 'office fits both portrait and landscape cameras');
    assert.equal(result.clipped, true, 'seat camera stays inside rotated and scaled office even with a distant desired point');
    assert(result.helperDifference < 1e-8, 'bounds helper uses the model transform');
    assert(result.difference < 1e-8, 'shared bounds math matches the deployed Three.js transform');
    for (const [index, expected] of [8.2, 3.2, 6.2].entries()) assert(Math.abs(result.size[index] - expected) < 1e-5);
  }
  for (const axis of ['x', 'y', 'z']) for (const edge of ['min', 'max']) assert(Math.abs(results[0].bounds[edge][axis] - results[1].bounds[edge][axis]) < 1e-8);
  if (process.argv[2]) {
    const sample = await page.evaluate(async () => {
      const gltf = await new THREE.GLTFLoader().parseAsync(await (await fetch('/sample.glb')).arrayBuffer(), '');
      const box = new THREE.Box3().setFromObject(gltf.scene);
      let nodes = 0, meshes = 0, triangles = 0;
      gltf.scene.traverse(node => { nodes++; if (node.isMesh) { meshes++; triangles += (node.geometry.index?.count || node.geometry.attributes.position.count) / 3; } });
      return { nodes, meshes, triangles, size: box.getSize(new THREE.Vector3()).toArray() };
    });
    console.log('Sample GLB inspection:', JSON.stringify(sample));
  }
  assert.deepEqual(errors, []);
  console.log('GLB environment fixtures: actual shipped loader, metre/millimetre imports and Three.js coordinate parity OK');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});
