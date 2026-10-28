/** Real client modules/PDF worker/canvas; owner HTTP data are isolated fixtures. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const express=require('express'),multer=require('multer'),sharp=require('sharp'),{chromium}=require('playwright');
const {pdf}=require('./room-media-fixtures');const pptxMode=process.argv.includes('--pptx');let browser,server,release,releaseUpload;
(async()=>{try{
 const image=await sharp({create:{width:80,height:60,channels:3,background:'#00ff00'}}).webp().toBuffer();
 const roomId=randomUUID(),pdfId=randomUUID(),imageId=randomUUID(),slowId=randomUUID();
 const materials=new Map([[pdfId,{id:pdfId,name:'Обзор проекта — архитектура переговорных и материалы.pdf',kind:'pdf',state:'ready',pageCount:2}],
  [imageId,{id:imageId,name:'Пример изображения.webp',kind:'image',state:'ready',pageCount:1}],
  [slowId,{id:slowId,name:'Slow.pdf',kind:'pdf',state:'ready',pageCount:2}]]);
 const prefix='/api/my/rooms/'+roomId+'/materials',app=express();app.use(express.json());
 app.use('/vendor/room-pdf/5.5.207',express.static(path.dirname(require.resolve('pdfjs-dist/package.json'))));
 app.get('/api/config/language',(_q,s)=>s.json({language:'en-US'}));
 app.use(prefix,(q,s,next)=>{if(q.headers.authorization!=='Bearer fixture')return s.sendStatus(401);assert(!q.url.includes('token='));next();});
 let holdUpload=false,denyList=false,failList=false,activeDelete=false,deleteFailure=false,deleteBodies=[];
 app.get(prefix+'/capabilities',(_q,s)=>pptxMode?s.json({features:{videoUpload:false,videoPlayback:false,pptxImport:true}}):s.status(404).json({code:'UNAVAILABLE'}));
 app.get(prefix,(_q,s)=>denyList?s.sendStatus(401):failList?s.status(503).json({code:'FAILED'}):s.json({materials:[...materials.values()],quota:{bytes:1000,count:materials.size,byteLimit:100*1024**2,countLimit:20}}));
 app.post(prefix+'/uploads',(q,s)=>{const id=randomUUID(),asset={id,name:q.body.name,kind:q.body.kind,...(q.body.sourceFormat?{sourceFormat:q.body.sourceFormat}:{}),state:'reserved',pageCount:2};materials.set(id,asset);s.json({upload:asset});});
 app.post(prefix+'/uploads/:id/file',multer({storage:multer.memoryStorage()}).single('file'),async(q,s)=>{const asset=materials.get(q.params.id);if(holdUpload)await new Promise(r=>releaseUpload=r);if(asset.state==='cancelled'||s.destroyed)return s.end();asset.state='ready';if(asset.sourceFormat==='pptx')assert(q.file.buffer.equals(await fs.readFile(path.join(__dirname,'fixtures/room-pptx/valid.pptx'))));else assert(q.file.buffer.equals(pdf({script:true})));s.json({material:asset});});
 app.delete(prefix+'/uploads/:id',(q,s)=>{const asset=materials.get(q.params.id);asset.state='cancelled';s.json({upload:asset});});
 app.delete(prefix+'/:id',(q,s)=>{
  deleteBodies.push(q.body);
  if(deleteFailure)return s.status(409).json({code:'PRESENTATION_CHANGED'});
  if(activeDelete&&!q.body?.stopShowing)return s.status(409).json({code:'MATERIAL_IN_USE',state:{epoch:'fixture-epoch',revision:'42'}});
  if(activeDelete){assert.equal(q.body.expectedEpoch,'fixture-epoch');assert.equal(q.body.expectedRevision,'42');assert.match(q.body.requestId,/^[a-f0-9-]{36}$/);}
  materials.delete(q.params.id);s.json({success:true});
 });
 app.get(prefix+'/:id/content',async(q,s)=>{
  const asset=materials.get(q.params.id);if(!asset)return s.sendStatus(404);
  if(asset.id===slowId)await new Promise(r=>release=r);
  if(s.destroyed)return;
  s.set('Cache-Control','private, no-store').type(asset.kind==='pdf'?'application/pdf':'image/webp').send(asset.kind==='pdf'?(asset.sourceFormat==='pptx'&&process.env.ROOM_PPTX_TEST_PDF?await fs.readFile(process.env.ROOM_PPTX_TEST_PDF):pdf({script:true})):image);
 });
 app.get('/fixture',(q,s)=>s.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">${q.query.meeting?'':'<link rel="stylesheet" href="/css/app-ui.css">'}<link rel="stylesheet" href="/css/room-materials.css"><body class="${q.query.meeting?'meeting-session':'app-ui'}"><button id="open">Materials</button><script src="/i18n/i18n.js"></script><script src="/js/roomMediaRenderer.js"></script><script src="/js/roomMediaContract.js"></script><script src="/js/roomMaterials.js"></script><script>i18n.init().then(()=>{document.getElementById('open').onclick=()=>RoomMaterials.open({id:'${roomId}',name:'Переговорная для встреч команды'});window.ready=true;});</script></body>`));
 app.use(express.static(path.resolve(__dirname,'../public')));
 server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();try{await fs.access(executable);}catch(_){for(const n of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(n))executable='/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome';}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('dialog',d=>d.accept());await page.addInitScript(()=>{localStorage.setItem('token','fixture');crypto.randomUUID=undefined;});
 const base='http://127.0.0.1:'+server.address().port;await page.goto(base+'/fixture');await page.waitForFunction(()=>window.ready);
 for(const asset of ['cmaps/Adobe-GB1-UCS2.bcmap','standard_fonts/LiberationSans-Regular.ttf','wasm/openjpeg.wasm','iccs/CGATS001Compat-v2-micro.icc'])assert.equal((await fetch(base+'/vendor/room-pdf/5.5.207/'+asset)).status,200);
 await page.locator('#open').click();await page.evaluate(()=>{window.inputLeaks=0;for(const type of ['pointerdown','click','keydown','wheel'])document.addEventListener(type,()=>window.inputLeaks++);});await page.locator('#materials-list div').first().getByRole('button',{name:'Preview',exact:true}).click();
 const color=()=>page.evaluate(()=>{const c=document.querySelector('dialog canvas');return [...c.getContext('2d').getImageData(10,10,1,1).data].slice(0,3);});
 await page.waitForFunction(()=>{const c=document.querySelector('dialog canvas');if(c?.width!==1200)return false;const p=c.getContext('2d').getImageData(10,10,1,1).data;return p[0]===255&&p[1]===0&&p[2]===0&&p[3]===255;});assert.deepEqual(await color(),[255,0,0]);
 await page.getByRole('button',{name:'Next page',exact:true}).click();await page.waitForFunction(()=>{const p=document.querySelector('dialog canvas').getContext('2d').getImageData(10,10,1,1).data;return p[0]===0&&p[1]===0&&p[2]===255&&p[3]===255;});assert.deepEqual(await color(),[0,0,255]);
 await page.setViewportSize({width:1280,height:800});await page.locator('.material-body').evaluate(n=>n.scrollTop=0);await page.screenshot({path:'/tmp/materials-redesign-preview.png'});await page.setViewportSize({width:390,height:844});
 assert.equal(await page.evaluate(()=>window.fixturePdfExecuted),undefined);
 const box=await page.locator('dialog').boundingBox();assert(box.width<=390);
 assert(await page.getByRole('button',{name:'Cancel upload',exact:true}).count()===0);
 assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),'mobile library has no horizontal overflow');
 if(process.env.ROOM_MATERIALS_SCREENSHOT)await page.screenshot({path:process.env.ROOM_MATERIALS_SCREENSHOT});
 await page.locator('#materials-list div').nth(1).getByRole('button',{name:'Preview',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog canvas').width===80);
 const green=await color();assert(green[1]>240&&green[0]<15&&green[2]<15);
 await page.locator('#material-file').setInputFiles({name:'Uploaded.pdf',mimeType:'application/pdf',buffer:pdf({script:true})});
 await page.waitForFunction(()=>document.querySelectorAll('#materials-list div').length===4);assert([...materials.values()].some(a=>a.name==='Uploaded.pdf'&&a.state==='ready'));
 const row=page.locator('#materials-list div').filter({hasText:'Uploaded.pdf'});await row.getByRole('button',{name:'Delete',exact:true}).click();await page.locator('.material-confirm').getByRole('button',{name:'Delete',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('#materials-list div').length===3);
 assert.equal(await page.evaluate(()=>window.inputLeaks),0,'modal input does not bubble into scene controls');
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
 // Same panel skin, reflow, translations and keyboard on both consuming surfaces.
 for(const meeting of [false,true]){
  for(const locale of ['en-US','ru-RU','zh-CN']){
   await page.evaluate(l=>localStorage.setItem('preferredLocale',l),locale);
   await page.goto(base+'/fixture'+(meeting?'?meeting=1':''));await page.waitForFunction(()=>window.ready);await page.locator('#open').click();
   await page.waitForFunction(()=>document.querySelectorAll('.material-row').length===3&&!document.querySelector('#material-file').disabled);
   const translated=JSON.parse(await fs.readFile(path.resolve(__dirname,'../public/i18n/'+locale+'.json'),'utf8')).roomMaterials;
   assert.equal(await page.locator('#materials-title').textContent(),translated.title);
   assert.equal(await page.locator('#material-file').getAttribute('aria-label'),translated.upload);
   assert.equal(await page.locator('.material-preview-name').textContent(),translated.privateLibrary);
   const colors=await page.locator('.material-actions .ui-button').first().evaluate(n=>({weight:getComputedStyle(n).fontWeight,text:getComputedStyle(n).color}));assert.equal(colors.weight,'600');
   const contrasts=await page.evaluate(()=>{
    const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
    return ['.material-name','.material-state','.material-upload-action','.material-upload-format','.material-private-hint','.material-actions .ui-button--destructive'].map(selector=>{
     const n=document.querySelector(selector);let p=n,bg;do{bg=getComputedStyle(p).backgroundColor;if(bg!=='rgba(0, 0, 0, 0)')break;p=p.parentElement;}while(p);
     const a=lum(getComputedStyle(n).color),b=lum(bg);return {selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    });
   });for(const c of contrasts)assert(c.ratio>=4.5,JSON.stringify(c));
   for(const [width,height] of [[320,568],[375,812],[430,932],[768,1024],[1280,800],[1920,1080],[844,390]]){
    await page.setViewportSize({width,height});
    assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth),'dialog reflows at '+width);
    assert.equal(await page.locator('dialog').evaluate(d=>getComputedStyle(d).backgroundColor),'rgb(255, 255, 255)');
    const bounds=await page.locator('dialog').boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=height+1);
    assert(await page.locator('.material-close').evaluate(n=>n.offsetHeight>=44&&n.offsetWidth>=44));
   }
   await page.setViewportSize({width:1280,height:800});
   await page.locator('.material-close').focus();await page.keyboard.press('Shift+Tab');
   assert(await page.evaluate(()=>document.activeElement.closest('#materials-list')!==null),'Tab wraps to list action');
   await page.keyboard.press('Tab');assert(await page.locator('.material-close').evaluate(n=>n===document.activeElement));
   if(locale==='ru-RU'){
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:'/tmp/materials-redesign-'+(meeting?'meeting':'cabinet')+'.png'});
    await page.setViewportSize({width:375,height:812});await page.screenshot({path:'/tmp/materials-redesign-mobile-'+(meeting?'meeting':'cabinet')+'.png'});
   }
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));
  }
 }
 await page.evaluate(()=>localStorage.setItem('preferredLocale','en-US'));await page.goto(base+'/fixture?meeting=1');await page.waitForFunction(()=>window.ready);await page.locator('#open').click();
 await page.waitForFunction(()=>document.querySelectorAll('.material-row').length===3);
 const remove=()=>page.locator('.material-row').first().getByRole('button',{name:'Delete',exact:true});
 const confirmRemove=()=>page.locator('.material-confirm').getByRole('button',{name:'Delete',exact:true});
 await remove().click();assert.equal(await page.locator('.material-confirm').getByRole('button',{name:'Cancel',exact:true}).evaluate(n=>n===document.activeElement),true);
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog').count(),1);assert.equal(deleteBodies.length,1,'cancel sent no request');await page.waitForFunction(()=>document.activeElement.matches('.material-actions .ui-button--destructive'));
 activeDelete=true;await remove().click();await confirmRemove().click();
 await page.locator('.material-confirm').getByRole('button',{name:'Stop presentation and delete',exact:true}).waitFor();await page.screenshot({path:'/tmp/materials-redesign-confirm.png'});
 await page.locator('.material-confirm').getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(materials.size,3,'active material retained after cancel');
 await remove().click();await confirmRemove().click();await page.locator('.material-confirm').getByRole('button',{name:'Stop presentation and delete',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.material-row').length===2);assert(deleteBodies.some(b=>b?.stopShowing));activeDelete=false;
 deleteFailure=true;await remove().click();await confirmRemove().click();await page.locator('.material-status.is-error').waitFor();assert.equal(materials.size,2);deleteFailure=false;
 failList=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.material-status.is-error').waitFor();assert.equal(await page.locator('.material-row').count(),2,'failed refresh preserves list');
 failList=false;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.material-status').hidden);
 await page.context().setOffline(true);await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.locator('.material-status.is-error').waitFor();assert.equal(await page.locator('.material-row').count(),2);
 await page.context().setOffline(false);await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.material-status').hidden);
 holdUpload=true;await page.locator('#material-file').setInputFiles({name:'Cancelled.pdf',mimeType:'application/pdf',buffer:pdf({script:true})});
 await page.getByRole('button',{name:'Cancel upload',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.material-row').length===3&&!document.querySelector('#material-file').disabled);
 assert([...materials.values()].some(a=>a.name==='Cancelled.pdf'&&a.state==='cancelled'));holdUpload=false;releaseUpload?.();releaseUpload=null;
 // Two hundred percent text size must reflow within the independently scrolling body.
 await page.addStyleTag({content:'.room-materials{font-size:28px}.room-materials .material-header h2{font-size:44px}.room-materials h3{font-size:36px}'});
 await page.setViewportSize({width:320,height:568});assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth));
 // Closing while a confirmation is waiting resolves the action and removes the panel.
 await remove().click();await page.locator('.material-close').click();await page.waitForFunction(()=>!document.querySelector('dialog'));
 // Initial failure, retry and an empty library must not leave a loading placeholder.
 failList=true;await page.locator('#open').click();await page.locator('.material-status.is-error').waitFor();
 assert.equal(await page.locator('#materials-list').getAttribute('aria-busy'),'false');
 assert(!(await page.locator('#materials-list').textContent()).includes('Loading'));
 failList=false;materials.clear();await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.getByText('No materials yet.',{exact:true}).waitFor();
 if(pptxMode){
  assert((await page.locator('#material-file').getAttribute('accept')).includes('.pptx'));
  assert((await page.locator('#material-pptx-notice').textContent()).includes('PDF'));
  await page.locator('#material-file').setInputFiles({name:'Slides.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:await fs.readFile(path.join(__dirname,'fixtures/room-pptx/valid.pptx'))});
  await page.waitForFunction(()=>[...document.querySelectorAll('.material-row')].some(r=>r.textContent.includes('PPTX → PDF'))&&!document.querySelector('.material-preview canvas').hidden);
  assert.equal(await page.locator('.material-page-count').textContent(),'1 / 2');assert((await page.locator('.material-state').textContent()).includes('PDF from PPTX'));
  assert(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth));
  await page.evaluate(()=>{for(const style of document.querySelectorAll('style'))if(style.textContent.includes('.room-materials{font-size:28px}'))style.remove();});
  await page.setViewportSize({width:390,height:844});await page.locator('.material-preview canvas').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/3dtalks-pptx-library-mobile.png'});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'/tmp/3dtalks-pptx-preview-desktop.png'});
  console.log('PPTX browser: capabilities/accept, localized loss notice, source metadata, converted PDF badge and automatic real-PDF preview passed (fixture HTTP).');
 }
 denyList=true;await page.getByRole('button',{name:'Refresh',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog'));denyList=false;
 await page.locator('#open').click();await page.evaluate(()=>localStorage.removeItem('token'));await page.waitForFunction(()=>!document.querySelector('dialog'));
 assert.deepEqual(errors,[]);assert(requests.every(url=>url.startsWith(base)||url.startsWith('blob:')));
 assert(requests.some(url=>url.includes('pdf.worker.mjs')),'real pinned worker is loaded locally');
 console.log('Chromium materials redesign (both surfaces, 3 languages, 7 viewports, focus, custom deletion/active-state guards, retry, text zoom): mobile library/upload/delete, local PDF/image canvas and pages, native worker, no PDF scripting, simultaneous-load cancellation, Escape/focus and logout cleanup OK (fixture HTTP)');
}finally{release?.();releaseUpload?.();await browser?.close();await new Promise(r=>server?server.close(r):r());}})().catch(e=>{console.error(e);process.exitCode=1;});
