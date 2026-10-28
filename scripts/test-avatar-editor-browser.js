const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');const {glb}=require('./avatar-test-fixtures');
const {DEFAULT}=require('../src/services/userAvatars');
const {listPresets,resolveConfig}=require('../src/services/avatarCatalog');
const {inspectGlb}=require('../src/services/avatarValidation');
const root=path.resolve(__dirname,'../public');
let revision=0,saved={...DEFAULT},lastSave,uploads=0;
const assets=[{id:'head-asset',kind:'head',path:'/fixtures/head.glb',metadata:{}},{id:'body-asset',kind:'body',path:'/fixtures/body.glb',metadata:{boneMap:{}}}];
let actualBody;
if(process.argv[2]){
  actualBody=require('node:fs').readFileSync(process.argv[2]);
  assets.push({id:'actual-body',kind:'body',path:'/fixtures/actual-body.glb',metadata:inspectGlb(actualBody,'body')});
}
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/fixtures/actual-body.glb'&&actualBody){res.setHeader('Content-Type','model/gltf-binary');res.end(actualBody);return;}
    if(req.url==='/fixtures/photo.png'){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC','base64'));return;}
    if(req.url==='/fixtures/head.glb'||req.url==='/fixtures/body.glb'){res.setHeader('Content-Type','model/gltf-binary');res.end(glb(req.url.includes('body')?'body':'head'));return;}
    if(req.url.startsWith('/api/my/avatar')){
      let body='';for await(const chunk of req)body+=chunk;
      res.setHeader('Content-Type','application/json');
      if(req.method==='GET'){res.end(JSON.stringify({revision,config:saved,assets,catalog:listPresets(),defaultConfig:DEFAULT}));return;}
      if(req.method==='PUT'){lastSave=JSON.parse(body);saved=resolveConfig(lastSave.config);revision++;res.end(JSON.stringify({revision,config:saved}));return;}
      if(req.method==='POST'){uploads++;const asset={...assets[0],id:'uploaded-head'};assets.unshift(asset);res.statusCode=201;res.end(JSON.stringify({asset}));return;}
      res.end('{}');return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep))throw Error('path');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
  }catch(error){res.statusCode=404;res.end('not found');}
});
async function executable(){
  if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  try{await fs.access(chromium.executablePath());return chromium.executablePath();}catch(_){}
  const cache='/root/.cache/ms-playwright';for(const entry of await fs.readdir(cache))if(entry.startsWith('chromium-')){const candidate=path.join(cache,entry,'chrome-linux64/chrome');try{await fs.access(candidate);return candidate;}catch(_){}}
  throw Error('Chromium is not installed');
}
let browser;
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await fs.writeFile('/tmp/3dtalks-avatar-preview-fixture.wav',require('./avatar-lab-audio-fixture').wav());
  browser=await chromium.launch({executablePath:await executable(),headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-audio-capture=/tmp/3dtalks-avatar-preview-fixture.wav']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('token','fixture-token');localStorage.setItem('locale','ru-RU');});
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/avatar.html');await page.locator('#avatar-save').waitFor();await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  assert.equal(await page.locator('.shell-nav a[aria-current=page]').getAttribute('href'),'/avatar.html','avatar navigation is active');
  assert.equal(await page.locator('[name=mode]').inputValue(),'builtin');
  assert.equal(await page.locator('[name=builtinId]').inputValue(),DEFAULT.builtinId);
  assert.equal(await page.locator('#avatar-assets').isVisible(),false);
  await page.evaluate(()=>{const original=UserAvatarRenderer.apply;UserAvatarRenderer.apply=(group,c)=>{window.previewAvatarGroup=group;return original(group,c);};});
  await page.click('#avatar-preview-retry');await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.click('#avatar-view-face');assert.equal(await page.locator('#avatar-view-face').getAttribute('aria-pressed'),'true');
  const front=await page.locator('#avatar-canvas').screenshot();
  const bounds=await page.locator('#avatar-canvas').boundingBox();
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+70,bounds.y+bounds.height/2+10,{steps:8});await page.mouse.up();
  assert(!front.equals(await page.locator('#avatar-canvas').screenshot()),'drag rotates real model view');
  await page.click('#avatar-view-reset');
  await page.click('#avatar-voice-record');await page.waitForFunction(()=>/Recording|Идёт запись/.test(document.getElementById('avatar-voice-status').textContent));
  await page.waitForTimeout(1300);await page.click('#avatar-voice-record');
  await page.waitForFunction(()=>!document.getElementById('avatar-voice-play').disabled);
  await page.locator('#avatar-mouth-gain').fill('1.5');await page.locator('#avatar-mouth-gain').dispatchEvent('input');
  await page.click('#avatar-voice-play');
  await page.waitForFunction(()=>{let open=false;previewAvatarGroup.traverse(n=>{const i=n.morphTargetDictionary?.viseme_aa;if(i!==undefined&&n.morphTargetInfluences[i]>.05)open=true;});return open;});
  await page.click('#avatar-voice-stop');
  assert(await page.evaluate(()=>{let closed=true;previewAvatarGroup.traverse(n=>{const i=n.morphTargetDictionary?.viseme_aa;if(i!==undefined&&n.morphTargetInfluences[i]!==0)closed=false;});return closed;}));
  await page.click('#avatar-save');await page.waitForFunction(()=>/сохранён|saved/.test(document.getElementById('avatar-status').textContent));
  assert.equal(lastSave.config.mouthGain,1.5);
  await page.reload();await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  assert.equal(await page.locator('#avatar-mouth-gain').inputValue(),'1.5');
  await page.selectOption('[name=mode]','standard');
  await page.selectOption('[name=headType]','cube');await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.locator('#avatar-save').click();await page.waitForFunction(()=>document.getElementById('avatar-status').textContent.includes('saved')||document.getElementById('avatar-status').textContent.includes('сохранён'));
  assert.equal(lastSave.config.headType,'cube');assert.equal(lastSave.revision,1);
  await page.selectOption('[name=headType]','model');assert.equal(await page.locator('#avatar-save').isDisabled(),true);
  await page.selectOption('[name=assetId]','head-asset');await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.fill('[name=headScale]','0.75');await page.locator('[name=headScale]').blur();await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.locator('#avatar-save').click();await page.waitForFunction(()=>document.getElementById('avatar-status').textContent.includes('saved')||document.getElementById('avatar-status').textContent.includes('сохранён'));
  assert(!((await page.locator('[name=assetId]').innerText()).includes('{')), 'asset labels interpolate placeholders');
  assert.equal(lastSave.config.headAssetId,'head-asset');assert.equal(lastSave.config.headScale,.75);
  await page.selectOption('[name=mode]','full');assert.equal(await page.locator('#avatar-standard').isVisible(),false);
  await page.selectOption('[name=assetId]','body-asset');await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.locator('#avatar-canvas').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('Home');await page.locator('#avatar-save').click();
  await page.waitForFunction(()=>document.getElementById('avatar-status').textContent.includes('saved')||document.getElementById('avatar-status').textContent.includes('сохранён'));
  assert.equal(lastSave.config.mode,'full');assert.equal(lastSave.config.bodyAssetId,'body-asset');
  // A second load uses the persisted config instead of a local template choice.
  await page.reload();await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);assert.equal(await page.locator('[name=mode]').inputValue(),'full');
  await page.selectOption('[name=mode]','standard');await page.selectOption('[name=headType]','model');
  await page.locator('#avatar-file').setInputFiles({name:'test-head.glb',mimeType:'model/gltf-binary',buffer:glb()});
  await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled&&document.querySelector('[name=assetId]').value==='uploaded-head');assert.equal(uploads,1);
  const isolation=await page.evaluate(async()=>{
    const full={mode:'full',bodyYaw:0,asset:{path:'/fixtures/body.glb',boneMap:{}}};
    const photoGroup=AvatarBase.create().characterGroup;
    let photoModes=true;
    for(const headType of ['image','sphere','cube']){
      await UserAvatarRenderer.apply(photoGroup,{mode:'standard',headType,asset:{path:'/fixtures/photo.png'},bodyColor:'#4a90e2',headColor:'#ffaa99'});
      let mapped=false;photoGroup.userData.accountAvatarRoot.traverse(n=>{if(n.material?.map)mapped=true;});
      photoModes=photoModes&&mapped&&!photoGroup.userData.defaultSeatHead.visible&&!photoGroup.userData.accountAvatarError;
    }
    UserAvatarRenderer.dispose(photoGroup);
    const a=AvatarBase.create().characterGroup,b=AvatarBase.create().characterGroup;
    await Promise.all([UserAvatarRenderer.apply(a,full),UserAvatarRenderer.apply(b,full)]);
    const independent=a.userData.glbModel!==b.userData.glbModel&&a.userData.glbModel.parent===a&&b.userData.glbModel.parent===b;
    a.position.set(0,0,0);RoomSeatAvatar.apply(a,{yaw:.5,pitch:.1});
    const first=a.userData.roomSeatRig.found.head.quaternion.clone();
    a.position.set(0,0,0);RoomSeatAvatar.apply(a,{yaw:.5,pitch:.1});
    const stable=first.angleTo(a.userData.roomSeatRig.found.head.quaternion)<1e-6;
    const c=AvatarBase.create().characterGroup;
    const pending=UserAvatarRenderer.apply(c,full);
    await UserAvatarRenderer.apply(c,{mode:'standard',headType:'cube',bodyColor:'#4a90e2',headColor:'#ffaa99'});await pending;
    const staleIgnored=!c.userData.glbModel&&c.userData.accountAvatarConfig.mode==='standard'&&c.userData.seatHead===c.userData.accountAvatarRoot;
    [a,b,c].forEach(group=>UserAvatarRenderer.dispose(group));
    return {independent,stable,staleIgnored,photoModes};
  });
  assert.deepEqual(isolation,{independent:true,stable:true,staleIgnored:true,photoModes:true},'separate player models, stable seated head turns and stale-load protection');
  if(actualBody){
    await page.selectOption('[name=mode]','full');
    await page.selectOption('[name=assetId]','actual-body');
    await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
    const actual=await page.evaluate(async()=>{
      const asset=(await (await fetch('/api/my/avatar')).json()).assets.find(a=>a.id==='actual-body');
      const group=AvatarBase.create().characterGroup;
      await UserAvatarRenderer.apply(group,{mode:'full',bodyYaw:0,asset:{...asset,boneMap:asset.metadata.boneMap}});
      group.position.set(0,0,0);RoomSeatAvatar.apply(group,{yaw:.4,pitch:.15});
      const state=group.userData.roomSeatRig;
      let skinned=0,finite=true,textured=0;
      group.updateWorldMatrix(true,true);
      group.traverse(node=>{
        if(node.material?.map)textured++;
        if(!node.isSkinnedMesh)return;
        skinned++;node.skeleton.update();
        const count=node.geometry.attributes.position.count;
        for(let i=0;i<count;i++){
          const vertex=node.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(node.matrixWorld);
          if(![vertex.x,vertex.y,vertex.z].every(Number.isFinite))finite=false;
        }
      });
      const legDirections=['left','right'].map(side=>({
        thigh:state.found[side+'Leg'].getWorldPosition(new THREE.Vector3()).sub(state.found[side+'UpLeg'].getWorldPosition(new THREE.Vector3())).normalize().z,
        calf:state.found[side+'Foot'].getWorldPosition(new THREE.Vector3()).sub(state.found[side+'Leg'].getWorldPosition(new THREE.Vector3())).normalize().y
      }));
      const position=state.model.position.clone(),rotation=state.found.head.quaternion.clone();
      for(let i=0;i<100;i++){group.position.set(0,0,0);RoomSeatAvatar.apply(group,{yaw:.4,pitch:.15});}
      const stable=position.distanceTo(state.model.position)<1e-6&&rotation.angleTo(state.found.head.quaternion)<1e-6;
      const hipsAligned=state.found.hips.getWorldPosition(new THREE.Vector3()).distanceTo(group.getWorldPosition(new THREE.Vector3()))<1e-6;
      const scene=new THREE.Scene();scene.background=new THREE.Color('#202936');scene.add(group);
      scene.add(new THREE.HemisphereLight(0xffffff,0x657183,2));
      const camera=new THREE.PerspectiveCamera(40,1,.01,100);camera.position.set(4,2.5,6);camera.lookAt(0,.6,0);
      const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(640,640);
      renderer.render(scene,camera);
      const image=renderer.domElement.toDataURL('image/png');
      const drawnTriangles=renderer.info.render.triangles;
      renderer.dispose();renderer.forceContextLoss();
      const result={supported:state.supported,skinned,textured,finite,stable,hipsAligned,legDirections,error:group.userData.accountAvatarError,image,drawnTriangles};
      UserAvatarRenderer.dispose(group);return result;
    });
    assert.equal(actual.supported,true);assert.equal(actual.error,null);
    assert(actual.skinned>0&&actual.textured>0&&actual.finite&&actual.stable&&actual.hipsAligned);
    assert(actual.legDirections.every(d=>d.thigh>.999&&d.calf<-.999));
    assert(actual.drawnTriangles>0,'actual model reaches WebGL draw calls');
    await fs.writeFile('/tmp/avatar-actual-render.png',Buffer.from(actual.image.split(',')[1],'base64'));
    delete actual.image;
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.screenshot({path:'/tmp/avatar-actual-body.png',fullPage:true});
    console.log('Actual GLB browser:',actual);
  }
  await page.selectOption('[name=mode]','builtin');
  await page.selectOption('[name=builtinId]','female-neutral-v1');
  await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.click('#avatar-save');await page.waitForFunction(()=>/сохранён|saved/.test(document.getElementById('avatar-status').textContent));
  assert.equal(lastSave.config.builtinId,'female-neutral-v1');
  await page.reload();await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  assert.equal(await page.locator('[name=builtinId]').inputValue(),'female-neutral-v1');
  // A broken built-in load must disable Save and allow a real retry of the same config.
  await page.route('**'+DEFAULT.asset.path,route=>route.fulfill({status:503,body:'unavailable'}));
  await page.click('#avatar-reset');await page.waitForFunction(()=>/Не удалось|Could not/.test(document.getElementById('avatar-status').textContent));
  assert(await page.locator('#avatar-save').isDisabled());
  await page.unroute('**'+DEFAULT.asset.path);
  await page.click('#avatar-preview-retry');await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  assert.equal(await page.locator('[name=builtinId]').inputValue(),DEFAULT.builtinId);
  await page.setViewportSize({width:1280,height:900});await page.click('#avatar-view-face');await page.evaluate(()=>{document.activeElement.blur();scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.locator('#avatar-canvas').screenshot({path:'/tmp/avatar-editor-face.png'});await page.screenshot({path:'/tmp/avatar-editor-calibration-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.click('#avatar-view-seat');await page.evaluate(()=>{document.activeElement.blur();scrollTo(0,0);return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});await page.screenshot({path:'/tmp/avatar-editor-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page does not overflow');
  assert.deepEqual(errors,[]);
  console.log('Avatar browser: seated GLB rendering, modes, head controls, upload, save/reload and mobile layout OK');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
