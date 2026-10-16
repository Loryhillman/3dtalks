/** Real client modules/PDF worker/canvas; owner HTTP data are isolated fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const express=require('express'),multer=require('multer'),sharp=require('sharp'),{chromium}=require('playwright');
const {pdf}=require('./room-media-fixtures');let browser,server,release;
(async()=>{try{
 const image=await sharp({create:{width:80,height:60,channels:3,background:'#00ff00'}}).webp().toBuffer();
 const roomId=randomUUID(),pdfId=randomUUID(),imageId=randomUUID(),slowId=randomUUID();
 const materials=new Map([[pdfId,{id:pdfId,name:'Fixture.pdf',kind:'pdf',state:'ready',pageCount:2}],
  [imageId,{id:imageId,name:'Image.webp',kind:'image',state:'ready',pageCount:1}],
  [slowId,{id:slowId,name:'Slow.pdf',kind:'pdf',state:'ready',pageCount:2}]]);
 const prefix='/api/my/rooms/'+roomId+'/materials',app=express();app.use(express.json());
 app.use('/vendor/room-pdf/5.5.207',express.static(path.dirname(require.resolve('pdfjs-dist/package.json'))));
 app.get('/api/config/language',(_q,s)=>s.json({language:'en-US'}));
 app.use(prefix,(q,s,next)=>{if(q.headers.authorization!=='Bearer fixture')return s.sendStatus(401);assert(!q.url.includes('token='));next();});
 app.get(prefix,(_q,s)=>s.json({materials:[...materials.values()],quota:{bytes:1000,count:materials.size,byteLimit:100*1024**2,countLimit:20}}));
 app.post(prefix+'/uploads',(q,s)=>{const id=randomUUID(),asset={id,name:q.body.name,kind:q.body.kind,state:'reserved',pageCount:2};materials.set(id,asset);s.json({upload:asset});});
 app.post(prefix+'/uploads/:id/file',multer({storage:multer.memoryStorage()}).single('file'),(q,s)=>{const asset=materials.get(q.params.id);asset.state='ready';assert(q.file.buffer.equals(pdf({script:true})));s.json({material:asset});});
 app.delete(prefix+'/uploads/:id',(q,s)=>{const asset=materials.get(q.params.id);asset.state='cancelled';s.json({upload:asset});});
 app.delete(prefix+'/:id',(q,s)=>{materials.delete(q.params.id);s.json({success:true});});
 app.get(prefix+'/:id/content',async(q,s)=>{
  const asset=materials.get(q.params.id);if(!asset)return s.sendStatus(404);
  if(asset.id===slowId)await new Promise(r=>release=r);
  if(s.destroyed)return;
  s.set('Cache-Control','private, no-store').type(asset.kind==='pdf'?'application/pdf':'image/webp').send(asset.kind==='pdf'?pdf({script:true}):image);
 });
 app.get('/fixture',(_q,s)=>s.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/css/app-ui.css"><link rel="stylesheet" href="/css/room-materials.css"><body class="app-ui"><button id="open">Materials</button><script src="/i18n/i18n.js"></script><script src="/js/roomMediaRenderer.js"></script><script src="/js/roomMaterials.js"></script><script>i18n.init().then(()=>{document.getElementById('open').onclick=()=>RoomMaterials.open({id:'${roomId}',name:'Fixture'});window.ready=true;});</script></body>`));
 app.use(express.static(path.resolve(__dirname,'../public')));
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();try{await fs.access(executable);}catch(_){for(const n of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(n))executable='/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome';}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('dialog',d=>d.accept());await page.addInitScript(()=>{localStorage.setItem('token','fixture');crypto.randomUUID=undefined;});
 const base='http://127.0.0.1:'+server.address().port;await page.goto(base+'/fixture');await page.waitForFunction(()=>ready);
 for(const asset of ['cmaps/Adobe-GB1-UCS2.bcmap','standard_fonts/LiberationSans-Regular.ttf','wasm/openjpeg.wasm','iccs/CGATS001Compat-v2-micro.icc'])assert.equal((await fetch(base+'/vendor/room-pdf/5.5.207/'+asset)).status,200);
 await page.locator('#open').click();await page.locator('#materials-list div').first().getByRole('button',{name:'Preview',exact:true}).click();
 const color=()=>page.evaluate(()=>{const c=document.querySelector('dialog canvas');return [...c.getContext('2d').getImageData(10,10,1,1).data].slice(0,3);});
 await page.waitForFunction(()=>{const c=document.querySelector('dialog canvas');if(c?.width!==1200)return false;const p=c.getContext('2d').getImageData(10,10,1,1).data;return p[0]===255&&p[1]===0&&p[2]===0&&p[3]===255;});assert.deepEqual(await color(),[255,0,0]);
 await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForFunction(()=>{const p=document.querySelector('dialog canvas').getContext('2d').getImageData(10,10,1,1).data;return p[0]===0&&p[1]===0&&p[2]===255&&p[3]===255;});assert.deepEqual(await color(),[0,0,255]);
 assert.equal(await page.evaluate(()=>window.fixturePdfExecuted),undefined);
 const box=await page.locator('dialog').boundingBox();assert(box.width<=390);
 assert(await page.getByRole('button',{name:'Cancel upload',exact:true}).count()===0);
 assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),'mobile library has no horizontal overflow');
 if(process.env.ROOM_MATERIALS_SCREENSHOT)await page.screenshot({path:process.env.ROOM_MATERIALS_SCREENSHOT});
 await page.locator('#materials-list div').nth(1).getByRole('button',{name:'Preview',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog canvas').width===80);
 const green=await color();assert(green[1]>240&&green[0]<15&&green[2]<15);
 await page.locator('#material-file').setInputFiles({name:'Uploaded.pdf',mimeType:'application/pdf',buffer:pdf({script:true})});
 await page.waitForFunction(()=>document.querySelectorAll('#materials-list div').length===4);assert([...materials.values()].some(a=>a.name==='Uploaded.pdf'&&a.state==='ready'));
 const row=page.locator('#materials-list div').filter({hasText:'Uploaded.pdf'});await row.getByRole('button',{name:'Delete',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#materials-list div').length===3);
 // Stale loads cannot draw over a later asset, even when started in the same microtask.
 const race=await page.evaluate(async prefix=>{
   const c=document.createElement('canvas'),r=new RoomMediaRenderer(c),headers={Authorization:'Bearer fixture'};
   const a=r.load({url:prefix.pdf,kind:'pdf',headers}).catch(e=>e.name);
   const b=r.load({url:prefix.image,kind:'image',headers});await b;
   const result={first:await a,width:c.width,pixels:c.width*c.height};await r.clear();result.cleared=c.width;return result;
 },{pdf:prefix+'/'+pdfId+'/content',image:prefix+'/'+imageId+'/content'});
 assert.deepEqual(race,{first:'AbortError',width:80,pixels:4800,cleared:0});
 await page.locator('#materials-list div').nth(2).getByRole('button',{name:'Preview',exact:true}).click();
 await page.waitForTimeout(50);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));release?.();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'open');
 await page.locator('#open').click();await page.evaluate(()=>localStorage.removeItem('token'));await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith(base)||url.startsWith('blob:')));
 assert(requests.some(url=>url.includes('pdf.worker.mjs')),'real pinned worker is loaded locally');
 console.log('Chromium materials: mobile library/upload/delete, local PDF/image canvas and pages, native worker, no PDF scripting, simultaneous-load cancellation, Escape/focus and logout cleanup OK (fixture HTTP)');
}finally{release?.();await browser?.close();await new Promise(r=>server?server.close(r):r());}})().catch(e=>{console.error(e);process.exitCode=1;});
