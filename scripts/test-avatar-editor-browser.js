const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');const {glb}=require('./avatar-test-fixtures');
const {DEFAULT}=require('../src/services/userAvatars');
const root=path.resolve(__dirname,'../public');
let revision=0,saved={...DEFAULT},lastSave,uploads=0;
const assets=[{id:'head-asset',kind:'head',path:'/fixtures/head.glb',metadata:{}},{id:'body-asset',kind:'body',path:'/fixtures/body.glb',metadata:{boneMap:{}}}];
const server=http.createServer(async(req,res)=>{
  try{
    if(req.url==='/fixtures/photo.png'){res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC','base64'));return;}
    if(req.url==='/fixtures/head.glb'||req.url==='/fixtures/body.glb'){res.setHeader('Content-Type','model/gltf-binary');res.end(glb(req.url.includes('body')?'body':'head'));return;}
    if(req.url.startsWith('/api/my/avatar')){
      let body='';for await(const chunk of req)body+=chunk;
      res.setHeader('Content-Type','application/json');
      if(req.method==='GET'){res.end(JSON.stringify({revision,config:saved,assets}));return;}
      if(req.method==='PUT'){lastSave=JSON.parse(body);saved=lastSave.config;revision++;res.end(JSON.stringify({revision,config:saved}));return;}
      if(req.method==='POST'){uploads++;const asset={...assets[0],id:'uploaded-head'};assets.unshift(asset);res.statusCode=201;res.end(JSON.stringify({asset}));return;}
      res.end('{}');return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep))throw Error('path');
    res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
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
  browser=await chromium.launch({executablePath:await executable(),headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('token','fixture-token');localStorage.setItem('locale','ru-RU');});
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/avatar.html');await page.locator('#avatar-save').waitFor();await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  assert.equal(await page.locator('.shell-nav a[aria-current=page]').getAttribute('href'),'/avatar.html','avatar navigation is active');
  assert.equal(await page.locator('[name=mode]').inputValue(),'standard');
  await page.selectOption('[name=headType]','cube');await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.locator('#avatar-save').click();await page.waitForFunction(()=>document.getElementById('avatar-status').textContent.includes('saved')||document.getElementById('avatar-status').textContent.includes('сохранён'));
  assert.equal(lastSave.config.headType,'cube');assert.equal(lastSave.revision,0);
  await page.selectOption('[name=headType]','model');assert.equal(await page.locator('#avatar-save').isDisabled(),true);
  await page.selectOption('[name=assetId]','head-asset');await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.fill('[name=headScale]','0.75');await page.locator('[name=headScale]').blur();await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.locator('#avatar-save').click();await page.waitForFunction(()=>document.getElementById('avatar-status').textContent.includes('saved')||document.getElementById('avatar-status').textContent.includes('сохранён'));
  assert(!((await page.locator('[name=assetId]').innerText()).includes('{')), 'asset labels interpolate placeholders');
  assert.equal(lastSave.config.headAssetId,'head-asset');assert.equal(lastSave.config.headScale,.75);
  await page.selectOption('[name=mode]','full');assert.equal(await page.locator('#avatar-standard').isVisible(),false);
  await page.selectOption('[name=assetId]','body-asset');await page.waitForFunction(()=>!document.getElementById('avatar-save').disabled);
  await page.locator('#avatar-look').fill('0.6');await page.locator('#avatar-save').click();
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
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/avatar-editor-mobile.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile page does not overflow');
  assert.deepEqual(errors,[]);
  console.log('Avatar browser: seated GLB rendering, modes, head controls, upload, save/reload and mobile layout OK');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
