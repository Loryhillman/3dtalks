// Real renderer, seating and GLB. Model files are explicit local research inputs.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { createAvatarLab } = require('./avatar-lipsync-lab');
const { wav } = require('./avatar-lab-audio-fixture');
let browser, server;
async function executable() {
  const options = [process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath()].filter(Boolean);
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  for (const dir of await fs.readdir(cache)) if (dir.startsWith('chromium-')) options.push(path.join(cache, dir, 'chrome-linux64/chrome'));
  for (const file of options) { try { await fs.access(file); return file; } catch (_) {} }
  throw Error('Chromium unavailable');
}
(async () => {
  const [prepared, reference] = process.argv.slice(2);
  if (!prepared || !reference) throw Error('Pass prepared GLB and pinned original MPFB GLB');
  const audioDirectory = await fs.mkdtemp(path.join(os.tmpdir(), '3dtalks-avatar-audio-'));
  const demoPath = path.join(audioDirectory, 'fixture.wav'); await fs.writeFile(demoPath, wav());
  const lab = await createAvatarLab(prepared, { demoPath }); server = lab.server;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/manifest.json', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/unlisted-file')).status, 404);
  browser = await chromium.launch({ executablePath: await executable(), headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const screenshots = await fs.mkdtemp(path.join(os.tmpdir(), '3dtalks-avatar-lab-'));
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.route('**/reference.glb', route => route.fulfill({ path: reference, contentType: 'model/gltf-binary' }));
  await page.goto(base);
  await page.waitForFunction(() => window.AvatarLab?.getState().ready);
  assert.equal((await page.evaluate(() => AvatarLab.getState())).manifest.triangles, 83686);
  // Independently compare decoded attributes against GLTFLoader's sparse implementation.
  const equivalence = await page.evaluate(async () => {
    const reference = (await new THREE.GLTFLoader().loadAsync('/reference.glb')).scene;
    const originals = new Map(); reference.traverse(node => { if (node.isMesh) originals.set(node.name, node); });
    let vertices = 0, morphComponents = 0;
    AvatarLab.model().traverse(node => {
      if (!node.isMesh) return;
      const original = originals.get(node.name);
      if (!original) throw Error('Missing original mesh ' + node.name);
      const compare = (a, b, label) => {
        if (a.count !== b.count || a.itemSize !== b.itemSize) throw Error('Layout changed: ' + label);
        for (let i = 0; i < a.count; i++) for (const component of ['getX', 'getY', 'getZ']) {
          if (Math.abs(a[component](i) - b[component](i)) > 1e-7) throw Error('Geometry changed: ' + label);
        }
      };
      compare(node.geometry.attributes.position, original.geometry.attributes.position, node.name);
      vertices += node.geometry.attributes.position.count;
      for (const [name, index] of Object.entries(node.morphTargetDictionary || {})) {
        const originalIndex = original.morphTargetDictionary[name];
        for (const kind of Object.keys(node.geometry.morphAttributes)) {
          const target = node.geometry.morphAttributes[kind][index];
          compare(target, original.geometry.morphAttributes[kind][originalIndex], node.name + '/' + name + '/' + kind);
          morphComponents += target.count * target.itemSize;
        }
      }
    });
    UserAvatarRenderer.dispose(reference);
    return { vertices, morphComponents };
  });
  assert(equivalence.vertices > 10000 && equivalence.morphComponents > 100000);
  await page.screenshot({ path: path.join(screenshots, 'lab-body.png') });
  await page.selectOption('#view', 'head');
  await page.locator('#manual-controls summary').click();
  await page.locator('#amount').fill('0.7'); await page.locator('#amount').dispatchEvent('input');
  assert.equal(await page.locator('#amount-value').textContent(), '70%');
  const activeShapes = () => page.evaluate(() => {
    const active = []; AvatarLab.model().traverse(node => {
      for (const [name, index] of Object.entries(node.morphTargetDictionary || {})) {
        if (node.morphTargetInfluences[index] > 0) active.push(name);
      }
    }); return active;
  });
  assert((await activeShapes()).every(name => name === 'viseme_aa'));
  await page.screenshot({ path: path.join(screenshots, 'lab-mouth.png') });
  for (const shape of ['viseme_O', 'viseme_PP', 'jawOpen']) {
    await page.selectOption('#shape', shape);
    const active = await activeShapes(); assert(active.length > 0 && active.every(name => name === shape));
  }
  await page.locator('#neutral').click(); assert.deepEqual(await activeShapes(), []);
  await page.selectOption('#view', 'seat');
  assert.equal(await page.evaluate(() => AvatarLab.getState().supported), true);
  await page.screenshot({ path: path.join(screenshots, 'lab-seat.png') });
  await page.selectOption('#view', 'body');
  await page.locator('#manual-controls summary').click();
  await page.click('#audio-demo');
  await page.waitForFunction(() => AvatarLab.getState().audio.phase === 'ready');
  await page.click('#audio-play');
  await page.waitForFunction(() => {
    if (AvatarLab.getState().audio.phase !== 'playing') return false;
    let open=false; AvatarLab.model().traverse(node => {
      const index=node.morphTargetDictionary?.viseme_aa;
      if(index!==undefined&&node.morphTargetInfluences[index]>.05)open=true;
    }); return open;
  });
  assert(await page.locator('#shape').isDisabled());
  await page.waitForFunction(() => AvatarLab.getState().audio.phase === 'ready');
  assert.deepEqual(await activeShapes(), [], 'audio end must return the actual face to neutral');
  assert(await page.locator('#shape').isEnabled());
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    await page.setViewportSize(viewport);
    assert(await page.locator('#controls').isEnabled());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.evaluate(() => { AvatarLab.stop(); AvatarLab.stop(); });
  assert.equal(await page.evaluate(() => AvatarLab.getState().disposed), true);
  assert(requests.every(url => url.startsWith(base)), 'lab must not contact external services');
  assert(!requests.some(url => url.includes('/api/')), 'lab must not call product APIs');
  assert.deepEqual(errors, []);
  console.log('Avatar lab passed: existing validator, decoded sparse/dense geometry equivalence, mouth forms, neutral reset, actual seating, mobile bounds and stop; ' + JSON.stringify(equivalence));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
});
