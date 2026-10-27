// Opt-in real local Compose/HTTP/PostgreSQL check, scoped to a temporary template.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),{chromium}=require('playwright');
if(process.env.ROOM_EDITOR_BROWSER_CHECK!=='1')throw Error('Set ROOM_EDITOR_BROWSER_CHECK=1 for the local Docker installation');
process.chdir(path.resolve(__dirname,'..'));
const app=execFileSync('docker',['compose','ps','-q','app'],{encoding:'utf8'}).trim();
const key='avatar-calibration-'+randomUUID().replaceAll('-','');
const database=`const {Pool}=require('pg');const db=new Pool({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});const key=${JSON.stringify(key)};`;
function inside(source){return execFileSync('docker',['exec','-i',app,'node'],{input:database+source,encoding:'utf8'});}
let browser,fixture;
(async()=>{
 fixture=JSON.parse(inside(`(async()=>{try{
 const admin=(await db.query('SELECT id FROM admin_users WHERE is_active ORDER BY id LIMIT 1')).rows[0];
 const source=(await db.query("SELECT * FROM room_templates WHERE template_key='meeting-six' ORDER BY version DESC LIMIT 1")).rows[0];
 const template=(await db.query('INSERT INTO room_templates(template_key,version,name,layout,avatar_scale) VALUES($1,1,$2,$3,1) RETURNING id',[key,'Avatar calibration QA',JSON.stringify(source.layout)])).rows[0];
 await db.query('INSERT INTO room_template_model_refs(template_id,model_id) SELECT $1,model_id FROM room_template_model_refs WHERE template_id=$2',[template.id,source.id]);
 const secrets=JSON.parse(require('fs').readFileSync('/app/.local-state/secrets.json'));
 const token=require('jsonwebtoken').sign({adminUserId:admin.id,type:'admin'},secrets.ADMIN_JWT_SECRET,{expiresIn:'10m'});
 const userToken=require('jsonwebtoken').sign({userId:'fixture'},secrets.JWT_SECRET,{expiresIn:'10m'});console.log(JSON.stringify({token,userToken}));
 }finally{await db.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});`));
 let executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();
 if(!fs.existsSync(executablePath))for(const n of fs.readdirSync('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(n))executablePath='/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome';
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[],base='http://127.0.0.1:3002';
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(token=>localStorage.setItem('adminToken',token),fixture.token);
 await page.route('**/js/roomEditor.js?*',async route=>{const response=await route.fetch();await route.fulfill({response,body:`
 THREE.WebGLRenderer=class extends THREE.WebGLRenderer{constructor(...args){super(...args);const original=this.render;this.render=(scene,camera)=>{window.calibrationScene=scene;window.calibrationCamera=camera;return original.call(this,scene,camera);};}};
 `+await response.text()});});
 const catalog=base+'/api/admin/rooms/avatar-catalog';
 assert.equal((await page.request.get(catalog)).status(),401);
 assert.equal((await page.request.get(catalog,{headers:{Authorization:'Bearer '+fixture.userToken}})).status(),403);
 assert.equal((await page.request.get(catalog,{headers:{Authorization:'Bearer '+fixture.token}})).status(),200,'administrator catalog requires no personal user token');
 const url=base+'/room_editor.html?template='+key;
 await page.goto(url);await page.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===6);
 await page.click('#show-room');await page.locator('#avatar-calibration-panel').evaluate(n=>n.open=true);
 await page.selectOption('#calibration-seat','0');
 await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false'&&calibrationScene.children.some(g=>g.userData.editorSeatAvatar&&g.visible&&g.userData.roomSeatRig?.supported));
 // Capture world furniture/seat transforms independently of avatar size.
 const before=await page.evaluate(()=>calibrationScene.children.filter(g=>g.userData.roomObjectId).map(g=>[g.userData.roomObjectId,g.position.toArray(),g.quaternion.toArray(),g.scale.toArray()]));
 await page.locator('#room-avatar-scale').fill('1.4');await page.locator('#room-avatar-scale').dispatchEvent('input');
 const catalogData=await (await page.request.get(catalog,{headers:{Authorization:'Bearer '+fixture.token}})).json();
 for(const preset of catalogData.presets){
  await page.waitForFunction(()=>!document.getElementById('calibration-avatar').disabled);
  await page.selectOption('#calibration-avatar',preset.id);
  await page.waitForFunction(id=>calibrationScene.children.some(g=>g.userData.editorSeatAvatar&&g.userData.accountAvatarConfig?.builtinId===id&&!g.userData.editorAvatarLoading),preset.id);
  const actual=await page.evaluate(()=>{
   const g=calibrationScene.children.find(g=>g.userData.editorSeatAvatar);g.updateWorldMatrix(true,true);
   return {scale:g.scale.x,hips:g.userData.roomSeatRig.found.hips.getWorldPosition(new THREE.Vector3()).distanceTo(g.getWorldPosition(new THREE.Vector3()))};
  });assert.equal(actual.scale,1.4);assert(actual.hips<1e-6);
 }
 assert.deepEqual(await page.evaluate(()=>calibrationScene.children.filter(g=>g.userData.roomObjectId).map(g=>[g.userData.roomObjectId,g.position.toArray(),g.quaternion.toArray(),g.scale.toArray()])),before);
 await page.click('#calibration-front');await page.locator('#viewport').screenshot({path:'/tmp/avatar-calibration-front.png'});
 await page.click('#calibration-side');await page.locator('#viewport').screenshot({path:'/tmp/avatar-calibration-side.png'});
 await page.screenshot({path:'/tmp/avatar-calibration-editor.png'});
 const visibleChairs=()=>page.evaluate(()=>calibrationScene.children.filter(g=>g.visible&&RoomEditorObjects.get(g.userData.roomObjectId)?.template_kind==='chair').length);
 assert.equal(await visibleChairs(),1,'side calibration hides obstructing chairs temporarily');
 await page.click('#calibration-overview');assert.equal(await visibleChairs(),6,'overview restores all chairs');
 await page.click('#calibration-side');assert.equal(await visibleChairs(),1);
 await page.click('#focus-room');assert.equal(await visibleChairs(),6,'room overview restores furniture after calibration');
 await page.selectOption('#calibration-seat','1');await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 await page.click('#template-save');await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 await page.reload();await page.waitForFunction(()=>document.getElementById('room-avatar-scale').value==='1.4');
 await page.click('#template-publish');await page.waitForFunction(()=>/2/.test(document.getElementById('template-status').textContent)&&document.body.getAttribute('aria-busy')==='false');
 const versions=JSON.parse(inside(`(async()=>{try{console.log(JSON.stringify((await db.query('SELECT version,avatar_scale FROM room_templates WHERE template_key=$1 ORDER BY version',[key])).rows));}finally{await db.end();}})();`));
 assert.deepEqual(versions,[{version:1,avatar_scale:1},{version:2,avatar_scale:1.4}]);assert.deepEqual(errors,[]);
 console.log('Real local calibration passed: admin-only catalog, actual office/chairs, three human rigs, fixed hips, unchanged furniture, seat/camera selection, save/reload/publication and immutable prior version.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
 await browser?.close();
 inside(`(async()=>{try{await db.query('BEGIN');await db.query('DELETE FROM room_template_draft_model_refs WHERE template_key=$1',[key]);await db.query('DELETE FROM room_template_drafts WHERE template_key=$1',[key]);await db.query('DELETE FROM room_template_model_refs WHERE template_id IN (SELECT id FROM room_templates WHERE template_key=$1)',[key]);await db.query('DELETE FROM room_templates WHERE template_key=$1',[key]);await db.query('COMMIT');console.log('Temporary QA template removed.');}finally{await db.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});`);
});
