const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');
let browser;const requests=[];
const server=http.createServer(async(req,res)=>{
 requests.push(req.method+' '+req.url);
 if(['/avatarVoicePreview.js','/avatarAudioSignal.js'].includes(req.url)){
  res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(path.join(__dirname,'../public/js',req.url)));return;
 }
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><button id="play">Play</button>
 <script src="/avatarAudioSignal.js"></script><script src="/avatarVoicePreview.js"></script><script>
 window.streams=[];window.contexts=[];window.starts=0;window.mouth=0;
 const Audio=AudioContext;window.AudioContext=class extends Audio{constructor(){super();contexts.push(this);}createBufferSource(){const s=super.createBufferSource(),start=s.start.bind(s);s.start=(...args)=>{starts++;return start(...args);};return s;}};
 window.nativeGet=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
 window.acquire=async c=>{const s=await nativeGet(c);streams.push(s);return s;};navigator.mediaDevices.getUserMedia=acquire;
 window.controller=AvatarVoicePreview.create({onState:s=>window.state=s,onMouth:v=>window.mouth=v});
 document.getElementById('play').onclick=()=>controller.play();</script>`);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let executablePath=chromium.executablePath();try{await fs.access(executablePath);}catch(_){for(const dir of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(dir))executablePath='/root/.cache/ms-playwright/'+dir+'/chrome-linux64/chrome';}
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 assert.equal(await page.evaluate(()=>streams.length),0);
 await page.evaluate(()=>controller.record());await page.waitForFunction(()=>state.phase==='recording');
 await page.waitForTimeout(1100);await page.evaluate(()=>controller.finish());await page.waitForFunction(()=>state.phase==='ready');
 assert(await page.evaluate(()=>streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 await page.click('#play');await page.waitForFunction(()=>state.phase==='playing'&&mouth>0);
 await page.evaluate(()=>controller.stop());assert.equal(await page.evaluate(()=>mouth),0);
 // A late resume must never start playback after cancellation.
 const starts=await page.evaluate(()=>{const c=contexts[0],resume=c.resume.bind(c);c.resume=()=>new Promise(resolve=>window.releaseResume=()=>resume().then(resolve));return window.starts;});
 await page.click('#play');await page.waitForFunction(()=>state.phase==='starting');
 await page.evaluate(()=>controller.stop());await page.evaluate(()=>releaseResume());assert.equal(await page.evaluate(()=>window.starts),starts);
 // Permission rejection, delayed permission, hidden-tab and disposal use real streams.
 await page.evaluate(async()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};await controller.record();});
 assert.equal(await page.evaluate(()=>state.error),'voiceDenied');
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.releasePermission=async()=>resolve(await acquire({audio:true})));controller.record();});
 await page.evaluate(()=>controller.stop());await page.evaluate(()=>releasePermission());
 await page.waitForFunction(()=>streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
 await page.evaluate(()=>{window.originalTimeout=setTimeout;window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===15000?900:ms,...args);navigator.mediaDevices.getUserMedia=acquire;controller.record();});
 await page.waitForFunction(()=>state.phase==='recording');await page.waitForFunction(()=>state.phase==='ready');
 assert(await page.evaluate(()=>streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 await page.evaluate(()=>{window.setTimeout=originalTimeout;});
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=acquire;controller.record();});await page.waitForFunction(()=>state.phase==='recording');
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
 assert(await page.evaluate(()=>streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.releasePermission=async()=>resolve(await acquire({audio:true})));controller.record();});
 await page.evaluate(()=>controller.dispose());await page.evaluate(()=>releasePermission());
 await page.waitForFunction(()=>streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))&&contexts.every(c=>c.state==='closed'));
 assert.equal(await page.evaluate(()=>state.phase),'disposed');assert.equal(await page.evaluate(()=>mouth),0);
 assert(requests.every(request=>request.startsWith('GET ')),'microphone audio must never be uploaded');assert.deepEqual(errors,[]);
 console.log('Avatar voice preview: native capture/replay, no upload, denial, late resume/permission, hidden and disposal cleanup passed');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
