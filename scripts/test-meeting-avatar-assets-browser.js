const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { chromium } = require('playwright');
const { createAvatarLab } = require('./avatar-lipsync-lab'), { inspectGlb } = require('../src/services/avatarValidation');
let server, browser;
(async () => {
  const catalog = {models:[]};
  for(const bundle of ['valid-business-v1','meeting-human-v1']){
    const dir=path.join(__dirname,'../public/assets/avatars',bundle);
    catalog.models.push(...JSON.parse(await fs.readFile(path.join(dir,'catalog.json'),'utf8')).models.map(entry=>({...entry,directory:dir})));
  }
  for (const entry of catalog.models) {
    const bytes = await fs.readFile(path.join(entry.directory, entry.file));
    assert.equal(bytes.length, entry.bytes); assert(bytes.length <= 8 * 1048576);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    assert.deepEqual(inspectGlb(bytes, 'body'), { triangles: entry.triangles, boneMap: entry.boneMap });
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
    assert(!gltf.accessors.some(a => a.sparse)); assert(!gltf.animations?.length);
    assert(gltf.materials.every(m => m.alphaMode !== 'BLEND'), 'opaque body and masked hair must not sort through the face');
    assert(gltf.images.every(image => image.bufferView !== undefined && !image.uri));
  }
  ({ server } = await createAvatarLab(path.join(catalog.models[0].directory, catalog.models[0].file), { meetingCandidates: true }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/model.glb?avatar=../../package.json')).status, 404);
  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath();
  try { await fs.access(executablePath); } catch (_) {
    const cache = path.join(os.homedir(), '.cache/ms-playwright');
    for (const dir of await fs.readdir(cache)) if (dir.startsWith('chromium-')) executablePath = path.join(cache, dir, 'chrome-linux64/chrome');
  }
  browser = await chromium.launch({ executablePath, headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [], requests = [];
  const screenshots = await fs.mkdtemp(path.join(os.tmpdir(), '3dtalks-human-assets-'));
  page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push(request.url()));
  for (const entry of catalog.models) {
    await page.goto(base + '/?avatar=' + entry.id);
    await page.waitForFunction(() => window.AvatarLab?.getState().ready);
    assert.equal(await page.locator('#model-variant').inputValue(), entry.id);
    await page.selectOption('#view', 'head');
    await page.screenshot({ path: path.join(screenshots, entry.id + '-face.png') });
    await page.click('#manual-controls summary'); await page.locator('#amount').fill('0.7'); await page.locator('#amount').dispatchEvent('input');
    assert(await page.evaluate(() => {let open=false;AvatarLab.model().traverse(n=>{if(n.morphTargetDictionary?.viseme_aa!==undefined&&n.morphTargetInfluences[n.morphTargetDictionary.viseme_aa]>.6)open=true;});return open;}));
    await page.screenshot({ path: path.join(screenshots, entry.id + '-mouth.png') });
    await page.click('#neutral'); await page.selectOption('#view', 'seat');
    assert.equal(await page.evaluate(() => AvatarLab.getState().supported), true);
    await page.screenshot({ path: path.join(screenshots, entry.id + '-seat.png') });
    await page.click('#audio-record'); await page.waitForFunction(() => AvatarLab.getState().audio.phase === 'recording');
    await page.waitForTimeout(1200); await page.click('#audio-record');
    await page.waitForFunction(() => AvatarLab.getState().audio.phase === 'ready');
    await page.click('#audio-play'); await page.waitForFunction(() => AvatarLab.getState().audio.amount > .01);
    await page.waitForFunction(() => AvatarLab.getState().audio.phase === 'ready');
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  // Real renderer/loader/pose with six independent copies, alternating model variants.
  const report = await page.evaluate(async models => {
    AvatarLab.stop(); document.querySelector('main').hidden = true;
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(1280, 800);renderer.domElement.id='six-viewport';document.body.append(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#e8edf2');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x778899, 2.3));
    const light = new THREE.DirectionalLight(0xffffff, 2.5); light.position.set(2, 5, 4); scene.add(light);
    const camera = new THREE.PerspectiveCamera(38, 1280 / 800, .01, 100); camera.position.set(6.5, 4, 10); camera.lookAt(0, .7, 0);
    // r185 lazily uploads a renderer-owned DFG_LUT for standard materials.
    const warmup=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());scene.add(warmup);
    renderer.render(scene,camera);scene.remove(warmup);UserAvatarRenderer.dispose(warmup);renderer.render(scene,camera);
    const baseline={...renderer.info.memory};
    const groups = await Promise.all(Array.from({length:6}, async (_, i) => {
      const model = models[i % models.length], group = new THREE.Group();
      await UserAvatarRenderer.apply(group, {mode:'full',asset:{path:'/model.glb?avatar='+model.id,boneMap:model.boneMap}});
      if(group.userData.accountAvatarError)throw Error(group.userData.accountAvatarError);
      group.position.set((i%3-1)*2.5,0,Math.floor(i/3)*3-1.5);scene.add(group);
      RoomSeatAvatar.apply(group);
      if(!group.userData.roomSeatRig.supported)throw Error('Unsupported seating');
      return group;
    }));
    const mouths=groups.map(group=>{const entries=[];group.traverse(n=>{const i=n.morphTargetDictionary?.viseme_aa;if(i!==undefined)entries.push([n,i]);});return entries;});
    if(mouths.some(entries=>!entries.length))throw Error('Missing mouth');
    for(const [mesh,index] of mouths[0])mesh.morphTargetInfluences[index]=.65;
    if(mouths.slice(1).some(entries=>entries.some(([n,i])=>n.morphTargetInfluences[i]!==0)))throw Error('Shared mouth weights');
    const samples=[];
    for(let i=0;i<20;i++){const start=performance.now();renderer.render(scene,camera);renderer.getContext().finish();samples.push(performance.now()-start);}
    const memory={...renderer.info.memory};
    const result={participants:6,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,memory,baseline,
      renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER),
      synchronousRenderMedianMs:samples.slice(5).sort((a,b)=>a-b)[7],
      note:'Headless Chromium/SwiftShader, not a hardware FPS or mobile benchmark'};
    window.disposeSix=()=>{for(const group of groups){scene.remove(group);UserAvatarRenderer.dispose(group);}renderer.render(scene,camera);window.afterSix={...renderer.info.memory};renderer.dispose();};
    return result;
  }, catalog.models);
  await page.locator('#six-viewport').screenshot({ path: path.join(screenshots, 'six-seated.png') });
  await page.evaluate(() => disposeSix());
  assert.deepEqual(await page.evaluate(() => afterSix), report.baseline, 'all model GPU allocations must return to the warmed renderer baseline');
  assert(requests.every(url => url.startsWith(base) || url.startsWith('blob:' + base) || url.startsWith('data:image/')));
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(screenshots, 'report.json'), JSON.stringify(report, null, 2));
  console.log('Human assets passed: pinned hashes, existing validator, head/mouth/seating, native microphone replay, mobile UI, six independent GLBs and GPU disposal. ' + JSON.stringify({screenshots, ...report}));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
});
