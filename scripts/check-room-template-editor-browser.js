// Local opt-in check. Creates temporary templates/models and removes them in finally.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
if (process.env.ROOM_EDITOR_BROWSER_CHECK !== '1') throw new Error('Set ROOM_EDITOR_BROWSER_CHECK=1 to check the local Docker installation');
process.chdir(require('node:path').resolve(__dirname, '..'));
const app=execFileSync('docker',['compose','-f','compose.yaml','ps','-q','app'],{encoding:'utf8'}).trim();
const key='editorcheck-'+randomUUID().replaceAll('-','');
const db=`const {Pool}=require('pg');const fs=require('fs');const pool=new Pool({host:process.env.DB_HOST,port:process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});`;
const seed=db+`(async()=>{try{const key=process.argv[1];const admin=(await pool.query('SELECT id,username FROM admin_users WHERE is_active ORDER BY id LIMIT 1')).rows[0];
await pool.query("INSERT INTO room_templates(template_key,version,name,layout) SELECT $1,version,'Проверка редактора',layout FROM room_templates WHERE template_key='meeting-six' AND version=3",[key]);
const file='/models/uploaded/'+key+'.glb';const source=(await pool.query('SELECT path FROM uploaded_models ORDER BY id LIMIT 1')).rows[0].path;fs.copyFileSync('/app/public'+source,'/app/public'+file);
const model=(await pool.query("INSERT INTO uploaded_models(file_name,saved_file_name,path,file_type,file_size) VALUES ($1,$1,$2,'glb',$3) RETURNING id",[key+'.glb',file,fs.statSync('/app/public'+file).size])).rows[0];
const secrets=JSON.parse(fs.readFileSync('/app/.local-state/secrets.json'));const token=require('jsonwebtoken').sign({adminUserId:admin.id,username:admin.username,type:'admin'},secrets.ADMIN_JWT_SECRET,{expiresIn:'10m'});console.log(JSON.stringify({token,modelId:model.id,key}));}finally{await pool.end()}})().catch(e=>{console.error(e.message);process.exitCode=1});`;
let fixture,browser;
(async()=>{
 try{
 fixture=JSON.parse(execFileSync('docker',['exec',app,'node','-e',seed,key],{encoding:'utf8'}));
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function page(){const p=await browser.newPage({viewport:{width:1500,height:1000}});await p.addInitScript(token=>{localStorage.setItem('adminToken',token);localStorage.setItem('locale','ru-RU')},fixture.token);p.on('dialog',d=>d.type()==='prompt'?d.accept('2'):d.accept());return p;}
 const p=await page(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:3002/room_editor.html?template='+key);
 await p.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===6);
 assert.equal(await p.locator('#object-list button').count(),7);
 await p.locator('#show-seats').click();
 for(const label of ['1','3','5','2']){
   await p.locator('#seat-list button[data-label="'+label+'"]').click();
   assert.equal(await p.locator('#seat-label').inputValue(),label);
 }
 await p.locator('#show-objects').click();
 const panels=await p.evaluate(()=>['element-panel','viewport','properties-panel'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,right:r.right,y:r.y,bottom:r.bottom};}));
 assert(panels[0].right<=panels[1].x && panels[1].right<=panels[2].x);
 await p.locator('#element-search').fill('Стул 1');assert.equal(await p.locator('#object-list button:visible').count(),1);await p.locator('#element-search').fill('');
 await p.screenshot({path:'/tmp/room-editor-panels.png'});
 // Room shell has its own panel and never appears in the furniture list.
 await p.locator('#show-room').click();assert.equal(await p.locator('#room-surface-list button').count(),6);
 assert.equal(await p.locator('#envelope-width').inputValue(),'23.8');
 await p.evaluate(()=>{const original=GeometryRenderer.renderFromComponents;GeometryRenderer.renderFromComponents=function(c,t){const g=original.call(this,c,t);if(c.some(x=>x.surface))window.__roomShellGroup=g;return g;};});
 await p.locator('#envelope-width').fill('26');
 await p.locator('#room-surface-list [data-surface="floor"]').click();
 await p.locator('#surface-mode').selectOption('image');
 const png=await p.evaluate(key=>{const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const c=canvas.getContext('2d');c.fillStyle='#dcc1a3';c.fillRect(0,0,200,100);c.fillStyle='#3b475b';c.fillRect(0,0,100,50);c.fillRect(100,50,100,50);c.fillStyle='white';c.fillText(key,3,25);return canvas.toDataURL('image/png').split(',')[1];},key);
 const upload=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/surface-images')),p.locator('#surface-upload').setInputFiles({name:'surface.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')})]);
 assert.equal(upload[0].status(),201);fixture.imagePath=(await upload[0].json()).image.path;
 await p.waitForFunction(()=>window.__roomShellGroup?.children.find(m=>m.userData.roomSurface==='floor')?.material[2].map?.image);
 let uv=await p.evaluate(()=>{const t=__roomShellGroup.children.find(m=>m.userData.roomSurface==='floor').material[2].map;return [t.repeat.x,t.repeat.y];});
 assert(Math.abs(uv[0]-.655)<1e-6);assert.equal(uv[1],1);
 await p.locator('#surface-mode').selectOption('texture');await p.locator('#surface-tile-width').fill('2');await p.locator('#surface-tile-height').fill('3');
 await p.waitForFunction(()=>window.__roomShellGroup?.children.find(m=>m.userData.roomSurface==='floor')?.material[2].map?.image);
 uv=await p.evaluate(()=>{const t=__roomShellGroup.children.find(m=>m.userData.roomSurface==='floor').material[2].map;return [t.repeat.x,t.repeat.y];});
 assert(Math.abs(uv[0]-13.1)<1e-6);assert(Math.abs(uv[1]-20/3)<1e-6);
 await p.locator('#room-surface-list [data-surface="north"]').click();await p.locator('#surface-color').fill('#223344');
 const shellSave=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='PUT'),p.locator('#template-save').click()]);
 assert.equal(shellSave[0].status(),200);
 const shell=(await shellSave[0].json()).draft.layout.find(i=>i.type==='room_shell');assert.equal(shell.envelope.width,26);assert.equal(shell.envelope.surfaces.floor.image,fixture.imagePath);
 await p.reload();await p.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===6);
 await p.locator('#show-room').click();assert.equal(await p.locator('#envelope-width').inputValue(),'26');
 assert.equal(await p.locator('#surface-color').inputValue(),'#223344');
 await p.locator('#room-surface-list [data-surface="floor"]').click();assert.equal(await p.locator('#surface-mode').inputValue(),'texture');assert.equal(await p.locator('#surface-tile-height').inputValue(),'3');
 await p.screenshot({path:'/tmp/room-envelope-editor.png'});
 const badUpload=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/surface-images')),p.locator('#surface-upload').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not an image')})]);assert.equal(badUpload[0].status(),400);
 assert.equal((await p.request.post('http://127.0.0.1:3002/api/admin/rooms/surface-images')).status(),401);
 console.log('Browser: separate room panel, safe image upload, cover/repeat UVs, dimensions, independent surface colors and reload: OK');
 await p.locator('#show-objects').click();
 await p.evaluate(()=>{window.__modelLoads=0;const original=THREE.GLTFLoader.prototype.load;THREE.GLTFLoader.prototype.load=function(url,done,...rest){return original.call(this,url,g=>{window.__modelLoads++;done(g)},...rest)}});
 await p.locator('#object-list button').filter({hasText:'Стул 1'}).click();
 await p.locator('#pos-x').fill('1.41');await p.locator('#scale-y').fill('1.2');await p.locator('#rot-y').fill('30');
 await p.locator('#replace-model').selectOption(String(fixture.modelId));
 await p.locator('#replace-object').click();
 await p.waitForFunction(()=>window.__modelLoads>0);
 assert.equal(await p.locator('#seat-list button').count(),6);
 await p.locator('#object-list button').filter({hasText:'Стул 1'}).click();
 await p.locator('#copy-object').click();
 await p.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===7);
 await p.locator('#object-list button').filter({hasText:'копия'}).click();await p.locator('#delete-object').click();
 await p.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===6);
 await p.locator('#show-seats').click();await p.locator('#seat-list button').first().click();await p.locator('#seat-y').fill('1.25');
 let response=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='PUT'),p.locator('#template-save').click()]);
 assert.equal(response[0].status(),200);
 await p.reload();await p.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===6);
 await p.locator('#object-list button').filter({hasText:'Стул 1'}).click();
 assert.equal(await p.locator('#pos-x').inputValue(),'1.41');assert.equal(await p.locator('#scale-y').inputValue(),'1.2');
 await p.locator('#show-seats').click();await p.locator('#seat-list button').first().click();assert.equal(await p.locator('#seat-y').inputValue(),'1.25');
 // Reparent in world coordinates, independent of the object's scale.
 const xyz=async()=>Promise.all(['x','y','z'].map(a=>p.locator('#seat-'+a).inputValue().then(Number)));
 const near=(a,b)=>a.forEach((v,i)=>assert(Math.abs(v-b[i])<1e-8,`${a} != ${b}`));
 const initial=await xyz();
 await p.locator('#seat-object').selectOption('');near(await xyz(),initial);
 const chair2=await p.locator('#seat-object option').filter({hasText:'Стул 2'}).getAttribute('value');
 await p.locator('#seat-object').selectOption(chair2);near(await xyz(),initial);
 await p.locator('#seat-focus').click();
 await p.locator('#show-objects').click();await p.locator('#object-list button').filter({hasText:'Стул 2'}).click();
 await p.locator('#scale-x').fill('0.01');await p.locator('#scale-y').fill('0.01');await p.locator('#scale-z').fill('0.01');
 await p.locator('#show-seats').click();await p.locator('#seat-list button').first().click();near(await xyz(),initial);
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('room-seat-dragged',{detail:{position:{x:3,y:1.4,z:3},rotation:{x:0,y:.3,z:0}}})));
 near(await xyz(),[3,1.4,3]);
 await p.locator('#seat-object').selectOption('');near(await xyz(),[3,1.4,3]);
 response=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='PUT'),p.locator('#template-save').click()]);assert.equal(response[0].status(),200);
 await p.reload();await p.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===6);
 await p.locator('#show-seats').click();await p.locator('#seat-list button[data-label="1"]').click();
 assert.equal(await p.locator('#seat-object').inputValue(),'');near(await xyz(),[3,1.4,3]);
 // Add a new independent seat, attach it, duplicate furniture, then keep the copy's seat on deletion.
 await p.locator('#seat-new').click();assert.equal(await p.locator('#seat-object').inputValue(),'');
 await p.locator('#seat-x').fill('5');await p.locator('#seat-y').fill('1');await p.locator('#seat-z').fill('5');
 await p.locator('#seat-object').selectOption(chair2);
 await p.locator('#show-objects').click();await p.locator('#object-list button').filter({hasText:'Стул 2'}).click();
 await p.locator('#copy-object').click();await p.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===9);
 p.removeAllListeners('dialog');p.on('dialog',d=>d.type()==='prompt'?d.accept('1'):d.accept());
 await p.locator('#object-list button').filter({hasText:'копия'}).click();await p.locator('#delete-object').click();
 await p.waitForFunction(()=>document.querySelectorAll('#object-list button').length===7);
 assert.equal(await p.locator('#seat-list button').count(),9);
 // Remove extra test seats; keep the original six for remaining publication checks.
 await p.locator('#show-seats').click();
 for(const label of ['7','8','9']){await p.locator('#seat-list button[data-label="'+label+'"]').click();await p.locator('#seat-remove').click();}
 response=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='PUT'),p.locator('#template-save').click()]);assert.equal(response[0].status(),200);
 console.log('Browser: world coordinates, attachment without jumps, scale independence, marker edits, standalone reload, object copy and keep-seats deletion: OK');
 const second=await page();await second.goto('http://127.0.0.1:3002/room_editor.html?template='+key);await second.waitForFunction(()=>document.querySelectorAll('#seat-list button').length===6);
 await p.locator('#template-name').fill('Сохранённая переговорная');
 await Promise.all([p.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='PUT'),p.locator('#template-save').click()]);
 await second.locator('#template-name').fill('Устаревшее изменение');
 response=await Promise.all([second.waitForResponse(r=>r.url().endsWith('/draft')&&r.request().method()==='PUT'),second.locator('#template-save').click()]);assert.equal(response[0].status(),409);
 response=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/publish')),p.locator('#template-publish').click()]);
 const publication=await response[0].json();assert.equal(response[0].status(),200,JSON.stringify(publication));
 const v=publication.version;
 response=await Promise.all([p.waitForResponse(r=>r.url().endsWith('/publish')),p.locator('#template-publish').click()]);assert.equal((await response[0].json()).version,v);
 const deletion=await p.request.delete('http://127.0.0.1:3002/api/uploaded-models/'+fixture.modelId);assert.equal(deletion.status(),409);
 assert.equal((await p.request.get('http://127.0.0.1:3002/models/uploaded/'+key+'.glb')).status(),200);
 await p.locator('#preview-mode').click();assert.equal(await p.locator('#preview-mode').textContent(),'Вернуться к редактированию');
 assert.deepEqual(errors,[]);
 console.log('Browser: GLB rendering, replace/copy/delete, seat form save, reload, conflict, publish retry, asset deletion guard and preview: OK');
 }finally{
 if(browser)await browser.close();
 const cleanup=db+`(async()=>{try{const key=process.argv[1];await pool.query('DELETE FROM room_template_drafts WHERE template_key=$1',[key]);await pool.query('DELETE FROM room_templates WHERE template_key=$1',[key]);await pool.query('DELETE FROM uploaded_models WHERE saved_file_name=$1',[key+'.glb']);fs.rmSync('/app/public/models/uploaded/'+key+'.glb',{force:true});const surface=process.argv[2];if(surface && surface.startsWith('/uploads/room-surfaces/') && !surface.includes('..'))fs.rmSync('/app/public'+surface,{force:true});}finally{await pool.end()}})().catch(e=>{console.error(e.message);process.exitCode=1});`;
 execFileSync('docker',['exec',app,'node','-e',cleanup,key,fixture?.imagePath || ''],{stdio:['ignore','pipe','pipe']});
 }
})().catch(e=>{console.error(e);process.exitCode=1});
