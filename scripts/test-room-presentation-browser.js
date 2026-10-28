/** Shipped controller/screen/PDF.js/worker in Chromium; HTTP and WS messages are fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const express=require('express'),sharp=require('sharp'),{chromium}=require('playwright'),{pdf}=require('./room-media-fixtures');
let server,browser,release,releaseLibrary;
(async()=>{try{
 const room=randomUUID(),epoch=randomUUID(),asset=randomUUID(),image=randomUUID(),slow=randomUUID(),missing=randomUUID();
 const grant={roomId:room,epoch,token:'a'.repeat(43),canControl:true};let requests=[],failImage=false,failLibrary=false,emptyLibrary=false,holdLibrary=false,denyLibrary=false;
 const green=await sharp({create:{width:80,height:60,channels:3,background:'#00ff00'}}).webp().toBuffer();
 const app=express();app.use('/vendor/room-pdf/5.5.207',express.static(path.dirname(require.resolve('pdfjs-dist/package.json'))));
 app.get('/api/config/language',(_q,s)=>s.json({language:'en-US'}));
 app.get('/api/my/rooms/:id/materials',async(_q,s)=>{
  if(holdLibrary)await new Promise(r=>releaseLibrary=r);if(s.destroyed)return;
  if(denyLibrary)return s.sendStatus(401);if(failLibrary)return s.sendStatus(503);
  s.json({materials:emptyLibrary?[]:[{id:asset,name:'Обзор проекта — план встречи и материалы.pdf',state:'ready',kind:'pdf',pageCount:2}]});
 });
 app.get('/api/rooms/:slug/presentation/materials/:id/content',async(q,s)=>{
  assert.equal(q.headers.authorization,'Bearer fixture');assert.equal(q.headers['x-room-session'],grant.token);assert(!q.url.includes('token='));requests.push(q.params.id);
  if(q.params.id===slow)await new Promise(r=>release=r);
  if(s.destroyed)return;if(q.params.id===missing||q.params.id===image&&failImage)return s.sendStatus(404);
  s.type(q.params.id===image?'image/webp':'application/pdf').send(q.params.id===image?green:pdf({script:true}));
 });
 app.get('/play',(_q,s)=>s.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/room-screen-preview.css"><link rel="stylesheet" href="/css/meeting.css"><link rel="stylesheet" href="/css/room-presentation.css"><body class="meeting-session"><div id="meeting-toolbar"><div class="meeting-actions"><button>Exit</button><button>Seats</button><button id="btn-language">EN</button></div></div>
  <script>window.ACTIVE_ROOM={id:'${room}',slug:'fixture',name:'Переговорная для встреч команды'};window.sent=[];window.online=true;window.WSClient={isConnected:()=>online,ws:{send:m=>sent.push(JSON.parse(m))}};</script>
  <script src="/i18n/i18n.js"></script><script src="/js/lib/three.min.js"></script><script src="/js/roomScreen.js"></script>
  <script src="/js/roomScreenPreview.js"></script><script src="/js/roomScreenRenderer.js"></script><script src="/js/roomPresentationProtocol.js"></script>
  <script src="/js/roomMediaRenderer.js"></script><script src="/js/roomPresentation.js"></script>
  <script>i18n.init().then(()=>{window.model=RoomScreenRenderer.create(RoomScreen.create().screen);window.view=model.userData.presentation;window.ready=true;});</script></body>`));
 app.use(express.static(path.resolve(__dirname,'../public')));server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();try{await fs.access(executable);}catch(_){for(const n of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(n))executable='/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome';}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  localStorage.setItem('token','fixture');window.previewObservers=new Set();const Native=window.ResizeObserver;
  window.ResizeObserver=class extends Native{observe(target,...args){if(target.classList.contains('screen-preview-frame'))window.previewObservers.add(this);return super.observe(target,...args);}disconnect(){window.previewObservers.delete(this);return super.disconnect();}};
 });await page.goto('http://127.0.0.1:'+server.address().port+'/play');await page.waitForFunction(()=>window.ready);
 let revision=0;
 const state=(id=asset,index=0)=>({roomId:room,epoch,revision:String(++revision),asset:id?{id,name:id===image?'Image.webp':id===asset?'Обзор проекта — план встречи и материалы.pdf':'Fixture.pdf',kind:id===image?'image':'pdf',pageCount:id===image?1:2}:null,pageIndex:index});
 const deliver=value=>page.evaluate(v=>RoomPresentation.message('ROOM_PRESENTATION_STATE',v),value);
 const pixel=()=>page.evaluate(()=>[...view.canvas.getContext('2d').getImageData(view.canvas.width/2,view.canvas.height/2,1,1).data].slice(0,3));
 const color=async rgb=>{await page.waitForFunction(rgb=>{const c=view.canvas,p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return rgb.every((v,i)=>Math.abs(p[i]-v)<15);},rgb);
  if(await page.locator('.presentation-slide-preview').isVisible())await page.waitForFunction(rgb=>{const c=document.querySelector('.presentation-slide-preview canvas');if(!c||c.hidden||!c.width)return false;const p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return rgb.every((v,i)=>Math.abs(p[i]-v)<15);},rgb);
 };
 await page.evaluate(g=>{RoomPresentation.joined();RoomPresentation.message('ROOM_PRESENTATION_SESSION',g);},grant);
 let current=state(asset,1);await deliver(current);assert.equal(requests.length,0,'metadata before scene never fetches files');
 await page.evaluate(()=>RoomPresentation.attach(view));await color([0,0,255]);assert.equal(requests.filter(id=>id===asset).length,1);
 assert(await page.locator('#meeting-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth),'mobile meeting toolbar has no overflow');
 assert.equal(await page.evaluate(()=>window.fixturePdfExecuted),undefined);
 await page.evaluate(()=>RoomScreenPreview.open(view.canvas,'Preview'));await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 const count=await page.evaluate(()=>sent.length);current=state(asset,0);await deliver(current);await color([255,0,0]);
 assert.equal(requests.filter(id=>id===asset).length,1,'page changes reuse the document');
 await page.waitForFunction(()=>document.querySelector('dialog canvas').getContext('2d').getImageData(640,360,1,1).data[0]===255);
 assert.equal(await page.evaluate(()=>sent.length),count,'enlarging and zooming send no commands');
 await page.keyboard.press('Escape');
 await page.locator('#presentation-manage').click();await page.waitForFunction(()=>document.querySelector('dialog select').options.length===1);
 await color([255,0,0]);assert.equal(requests.filter(id=>id===asset).length,1,'presenter preview reuses the already loaded screen frame');
 await page.getByRole('button',{name:'Next slide',exact:true}).click();
 const command=await page.evaluate(()=>sent.find(m=>m.type==='ROOM_PRESENTATION_COMMAND').payload);
 assert.equal(command.expectedRevision,current.revision);assert.deepEqual(command.command,{type:'page',pageIndex:1});assert.equal(command.expectedEpoch,epoch);
 current=state(asset,1);await page.evaluate(({command,current})=>RoomPresentation.message('ROOM_PRESENTATION_RESULT',{requestId:command.requestId,success:true,state:current}),{command,current});await color([0,0,255]);
 await page.getByRole('button',{name:'Previous slide',exact:true}).click();
 const conflict=await page.evaluate(()=>sent.filter(m=>m.type==='ROOM_PRESENTATION_COMMAND').at(-1).payload);
 await page.evaluate(({requestId,current})=>RoomPresentation.message('ROOM_PRESENTATION_RESULT',{requestId,success:false,code:'PRESENTATION_CHANGED',state:current}),{requestId:conflict.requestId,current});
 assert.equal(await page.evaluate(()=>sent.filter(m=>m.type==='ROOM_PRESENTATION_COMMAND').length),2,'conflicts never replay the command');
 assert.equal((await page.evaluate(()=>sent.at(-1))).type,'ROOM_PRESENTATION_GET_STATE');await deliver(current);
 // Shortcut scope is the owner panel; all commands share the existing confirmation guards.
 const commandsSent=()=>page.evaluate(()=>sent.filter(m=>m.type==='ROOM_PRESENTATION_COMMAND').length);
 let shortcutCount=await commandsSent();
 await page.locator('.presentation-close').focus();await page.keyboard.press('ArrowRight');assert.equal(await commandsSent(),shortcutCount,'last page is clamped');
 for(const key of ['ArrowLeft','PageDown','PageUp','ArrowRight']){
  await page.locator('.presentation-close').focus();await page.keyboard.press(key);
  assert.equal(await commandsSent(),++shortcutCount);
  const request=await page.evaluate(()=>sent.filter(m=>m.type==='ROOM_PRESENTATION_COMMAND').at(-1).payload);
  assert.equal(request.expectedRevision,current.revision);assert.equal(request.expectedEpoch,epoch);
  assert.equal(request.command.pageIndex,current.pageIndex+(key==='ArrowLeft'||key==='PageUp'?-1:1));
  await page.keyboard.press('PageDown');assert.equal(await commandsSent(),shortcutCount,'pending shortcuts are never queued');
  current=state(asset,request.command.pageIndex);
  await page.evaluate(({request,current})=>RoomPresentation.message('ROOM_PRESENTATION_RESULT',{requestId:request.requestId,success:true,state:current}),{request,current});
  await color(current.pageIndex?[0,0,255]:[255,0,0]);
  if(current.pageIndex===0){await page.keyboard.press('ArrowLeft');assert.equal(await commandsSent(),shortcutCount,'first page is clamped');}
 }
 await page.locator('select').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('PageUp');
 assert.equal(await commandsSent(),shortcutCount,'select navigation does not change the shared slide');
 await page.evaluate(()=>{
  const input=document.createElement('input');input.id='shortcut-input';document.querySelector('.presentation-body').append(input);input.focus();
 });await page.keyboard.press('PageUp');assert.equal(await commandsSent(),shortcutCount);
 await page.evaluate(()=>{document.getElementById('shortcut-input').remove();const editable=document.createElement('p');editable.contentEditable='true';editable.id='shortcut-editable';editable.textContent='Editable';document.querySelector('.presentation-body').append(editable);editable.focus();});
 await page.keyboard.press('ArrowLeft');assert.equal(await commandsSent(),shortcutCount,'editable text keeps its cursor keys');
 await page.evaluate(()=>document.getElementById('shortcut-editable').remove());await page.locator('.presentation-close').focus();
 for(const modifiers of [{repeat:true},{isComposing:true},{keyCode:229},{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true}]){
  await page.locator('.presentation-close').evaluate((n,modifiers)=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'PageUp',bubbles:true,cancelable:true,...modifiers})),modifiers);
 }
 assert.equal(await commandsSent(),shortcutCount,'repeats, IME and modified shortcuts are ignored');
 await page.keyboard.press('Escape');await page.keyboard.press('ArrowLeft');assert.equal(await commandsSent(),shortcutCount,'closed panel has no global shortcuts');
 await deliver({...current,revision:'1',pageIndex:0});await deliver({...current,epoch:randomUUID(),revision:'999',pageIndex:0});assert.deepEqual(await pixel(),[0,0,255]);
 // A pending material must not retain the previous slide in the presenter.
 await page.locator('#presentation-manage').click();await page.waitForFunction(()=>document.querySelector('dialog')?.dataset.libraryState==='ready');
 await deliver(state(slow));assert(await page.locator('.presentation-slide-preview canvas').isHidden(),'loading hides the previous confirmed frame');
 await deliver(state(image));await color([0,255,0]);release?.();release=null;
 await deliver(state(null));assert(await page.locator('.presentation-slide-preview').isHidden(),'stopping hides the presenter frame');
 await page.keyboard.press('Escape');
 // Late PDF completion must not draw over the newly selected image or stop state.
 await deliver(state(slow));await page.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('Fixture'));
 await new Promise(r=>setTimeout(r,30));await deliver(state(image));await color([0,255,0]);release?.();release=null;
 await new Promise(r=>setTimeout(r,60));await color([0,255,0]);
 await deliver(state(null));await page.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('Waiting for presentation'));
 await deliver(state(missing));await page.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('Could not'));
 failImage=true;await deliver(state(image));await page.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('Could not'));
 failImage=false;await page.locator('#presentation-refresh').click();assert((await page.evaluate(()=>sent.at(-1))).type==='ROOM_PRESENTATION_GET_STATE');
 await deliver(state(image));await color([0,255,0]);
 // Shared panel variants and local viewer reflow on every supported language.
 current=state(asset,1);await deliver(current);await color([0,0,255]);
 for(const locale of ['en-US','ru-RU','zh-CN']){
  await page.evaluate(l=>i18n.setLocaleLocal(l),locale);
  const translations=JSON.parse(await fs.readFile(path.resolve(__dirname,'../public/i18n/'+locale+'.json'),'utf8'));
  await page.locator('#presentation-manage').click();await page.waitForFunction(()=>document.querySelector('dialog')?.dataset.libraryState==='ready');
  assert.equal(await page.locator('#presentation-heading').textContent(),translations.roomPresentation.title);
  assert.equal(await page.locator('#presentation-shortcuts').textContent(),translations.roomPresentation.keyboardHint);
  assert.equal(await page.locator('#presentation-material').inputValue(),asset,'the active material is selected');
  assert.equal(await page.locator('[data-current]').textContent(),current.asset.name);
  const contrasts=await page.evaluate(()=>{
   const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
   return ['.presentation-hint','[data-current]','.presentation-page','.presentation-now h3','.presentation-commands > .ui-button--primary','.presentation-commands > .ui-button--destructive'].map(selector=>{
    const n=document.querySelector(selector);let p=n,bg;do{bg=getComputedStyle(p).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;p=p.parentElement;}while(p);
    const a=lum(getComputedStyle(n).color),b=lum(bg);return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
   });
  });for(const c of contrasts)assert(c.ratio>=4.5,JSON.stringify(c));
  for(const [width,height] of [[320,568],[375,812],[430,932],[768,1024],[1280,800],[1920,1080],[844,390]]){
   await page.setViewportSize({width,height});
   assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),'presenter has no horizontal overflow');
   assert(await page.locator('.presentation-slide-preview canvas').evaluate(c=>{const b=c.getBoundingClientRect(),p=c.parentElement.getBoundingClientRect();return !c.hidden&&b.width>0&&b.height>0&&b.width<=p.width&&b.height<=p.height;}),'current slide fits its presenter frame');
   const b=await page.locator('dialog').boundingBox();assert(b.x>=0&&b.y>=0&&b.x+b.width<=width+1&&b.y+b.height<=height+1);
  }
  await page.locator('.presentation-close').focus();await page.keyboard.press('Shift+Tab');assert(await page.locator('.presentation-options > .ui-button:visible').evaluate(n=>n===document.activeElement));
  await page.keyboard.press('Tab');assert(await page.locator('.presentation-close').evaluate(n=>n===document.activeElement));
  if(locale==='ru-RU'){
   await page.setViewportSize({width:1280,height:800});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'/tmp/presentation-redesign-desktop.png'});
   await page.setViewportSize({width:375,height:812});await page.screenshot({path:'/tmp/presentation-redesign-mobile.png'});
  }
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));
  assert.equal(await page.evaluate(()=>document.activeElement.id),'presentation-manage');
  const before=await page.evaluate(()=>sent.length);await page.evaluate(()=>RoomScreenPreview.open(view.canvas,'Общий экран переговорной'));
  for(const [width,height] of [[320,568],[375,812],[430,932],[768,1024],[1280,800],[1920,1080],[844,390]]){
   await page.setViewportSize({width,height});
   await page.waitForFunction(()=>{const c=document.querySelector('dialog canvas').getBoundingClientRect(),f=document.querySelector('.screen-preview-frame');return c.width<=f.clientWidth&&c.height<=f.clientHeight;});
   assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),'only the viewer frame may scroll horizontally');
   assert.equal(await page.locator('.screen-preview-close').evaluate(n=>n.offsetHeight>=44&&n.offsetWidth>=44),true);
   const headerHeight=await page.locator('.screen-preview-header').evaluate(n=>n.getBoundingClientRect().height);
   assert(headerHeight<=(width<480?116:70),'compact viewer header '+locale+' '+width+'x'+height+': '+headerHeight);
   assert.equal(await page.locator('.screen-preview-header h2').textContent(),'Общий экран переговорной');

  }
  await page.getByRole('button',{name:translations.roomScreen.zoomIn,exact:true}).click();
  assert.equal(await page.locator('.screen-preview-scale').textContent(),'125%');await page.setViewportSize({width:375,height:812});assert.equal(await page.locator('.screen-preview-scale').textContent(),'125%','resize preserves local zoom');
  await page.getByRole('button',{name:translations.roomScreen.fit,exact:true}).click();assert.equal(await page.locator('.screen-preview-scale').textContent(),'100%');
  await page.locator('.screen-preview-close').focus();await page.keyboard.press('Shift+Tab');assert(await page.locator('.screen-preview-frame').evaluate(n=>n===document.activeElement));await page.keyboard.press('Tab');assert(await page.locator('.screen-preview-close').evaluate(n=>n===document.activeElement));
  if(locale==='ru-RU'){
   await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'/tmp/screen-preview-redesign-desktop.png'});
   await page.setViewportSize({width:375,height:812});await page.screenshot({path:'/tmp/screen-preview-redesign-mobile.png'});
  }
  await page.locator('.screen-preview-frame').focus();await page.keyboard.press('PageDown');await page.keyboard.press('PageUp');
  assert.equal(await page.evaluate(()=>sent.length),before,'local viewer sends no room commands');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));assert.equal(await page.evaluate(()=>window.previewObservers.size),0,'viewer disconnects its resize observer');
 }
 await page.evaluate(()=>i18n.setLocaleLocal('en-US'));await page.setViewportSize({width:1280,height:800});
 // Library errors stay separate from current state and pending command feedback.
 failLibrary=true;await page.locator('#presentation-manage').click();await page.locator('[data-library-retry]').waitFor();
 current=state(asset,0);await deliver(current);await color([255,0,0]);
 assert(await page.locator('.presentation-library-state').textContent().then(t=>t.includes('Could not')));
 assert(await page.locator('[data-command="show"]').isDisabled());
 failLibrary=false;await page.locator('[data-library-retry]').click();await page.waitForFunction(()=>document.querySelector('dialog').dataset.libraryState==='ready');
 await page.getByRole('button',{name:'Next slide',exact:true}).click();
 assert(await page.locator('[data-command="show"]').isDisabled());assert(await page.locator('[data-command="previous"]').isDisabled());assert(await page.locator('[data-command="stop"]').isDisabled());
 assert(await page.locator('[data-feedback]').textContent().then(t=>t.includes('Waiting for confirmation')));
 assert(await page.locator('.presentation-close').isEnabled());
 const pending=await page.evaluate(()=>sent.filter(s=>s.type==='ROOM_PRESENTATION_COMMAND').at(-1).payload);
 current=state(asset,1);await page.evaluate(({id,current})=>RoomPresentation.message('ROOM_PRESENTATION_RESULT',{requestId:id,success:true,state:current}),{id:pending.requestId,current});await color([0,0,255]);
 await page.clock.install();await page.getByRole('button',{name:'Previous slide',exact:true}).click();await page.clock.fastForward(10001);
 await page.waitForFunction(()=>document.querySelector('[data-feedback]').textContent.includes('not confirmed'));
 assert.equal(await page.evaluate(()=>sent.at(-1).type),'ROOM_PRESENTATION_GET_STATE');await deliver(current);await color([0,0,255]);await page.clock.resume();
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));
 emptyLibrary=true;await page.locator('#presentation-manage').click();await page.waitForFunction(()=>document.querySelector('dialog').dataset.libraryState==='empty');
 assert(await page.locator('[data-command="show"]').isDisabled());assert(await page.locator('[data-command="stop"]').isEnabled());await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));emptyLibrary=false;
 holdLibrary=true;await page.locator('#presentation-manage').click();await page.waitForFunction(()=>document.querySelector('dialog').dataset.libraryState==='loading');
 assert(await page.locator('select').isDisabled());await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));holdLibrary=false;releaseLibrary?.();releaseLibrary=null;
 denyLibrary=true;await page.locator('#presentation-manage').click();await page.waitForFunction(()=>!document.querySelector('dialog'));denyLibrary=false;
 // Keyboard panning and zoom bounds affect only the local canvas.
 await page.evaluate(()=>RoomScreenPreview.open(view.canvas,'Preview'));
 for(let i=0;i<8;i++)await page.getByRole('button',{name:'Zoom in',exact:true}).click();assert(await page.getByRole('button',{name:'Zoom in',exact:true}).isDisabled());
 await page.locator('.screen-preview-frame').focus();await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>document.querySelector('.screen-preview-frame').scrollLeft>0);
 await page.getByRole('button',{name:'Fit to window',exact:true}).click();assert.equal(await page.locator('.screen-preview-scale').textContent(),'100%');
 for(let i=0;i<2;i++)await page.getByRole('button',{name:'Zoom out',exact:true}).click();assert(await page.getByRole('button',{name:'Zoom out',exact:true}).isDisabled());
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));
 await page.locator('#presentation-manage').click();await page.waitForFunction(()=>document.querySelector('dialog')?.dataset.libraryState==='ready');
 const zoomStyle=await page.addStyleTag({content:'.room-presentation-dialog{font-size:28px}.room-presentation-dialog h2{font-size:44px}'});
 await page.setViewportSize({width:320,height:568});assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth));await zoomStyle.evaluate(n=>n.remove());
 await page.evaluate(g=>RoomPresentation.message('ROOM_PRESENTATION_SESSION',{...g,canControl:false}),grant);await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert(await page.locator('#presentation-manage').isHidden(),'role loss closes the owner panel');
 const afterRoleLoss=await commandsSent();await page.keyboard.press('PageDown');assert.equal(await commandsSent(),afterRoleLoss,'role loss removes shortcut scope');
 // A participant has the same renderer and no owner controls.
 await page.evaluate(g=>{RoomPresentation.disconnected();RoomPresentation.joined();RoomPresentation.message('ROOM_PRESENTATION_SESSION',{...g,canControl:false});},grant);
 await deliver(state(asset,1));await color([0,0,255]);assert(await page.locator('#presentation-manage').isHidden());
 await page.evaluate(()=>RoomScreenPreview.open(view.canvas,'Preview'));
 await page.evaluate(()=>{online=false;RoomPresentation.disconnected();});await page.waitForFunction(()=>!document.querySelector('dialog'));
 const offline=await page.evaluate(()=>sent.length);await page.evaluate(()=>RoomPresentation.joined());assert.equal(await page.evaluate(()=>sent.length),offline,'offline actions are never queued');
 await page.evaluate(g=>{online=true;RoomPresentation.joined();RoomPresentation.message('ROOM_PRESENTATION_SESSION',g);},grant);
 await deliver(state(slow));await new Promise(r=>setTimeout(r,30));
 await page.evaluate(()=>{RoomPresentation.stop();window.disposed=0;model.traverse(o=>{o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});});release?.();
 await new Promise(r=>setTimeout(r,80));assert.equal(await page.locator('#presentation-manage').count(),0);assert.equal(await page.locator('dialog').count(),0);
 assert.equal(await page.evaluate(()=>window.previewObservers.size),0,'exit releases local viewer observers');
 assert.deepEqual(errors,[]);
 console.log('Chromium presentation redesign (3 locales/7 viewports, library retry/pending/role loss, fit/resize/keyboard pan): buffered snapshots, real PDF worker/pages, canvas texture and live enlarged view, mobile owner controls, strict revisions, cached page changes, image/stop/failure retry, participant UI, offline and late-load exit cleanup OK (fixture HTTP/WS)');
}finally{release?.();releaseLibrary?.();await browser?.close();await new Promise(r=>server?server.close(r):r());}})().catch(e=>{console.error(e);process.exitCode=1;});
