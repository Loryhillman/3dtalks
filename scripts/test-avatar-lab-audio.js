const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), { chromium } = require('playwright');
const signal = require('../tools/avatar-lipsync-lab/audio-signal'), { wav } = require('./avatar-lab-audio-fixture');
const array = buffer => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const sample = wav(), fixture = signal.envelope(signal.parseWav(array(sample)));
assert(signal.at(fixture, .5) > .1); assert.equal(signal.at(fixture, 1.6), 0); assert(signal.at(fixture, 2.5) > .1);
assert.equal(signal.at(fixture, 3), 0); assert.equal(signal.at(fixture, -1), 0);
const stereo = signal.envelope(signal.parseWav(array(wav({ channels: 2, opposite: true }))));
assert(Math.abs(signal.at(stereo, .5) - signal.at(fixture, .5)) < 1e-4, 'opposite stereo must not cancel mouth activity');
const quiet = signal.envelope(signal.parseWav(array(wav({ amplitude: .001 }))));
assert.equal(signal.at(quiet, .5), 0);
const wrongFormat = Buffer.from(sample); wrongFormat.writeUInt16LE(3, 20);
for (const invalid of [wrongFormat, sample.subarray(0, 50), Buffer.alloc(13 * 1024 * 1024)]) assert.throws(() => signal.parseWav(array(invalid)));
let browser; const requests = [];
const server = http.createServer(async (req, res) => {
  requests.push({ url: req.url, method: req.method });
  if (req.url === '/demo.wav') { res.setHeader('Content-Type', 'audio/wav'); return res.end(sample); }
  if (req.url === '/js/avatarAudioSignal.js') {
    res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(await fs.readFile(path.join(__dirname, '../public/js/avatarAudioSignal.js')));
  }
  if (['/audio-signal.js', '/lab-audio.js'].includes(req.url)) {
    res.setHeader('Content-Type', 'text/javascript'); return res.end(await fs.readFile(path.join(__dirname, '../tools/avatar-lipsync-lab', req.url)));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><button id="play">Play</button><button id="stop">Stop</button>
    <script src="/js/avatarAudioSignal.js"></script><script src="/audio-signal.js"></script><script src="/lab-audio.js"></script><script>
    window.contexts=[];window.starts=0;window.mouth=0;window.streams=[];
    window.nativeGet=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=async constraints=>{const stream=await nativeGet(constraints);streams.push(stream);return stream;};
    const NativeAudio=window.AudioContext;window.AudioContext=class extends NativeAudio {
      constructor(){super();contexts.push(this);}
      createBufferSource(){const s=super.createBufferSource(),start=s.start.bind(s);s.start=(...args)=>{starts++;return start(...args);};return s;}
    };
    window.controller=AvatarLabAudio.create({onState:s=>window.state=s,onMouth:v=>window.mouth=v});
    document.getElementById('play').onclick=()=>controller.play();document.getElementById('stop').onclick=()=>controller.stop();
    </script>`);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let executable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath();
  try { await fs.access(executable); } catch (_) {
    const cache = path.join(os.homedir(), '.cache/ms-playwright');
    for (const dir of await fs.readdir(cache)) if (dir.startsWith('chromium-')) executable = path.join(cache, dir, 'chrome-linux64/chrome');
  }
  browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  assert.equal(await page.evaluate(() => streams.length), 0, 'loading must not request microphone');
  await page.evaluate(() => controller.record());
  await page.waitForFunction(() => state.phase === 'recording');
  assert.equal(await page.evaluate(() => starts), 0);
  assert.equal(await page.evaluate(() => mouth), 0);
  await page.waitForTimeout(1200);
  await page.evaluate(() => controller.finishRecording());
  assert(await page.evaluate(() => streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  await page.waitForFunction(() => state.phase === 'ready');
  assert(await page.evaluate(() => state.duration > .5));
  await page.click('#play');
  await page.waitForFunction(() => state.phase === 'playing' && mouth > .01);
  await page.waitForFunction(() => state.phase === 'ready');
  assert.equal(await page.evaluate(() => mouth), 0);
  await page.evaluate(() => controller.record());
  await page.waitForFunction(() => state.phase === 'recording');
  await page.click('#stop');
  assert(await page.evaluate(() => streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  await page.evaluate(async () => {
    navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Denied','NotAllowedError');};
    await controller.record();
  });
  assert.match(await page.evaluate(() => state.error), /Доступ к микрофону запрещён/);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.releaseMicrophone=async()=>{const s=await nativeGet({audio:true});streams.push(s);resolve(s);});
    controller.record();
  });
  await page.click('#stop');
  await page.evaluate(() => releaseMicrophone());
  await page.waitForFunction(() => streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')));
  assert.equal(await page.evaluate(() => state.phase), 'empty');
  // Automatic deadline and hidden-tab cancellation release real capture tracks.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia=async constraints=>{const s=await nativeGet(constraints);streams.push(s);return s;};
    window.originalTimeout=window.setTimeout;
    window.setTimeout=(fn,ms,...args)=>originalTimeout(fn,ms===30000?1000:ms,...args);
    controller.record();
  });
  await page.waitForFunction(() => state.phase === 'recording');
  await page.waitForFunction(() => state.phase === 'ready');
  assert(await page.evaluate(() => streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  await page.evaluate(() => {window.setTimeout=originalTimeout;controller.record();});
  await page.waitForFunction(() => state.phase === 'recording');
  await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
  assert.equal(await page.evaluate(() => state.phase), 'empty');
  assert(await page.evaluate(() => streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))));
  await page.evaluate(() => {Object.defineProperty(document,'hidden',{configurable:true,value:false});});
  await page.evaluate(() => { starts=0; });
  await page.evaluate(() => controller.loadDemo());
  assert.equal(await page.evaluate(() => state.phase), 'ready');
  assert.equal(await page.evaluate(() => starts), 0, 'selecting audio must not autoplay');
  await page.click('#play'); await page.waitForFunction(() => state.phase === 'playing' && state.elapsed > .25 && mouth > .1);
  await page.waitForFunction(() => state.elapsed > 1.4 && state.elapsed < 1.9 && mouth === 0);
  await page.waitForFunction(() => state.elapsed > 2.3 && mouth > .1);
  await page.waitForFunction(() => state.phase === 'ready'); assert.equal(await page.evaluate(() => mouth), 0);
  await page.click('#play'); await page.waitForFunction(() => mouth > .1); await page.click('#stop');
  assert.equal(await page.evaluate(() => mouth), 0);
  // Resume resolving after Stop must not start a stale source.
  const before = await page.evaluate(() => {
    const c=contexts[0],resume=c.resume.bind(c);c.resume=()=>new Promise((resolve,reject)=>window.releaseResume=()=>resume().then(resolve,reject));return starts;
  });
  await page.click('#play'); await page.waitForFunction(() => state.phase === 'starting'); await page.click('#stop');
  await page.evaluate(async () => { await releaseResume(); }); await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => starts), before);
  await page.evaluate(() => { contexts[0].resume=Object.getPrototypeOf(Object.getPrototypeOf(contexts[0])).resume.bind(contexts[0]); });
  // A late file read must not replace a more recently selected clip.
  const base64 = sample.toString('base64');
  await page.evaluate(base64 => {
    const bytes=Uint8Array.from(atob(base64),x=>x.charCodeAt(0));window.fixtureBytes=bytes;
    controller.loadFile({name:'old.wav',size:bytes.length,arrayBuffer:()=>new Promise(resolve=>window.releaseFile=()=>resolve(bytes.buffer))});
  }, base64);
  await page.evaluate(() => controller.loadFile(new File([fixtureBytes],'new.wav')));
  await page.evaluate(() => releaseFile());
  assert.equal(await page.evaluate(() => state.name), 'new.wav'); assert.equal(await page.evaluate(() => state.phase), 'ready');
  await page.click('#play'); await page.waitForFunction(() => state.phase === 'playing');
  await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.evaluate(() => state.phase), 'ready'); assert.equal(await page.evaluate(() => mouth), 0);
  await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,value:false});controller.dispose();controller.dispose(); });
  await page.waitForFunction(() => contexts[0].state === 'closed');
  assert.equal(await page.evaluate(() => state.phase), 'disposed');
  assert(requests.every(request => request.method === 'GET'), 'audio file must not be uploaded');
  assert.deepEqual(errors, []);
  console.log('Lab audio passed: native microphone recording/replay, denial/retry, late permission, deadline, capture cleanup; bounded WAV, silence, audio-clock animation, late resume/read, hidden and disposal; no upload');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
});
