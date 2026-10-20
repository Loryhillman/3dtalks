/** Shipped controller/screen/PDF.js/worker in Chromium; HTTP and WS messages are fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const express=require('express'),sharp=require('sharp'),{chromium}=require('playwright'),{pdf}=require('./room-media-fixtures');
let server,browser,release;
(async()=>{try{
 const room=randomUUID(),epoch=randomUUID(),asset=randomUUID(),image=randomUUID(),slow=randomUUID(),missing=randomUUID();
 const grant={roomId:room,epoch,token:'a'.repeat(43),canControl:true};let requests=[],failImage=false;
 const green=await sharp({create:{width:80,height:60,channels:3,background:'#00ff00'}}).webp().toBuffer();
 const app=express();app.use('/vendor/room-pdf/5.5.207',express.static(path.dirname(require.resolve('pdfjs-dist/package.json'))));
 app.get('/api/config/language',(_q,s)=>s.json({language:'en-US'}));
 app.get('/api/my/rooms/:id/materials',(_q,s)=>s.json({materials:[{id:asset,name:'Fixture.pdf',state:'ready',kind:'pdf',pageCount:2}]}));
 app.get('/api/rooms/:slug/presentation/materials/:id/content',async(q,s)=>{
  assert.equal(q.headers.authorization,'Bearer fixture');assert.equal(q.headers['x-room-session'],grant.token);assert(!q.url.includes('token='));requests.push(q.params.id);
  if(q.params.id===slow)await new Promise(r=>release=r);
  if(s.destroyed)return;if(q.params.id===missing||q.params.id===image&&failImage)return s.sendStatus(404);
  s.type(q.params.id===image?'image/webp':'application/pdf').send(q.params.id===image?green:pdf({script:true}));
 });
 app.get('/play',(_q,s)=>s.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
  <link rel="stylesheet" href="/css/meeting.css"><link rel="stylesheet" href="/css/room-presentation.css"><body class="meeting-session"><div id="meeting-toolbar"><div class="meeting-actions"><button>Exit</button><button>Seats</button><button id="btn-language">EN</button></div></div>
  <script>window.ACTIVE_ROOM={id:'${room}',slug:'fixture'};window.sent=[];window.online=true;window.WSClient={isConnected:()=>online,ws:{send:m=>sent.push(JSON.parse(m))}};</script>
  <script src="/i18n/i18n.js"></script><script src="/js/lib/three.min.js"></script><script src="/js/roomScreen.js"></script>
  <script src="/js/roomScreenPreview.js"></script><script src="/js/roomScreenRenderer.js"></script><script src="/js/roomPresentationProtocol.js"></script>
  <script src="/js/roomMediaRenderer.js"></script><script src="/js/roomPresentation.js"></script>
  <script>i18n.init().then(()=>{window.model=RoomScreenRenderer.create(RoomScreen.create().screen);window.view=model.userData.presentation;window.ready=true;});</script></body>`));
 app.use(express.static(path.resolve(__dirname,'../public')));server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();try{await fs.access(executable);}catch(_){for(const n of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(n))executable='/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome';}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('token','fixture'));await page.goto('http://127.0.0.1:'+server.address().port+'/play');await page.waitForFunction(()=>window.ready);
 let revision=0;
 const state=(id=asset,index=0)=>({roomId:room,epoch,revision:String(++revision),asset:id?{id,name:id===image?'Image.webp':'Fixture.pdf',kind:id===image?'image':'pdf',pageCount:id===image?1:2}:null,pageIndex:index});
 const deliver=value=>page.evaluate(v=>RoomPresentation.message('ROOM_PRESENTATION_STATE',v),value);
 const pixel=()=>page.evaluate(()=>[...view.canvas.getContext('2d').getImageData(view.canvas.width/2,view.canvas.height/2,1,1).data].slice(0,3));
 const color=async rgb=>{await page.waitForFunction(rgb=>{const c=view.canvas,p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return rgb.every((v,i)=>Math.abs(p[i]-v)<15);},rgb);};
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
 await page.getByRole('button',{name:'Next slide',exact:true}).click();
 const command=await page.evaluate(()=>sent.find(m=>m.type==='ROOM_PRESENTATION_COMMAND').payload);
 assert.equal(command.expectedRevision,current.revision);assert.deepEqual(command.command,{type:'page',pageIndex:1});assert.equal(command.expectedEpoch,epoch);
 current=state(asset,1);await page.evaluate(({command,current})=>RoomPresentation.message('ROOM_PRESENTATION_RESULT',{requestId:command.requestId,success:true,state:current}),{command,current});await color([0,0,255]);
 await page.getByRole('button',{name:'Previous slide',exact:true}).click();
 const conflict=await page.evaluate(()=>sent.filter(m=>m.type==='ROOM_PRESENTATION_COMMAND').at(-1).payload);
 await page.evaluate(({requestId,current})=>RoomPresentation.message('ROOM_PRESENTATION_RESULT',{requestId,success:false,code:'PRESENTATION_CHANGED',state:current}),{requestId:conflict.requestId,current});
 assert.equal(await page.evaluate(()=>sent.filter(m=>m.type==='ROOM_PRESENTATION_COMMAND').length),2,'conflicts never replay the command');
 assert.equal((await page.evaluate(()=>sent.at(-1))).type,'ROOM_PRESENTATION_GET_STATE');await deliver(current);
 await page.keyboard.press('Escape');
 await deliver({...current,revision:'1',pageIndex:0});await deliver({...current,epoch:randomUUID(),revision:'999',pageIndex:0});assert.deepEqual(await pixel(),[0,0,255]);
 // Late PDF completion must not draw over the newly selected image or stop state.
 await deliver(state(slow));await page.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('Fixture'));
 await new Promise(r=>setTimeout(r,30));await deliver(state(image));await color([0,255,0]);release?.();release=null;
 await new Promise(r=>setTimeout(r,60));await color([0,255,0]);
 await deliver(state(null));await page.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('Waiting for presentation'));
 await deliver(state(missing));await page.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('Could not'));
 failImage=true;await deliver(state(image));await page.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('Could not'));
 failImage=false;await page.locator('#presentation-refresh').click();assert((await page.evaluate(()=>sent.at(-1))).type==='ROOM_PRESENTATION_GET_STATE');
 await deliver(state(image));await color([0,255,0]);
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
 assert.deepEqual(errors,[]);
 console.log('Chromium presentation: buffered snapshots, real PDF worker/pages, canvas texture and live enlarged view, mobile owner controls, strict revisions, cached page changes, image/stop/failure retry, participant UI, offline and late-load exit cleanup OK (fixture HTTP/WS)');
}finally{release?.();await browser?.close();await new Promise(r=>server?server.close(r):r());}})().catch(e=>{console.error(e);process.exitCode=1;});
