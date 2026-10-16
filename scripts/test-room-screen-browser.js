/** Shipped editor and Three.js. Only HTTP fixtures are substituted. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const express=require('express'),{chromium}=require('playwright');
const {publicationErrors}=require('../src/services/roomTemplateEditor');
const {readBundle}=require('../src/services/roomBuiltinBundle');
const root=path.resolve(__dirname,'../public');
let browser,server;
(async()=>{try{
 const bundle=await readBundle(path.resolve(__dirname,'../database/seeds/meeting-six-v1'));
 let draft={name:'Screen fixture',revision:1,base_version:1,layout:bundle.layout.map((i,n)=>({...i,editor_id:n+1}))},published=0;
 const app=express();app.use(express.json());
 for(const asset of bundle.assets)app.get(asset.runtimePath,(_req,res)=>res.type('model/gltf-binary').send(asset.data));
 app.all('/api/config/language',(_req,res)=>res.json({language:'en-US'}));
 app.get('/api/admin/rooms/models',(_req,res)=>res.json({success:true,models:[]}));
 app.all('/api/admin/rooms/templates/screen/draft',(req,res)=>{
  if(req.method==='PUT'){assert(require('../src/services/roomTemplateLayout').validLayout(req.body.layout));draft={...draft,...req.body,revision:draft.revision+1};}
  res.json({success:true,draft});
 });
 app.post('/api/admin/rooms/templates/screen/publish',(_req,res)=>{
  const errors=publicationErrors(draft.layout,'meeting-six');
  if(errors.length)return res.status(422).json({success:false,error:errors.join('; ')});
  published++;res.json({success:true,draft,version:2});
 });
 app.get('/js/roomEditor.js',async(_req,res)=>res.type('js').send(`
 const Session=RoomTemplateSession;window.RoomTemplateSession=class extends Session{constructor(...args){super(...args);window.fixtureSession=this;}};
 THREE.WebGLRenderer=class extends THREE.WebGLRenderer{constructor(...args){super(...args);const render=this.render;this.render=(scene,camera)=>{window.fixtureScene=scene;return render.call(this,scene,camera);};}};
 `+await fs.readFile(path.join(root,'js/roomEditor.js'),'utf8')));
 app.use(express.static(root));server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();
 try{await fs.access(executable);}catch(_){for(const n of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(n))executable='/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome';}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.addInitScript(()=>localStorage.setItem('adminToken','fixture'));
 const url='http://127.0.0.1:'+server.address().port+'/room_editor.html?template=screen';await page.goto(url);
 await page.waitForFunction(()=>window.fixtureScene&&document.body.getAttribute('aria-busy')!=='true'&&document.querySelectorAll('#object-list button').length===7);
 await page.locator('#add-screen').click();await page.waitForFunction(()=>document.querySelector('#screen-fields:not([hidden])'));
 const screenId=await page.locator('#object-list .selected').getAttribute('data-id');
 assert(await page.locator('#add-screen').isDisabled());assert(await page.locator('#scale-mode').isDisabled());
 assert(await page.locator('#template-object-actions').isHidden());assert(await page.locator('#object-collision').isHidden());assert(await page.locator('#rot-x').isHidden());
 assert.equal(await page.locator('#seat-object option[value="'+screenId+'"]').count(),0);
 const results=await page.evaluate(async id=>{
  const rejects=[];
  for(const [p,b,m] of [[`/objects/${id}/copy`,{},'POST'],[`/objects/${id}`,{model_id:1},'PATCH'],['/screen',{},'POST']]){
   try{await fixtureSession.api(p,{method:m,body:JSON.stringify(b)});rejects.push(false);}catch(_){rejects.push(true);}
  }
  return rejects;
 },Number(screenId));assert.deepEqual(results,[true,true,true]);
 // Move to a known interior center from the real bundle; corners, not GLB occlusion, are tested here.
 const env=draft.layout.find(i=>i.type==='room_environment'),b=env.environment.bounds;
 const center=require('../public/js/roomEnvironment').toWorld({x:(b.min.x+b.max.x)/2,y:(b.min.y+b.max.y)/2,z:(b.min.z+b.max.z)/2},env);
 for(const a of ['x','y','z'])await page.locator('#pos-'+a).fill(String(center[a]));
 await page.locator('#screen-width').fill('2');await page.locator('#screen-ratio').selectOption('4:3');
 assert.equal(await page.locator('#screen-height').inputValue(),'1.5');
 await page.locator('#edit-form button[type="submit"]').click();await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 await page.locator('#template-save').click();await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 assert.equal(draft.layout.find(i=>i.type==='presentation_screen').screen.width,2);
 await page.reload();await page.locator('#object-list [data-id="'+screenId+'"]').click();
 assert.equal(await page.locator('#screen-width').inputValue(),'2');
 await page.locator('#screen-preview').click();assert(await page.locator('dialog').isVisible());
 if(process.env.ROOM_SCREEN_SCREENSHOT)await page.screenshot({path:process.env.ROOM_SCREEN_SCREENSHOT});
 await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('dialog')));
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert.equal(await page.evaluate(()=>document.activeElement.id),'screen-preview');
 assert.equal(await page.locator('#object-list .selected').getAttribute('data-id'),screenId);
 await page.locator('#pos-y').fill('100');await page.locator('#edit-form button[type="submit"]').click();
 await page.waitForFunction(()=>!!document.querySelector('#placement-issues [data-type="objectOutside"]'));
 await page.locator('#template-publish').click();await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');assert.equal(published,0);
 await page.locator('#pos-y').fill(String(center.y));await page.locator('#edit-form button[type="submit"]').click();
 await page.locator('#template-publish').click();await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');assert.equal(published,1);
 await page.locator('#delete-object').click();await page.waitForFunction(()=>!document.querySelector('#screen-fields:not([hidden])'));
 assert.equal(await page.locator('#add-screen').isDisabled(),false);
 assert.deepEqual(errors,[]);
 console.log('Chromium screen editor: real bundled office, create/reload/resize/presets/delete, forbidden operations, corners/publication, modal Escape/focus OK (fixture API)');
}finally{await browser?.close();await new Promise(r=>server?server.close(r):r());}})().catch(e=>{console.error(e);process.exitCode=1;});
