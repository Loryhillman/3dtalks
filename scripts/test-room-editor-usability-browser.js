/** Real editor/Three.js in Chromium, with an isolated in-memory API and GLB fixture. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../public');
const roomId = '11111111-1111-4111-8111-111111111111';
const model = {id:1,name:'Fixture chair',path:'/models/fixture.glb',file_type:'glb'};
const row = (id,x) => ({id,type:'uploaded_model',name:'Chair '+id,model_path:model.path,model_id:1,position_x:x,position_y:0,position_z:0,rotation_x:0,rotation_y:0,rotation_z:0,scale_x:1,scale_y:1,scale_z:1,has_collision:true});
let rows=[row(1,-2),row(2,2)], nextId=3, rejectPatch=false, posts=0, loads=0;
const binary=Buffer.alloc(36);[-1,0,0,1,0,0,0,1,0].forEach((v,i)=>binary.writeFloatLE(v,i*4));
let json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,1,0]}]}));
json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);
const glb=Buffer.concat([header,json,binHeader,binary]);
const draft={name:'Fixture',revision:1,base_version:3,layout:[1,2].map(id=>({editor_id:id,type:'uploaded_model',kind:'furniture',name:'Chair '+id,model_id:1,model_path:model.path,position:{x:id===1?-2:2,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},collision:true,seats:[]}))};
const room={id:roomId,name:'Fixture',status:'draft',revision:1,seating_mode:'seated'};
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://local').pathname;
  const reply=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(url==='/models/fixture.glb'){loads++;res.writeHead(200,{'Content-Type':'model/gltf-binary'});return res.end(glb);}
  if(url.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=chunks.length&&req.headers['content-type']?.includes('json')?JSON.parse(Buffer.concat(chunks)):{};
   if(url==='/api/config/language')return reply({language:'en-US'});
   if(url==='/api/admin/rooms/models')return reply({success:true,models:[model]});
   if(url==='/api/admin/rooms/models/upload')return reply({success:true,model:{...model,id:2,display_name:'Uploaded chair',file_name:'chair.glb'}});
   if(url.endsWith('/templates/fixture/draft')){if(req.method==='PUT')Object.assign(draft,body,{revision:draft.revision+1});return reply({success:true,draft});}
   if(url===`/api/admin/rooms/${roomId}`)return reply({success:true,room});
   if(url.endsWith('/seats'))return reply({success:true,seats:[],room});
   if(url.endsWith('/objects')){
    if(req.method==='POST'){posts++;await new Promise(r=>setTimeout(r,70));const object={...row(nextId++,0),...body,model_path:model.path};rows.push(object);return reply({success:true,object});}
    return reply({success:true,objects:rows});
   }
   const match=/\/objects\/(\d+)$/.exec(url);
   if(match){const object=rows.find(r=>r.id===Number(match[1]));
    if(rejectPatch)return reply({success:false,error:'Fixture save failed'},500);
    if(req.method==='DELETE')rows=rows.filter(r=>r!==object);else Object.assign(object,body);
    return reply({success:true,object});
   }
   throw new Error('Unexpected API '+url);
  }
  const file=path.resolve(root,'.'+url);if(!file.startsWith(root+path.sep))throw new Error('Invalid path');
  let content=await fs.readFile(file);
  if(url==='/js/roomEditor.js') content=Buffer.from('window.fixtureLoads=0;const fixtureLoad=THREE.GLTFLoader.prototype.load;THREE.GLTFLoader.prototype.load=function(...args){window.fixtureLoads++;return fixtureLoad.apply(this,args);};THREE.WebGLRenderer = class extends THREE.WebGLRenderer { constructor(...args) { super(...args); const render=this.render; this.render=(scene,camera)=>{window.fixtureScene=scene;return render.call(this,scene,camera);}; } };\n'+content.toString());
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/html'});res.end(content);
 }catch(error){res.writeHead(500);res.end(error.message);}
});
async function installedChromium() {
 const cache=path.join(require('node:os').homedir(),'.cache/ms-playwright');
 const candidates=[chromium.executablePath()];
 try {for(const dir of await fs.readdir(cache))if(/^chromium-\d+$/.test(dir))candidates.push(path.join(cache,dir,'chrome-linux64/chrome'));}catch(_){}
 for(const candidate of candidates){try{await fs.access(candidate);return candidate;}catch(_){}}
 throw new Error('Install Chromium with npx playwright install chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE');
}
let browser;
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||await installedChromium(),headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('adminToken','fixture'));
 const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/room_editor.html?room='+roomId);
 await page.waitForFunction(()=>document.querySelectorAll('#object-list button').length===2);
 await page.waitForFunction(()=>window.fixtureScene);
 const first=page.locator('#object-list [data-id="1"]'),second=page.locator('#object-list [data-id="2"]');
 await first.click();
 const groupId=await page.evaluate(()=>fixtureScene.children.find(g=>g.userData.roomObjectId===1).uuid);
 await page.locator('#pos-x').fill('1.41');await second.click();
 assert.equal(rows[0].position_x,1.41,'selection change saves the previous object');
 await first.click();await page.locator('#pos-x').fill('1.73');rejectPatch=true;await second.click();
 await page.waitForFunction(()=>document.getElementById('message').textContent==='Fixture save failed');
 assert.equal(await first.getAttribute('class'),'item selected');assert.equal(await page.locator('#pos-x').inputValue(),'1.73');
 rejectPatch=false;await page.locator('#edit-form button[type="submit"]').click();
 await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 assert.equal(await first.getAttribute('class'),'item selected');
 assert.equal(await page.evaluate(()=>fixtureScene.children.find(g=>g.userData.roomObjectId===1).uuid),groupId,'unchanged model keeps its Three.js group');
 assert.equal(await page.evaluate(()=>fixtureLoads),2,'saving and switching never reload existing GLBs');
 await page.locator('#deselect').click();assert.equal(await page.locator('#object-list .selected').count(),0);
 await first.click();await page.locator('#deselect').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#object-list .selected').count(),0);
 await first.click();const rect=await page.locator('#viewport canvas').boundingBox();
 await page.mouse.move(rect.x+10,rect.y+rect.height-10);await page.mouse.down();await page.mouse.move(rect.x+50,rect.y+rect.height-30);await page.mouse.up();
 assert.equal(await first.getAttribute('class'),'item selected','camera drag must not clear selection');
 await page.mouse.click(rect.x+10,rect.y+rect.height-10);await page.waitForFunction(()=>!document.querySelector('#object-list .selected'));
 await first.click();await page.locator('#add-placement').selectOption('beside');await page.locator('#model-name').fill('New chair');
 await page.evaluate(()=>{const form=document.getElementById('add-form');form.requestSubmit();form.requestSubmit();});
 await page.waitForFunction(()=>document.querySelectorAll('#object-list button').length===3);
 assert.equal(posts,1,'double submission adds one object');
 assert.equal(await page.locator('#object-list .selected').getAttribute('data-id'),'3');
 assert(rows[2].position_x>rows[0].position_x);
 assert.equal(await page.evaluate(()=>fixtureScene.children.find(g=>g.userData.roomObjectId===1).uuid),groupId);
 assert.equal(await page.evaluate(()=>fixtureLoads),3,'only the new GLB is loaded');
 await page.locator('#delete-object').click({trial:true});
 page.once('dialog',d=>d.accept());await page.locator('#delete-object').click();
 await page.waitForFunction(()=>document.querySelectorAll('#object-list button').length===2);
 assert.equal(await page.locator('#object-list .selected').count(),0);
 // Template upload must update the session library before adding the newly uploaded model.
 await page.goto(base+'/room_editor.html?template=fixture');
 await page.waitForFunction(()=>document.querySelectorAll('#object-list button').length===2);
 await page.locator('#model-upload-file').setInputFiles({name:'chair.glb',mimeType:'model/gltf-binary',buffer:glb});
 await page.waitForFunction(()=>document.getElementById('model-id').value==='2'&&document.body.getAttribute('aria-busy')==='false');
 await page.locator('#add-form button[type="submit"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('#object-list button').length===3);
 assert.equal(await page.locator('#object-list .selected').getAttribute('data-id'),'3');

 await page.locator('#copy-object').click();
 await page.waitForFunction(()=>document.querySelectorAll('#object-list button').length===4);
 assert.equal(await page.locator('#object-list .selected').getAttribute('data-id'),'4');
 const copyLoads=await page.evaluate(()=>fixtureLoads);
 await page.locator('#template-save').click();
 await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');
 assert.equal(await page.locator('#object-list .selected').getAttribute('data-id'),'4');
 assert.equal(await page.evaluate(()=>fixtureLoads),copyLoads,'saving a template preserves its selected copy and models');
 assert.deepEqual(errors,[]);
 console.log('Chromium editor: safe selection/save failure, Esc/empty click, camera drag, retained models, placement, duplicate submission, deletion and template GLB upload: OK (isolated mock API)');
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(error=>{console.error(error);process.exitCode=1;});
