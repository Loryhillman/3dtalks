/** Shipped editor and Three.js, isolated API: office rendering, errors/retry and stale loads. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { officeGlb } = require('./room-environment-fixtures');
const root = path.resolve(__dirname,'../public');
const office = {editor_id:1,type:'room_environment',kind:'room',name:'Fixture office',model_id:1,model_path:'/models/uploaded/office.glb',collision:false,
 position:{x:10,y:0,z:-10},rotation:{x:0,y:.6,z:0},scale:{x:.001,y:.001,z:.001},
 environment:{version:1,bounds:{min:{x:-4000,y:0,z:-3000},max:{x:4000,y:3000,z:3000}}},seats:[]};
const seat = {editor_id:2,type:'seat',kind:'seat',name:'Seats',collision:false,position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},
 seats:[{label:'1',sort_order:1,enabled:true,coordinate_space:'rigid',local_position:{x:10,y:1,z:-10},local_orientation:{x:0,y:0,z:0},map_x:0,map_y:0}]};
let draft={name:'Office',revision:1,base_version:1,layout:[office,seat]},fail=false,published=0,loads=0,release;
const app=express();app.use(express.json());
app.get('/models/uploaded/:file',async(req,res)=>{
 loads++;
 if(req.params.file==='slow.glb')await new Promise(resolve=>release=resolve);
 if(fail)return res.sendStatus(404);
 res.type('model/gltf-binary').send(officeGlb({units:1000}));
});
app.all('/api/config/language',(_req,res)=>res.json({language:'en-US'}));
app.get('/api/admin/rooms/models',(_req,res)=>res.json({success:true,models:[{id:1,name:'Office',path:office.model_path,file_type:'glb'}]}));
app.all('/api/admin/rooms/templates/office/draft',(req,res)=>{
 if(req.method==='PUT')draft={...draft,...req.body,revision:draft.revision+1};
 res.json({success:true,draft});
});
app.post('/api/admin/rooms/templates/office/publish',(_req,res)=>{published++;res.json({success:true,draft,version:2});});
app.get('/js/roomEditor.js',async(_req,res)=>res.type('js').send(`
const OriginalSession=RoomTemplateSession;
window.RoomTemplateSession=class extends OriginalSession {constructor(...args){super(...args);window.fixtureSession=this;}};
THREE.WebGLRenderer=class extends THREE.WebGLRenderer {constructor(...args){super(...args);const render=this.render;this.render=(scene,camera)=>{window.fixtureScene=scene;window.fixtureCamera=camera;return render.call(this,scene,camera);};}};
`+await fs.readFile(path.join(root,'js/roomEditor.js'),'utf8')));
app.use(express.static(root));
async function executable(){
 if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
 for(const candidate of [chromium.executablePath(),...(await fs.readdir('/root/.cache/ms-playwright')).filter(n=>/^chromium-\d+$/.test(n)).map(n=>'/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome')]){
  try{await fs.access(candidate);return candidate;}catch(_){}
 }
 throw Error('Chromium is not installed');
}
let server,browser;
(async()=>{try{
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 browser=await chromium.launch({executablePath:await executable(),headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>localStorage.setItem('adminToken','fixture'));
 const url='http://127.0.0.1:'+server.address().port+'/room_editor.html?template=office';
 await page.goto(url);
 await page.waitForFunction(()=>document.getElementById('environment-load-status').textContent==='Room loaded');
 const state=await page.evaluate(()=>{
  const env=fixtureScene.children.find(n=>n.userData.roomObjectId===1);let meshes=0;env.traverse(n=>{if(n.isMesh)meshes++;});
  return {meshes,type:RoomEditorObjects.get(1).type,environment:RoomEditorObjects.get(1).is_room_environment,shell:RoomEditorObjects.get(1).is_room_shell,
   size:document.getElementById('environment-size').textContent,objects:document.querySelectorAll('#object-list button').length,
   parents:document.getElementById('seat-object').options.length,helper:fixtureScene.children.find(n=>n.userData.roomEnvironmentBounds).visible,
   seats:RoomSeatEditor.seats?.()};
 });
 assert.equal(state.meshes,8);assert.equal(state.type,'uploaded_model');assert.equal(state.environment,true);assert.equal(state.shell,false);
 assert.equal(state.size,'8 × 3 × 6 m');assert.equal(state.objects,0);assert.equal(state.parents,1);assert.equal(state.helper,true);
 await page.locator('#preview-mode').click();
 assert.equal(await page.evaluate(()=>fixtureScene.children.find(n=>n.userData.roomEnvironmentBounds).visible),false);
 await page.locator('#preview-mode').click();
 await page.locator('#show-room').click();
 assert.equal(await page.locator('#room-shell-hint').isVisible(),false);
 await page.locator('#environment-bounds').uncheck();
 assert.equal(await page.evaluate(()=>fixtureScene.children.find(n=>n.userData.roomEnvironmentBounds).visible),false);
 await page.locator('#environment-bounds').check();
 const before=await page.evaluate(()=>({uuid:fixtureScene.children.find(n=>n.userData.roomObjectId===1).uuid,camera:fixtureCamera.position.toArray()}));
 await page.locator('#template-name').fill('Renamed office');await page.locator('#template-save').click();
 await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 assert.deepEqual(await page.evaluate(()=>({uuid:fixtureScene.children.find(n=>n.userData.roomObjectId===1).uuid,camera:fixtureCamera.position.toArray()})),before);
 assert.equal(loads,1,'saving does not download the office again');assert.equal(draft.layout[1].seats[0].local_position.x,10,'independent seat stays in world coordinates');
 // Inject future room replacement through the draft adapter; ordinary furniture reload exercises cancellation.
 async function replace(file){
  await page.evaluate(file=>{fixtureSession.draft.layout[0].model_path='/models/uploaded/'+file;document.getElementById('model-name').value='Extra fixture';document.getElementById('add-form').requestSubmit();},file);
  await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 }
 await replace('slow.glb');await page.waitForFunction(()=>document.getElementById('environment-load-status').textContent==='Loading room…');
 await replace('office.glb');await page.waitForFunction(()=>document.getElementById('environment-load-status').textContent==='Room loaded');
 release();
 await page.waitForFunction(()=>fixtureScene.children.filter(n=>n.userData.roomObjectId===1).length===1);
 assert.equal(await page.evaluate(()=>RoomEditorObjects.get(1).model_path),office.model_path);
 fail=true;await replace('missing.glb');
 await page.waitForFunction(()=>document.getElementById('environment-load-status').textContent.includes('404'));
 assert.equal(await page.evaluate(()=>fixtureScene.children.find(n=>n.userData.roomObjectId===1).children.length),0,'failed office has no misleading cube');
 await page.locator('#template-publish').click();await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');assert.equal(published,0,'unloaded office cannot be published');
 fail=false;await page.locator('#show-room').click();await page.locator('#environment-retry').click();
 await page.waitForFunction(()=>document.getElementById('environment-load-status').textContent==='Room loaded');
 assert.equal(await page.locator('#environment-retry').isVisible(),false);
 assert.deepEqual(errors,[]);
 console.log('Chromium office editor: real GLB/DTO, independent seat, bounds, retained camera/model, stale replacement, HTTP error, retry and publication guard OK (isolated API)');
}finally{release?.();await browser?.close();if(server)await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
