const assert = require('node:assert/strict'), http = require('node:http'), fs = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), { chromium } = require('playwright');
const { wav } = require('./avatar-lab-audio-fixture');
let browser;
const files = ['lib/three.min.js', 'avatarAudioSignal.js', 'meetingMouthAnimation.js', 'voiceChat.js'];
const server = http.createServer(async (req, res) => {
  const file = req.url.slice(1);
  if (files.includes(file)) { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(await fs.readFile(path.join(__dirname, '../public/js', file))); }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><button id="play">Play</button>${files.map(f=>'<script src="/'+f+'"></script>').join('')}
    <script>
    window.UI={addChatMessage(){}};window.GAME_STATE={characterId:'self'};
    window.mesh=new THREE.Object3D();mesh.morphTargetDictionary={viseme_aa:0};mesh.morphTargetInfluences=[0];
    window.group=new THREE.Group();group.userData.accountAvatarRoot=new THREE.Group();group.userData.accountAvatarRoot.add(mesh);
    window.gameWorld={isMeeting:true,players:new Map([['speaker',{group}]])};
    window.payload=null;window.starts=0;const Native=AudioContext;
    window.AudioContext=class extends Native{createBufferSource(){const s=super.createBufferSource(),start=s.start.bind(s);s.start=(...a)=>{starts++;return start(...a);};return s;}};
    document.getElementById('play').onclick=()=>voiceChat.playVoiceMessage(payload);
    function tick(){MeetingMouthAnimation.update(gameWorld);requestAnimationFrame(tick);}tick();
    </script>`);
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath();
  try { await fs.access(executablePath); } catch (_) {
    const cache = path.join(os.homedir(), '.cache/ms-playwright');
    for (const dir of await fs.readdir(cache)) if (dir.startsWith('chromium-')) executablePath = path.join(cache, dir, 'chrome-linux64/chrome');
  }
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.evaluate(audio => {payload={characterId:'speaker',audio,durationMs:3000};}, wav().toString('base64'));
  await page.click('#play');
  await page.waitForFunction(() => mesh.morphTargetInfluences[0] > .1);
  await page.waitForFunction(() => voiceChat.audioCtx.currentTime > 1.4 && voiceChat.audioCtx.currentTime < 1.9 && mesh.morphTargetInfluences[0] === 0);
  await page.waitForFunction(() => voiceChat.audioCtx.currentTime > 2.3 && mesh.morphTargetInfluences[0] > .1);
  await page.waitForFunction(() => voiceChat.playbackSources.size === 0);
  assert.equal(await page.evaluate(() => mesh.morphTargetInfluences[0]), 0);
  await page.click('#play'); await page.waitForFunction(() => mesh.morphTargetInfluences[0] > .1);
  await page.evaluate(() => voiceChat.toggleMute());
  assert.equal(await page.evaluate(() => mesh.morphTargetInfluences[0]), 0);
  assert.equal(await page.evaluate(() => voiceChat.playbackSources.size), 0);
  await page.evaluate(() => voiceChat.toggleMute());
  // A decode resolving after the same account leaves and rejoins cannot start old audio.
  const before = await page.evaluate(() => {
    const native=voiceChat.audioCtx.decodeAudioData.bind(voiceChat.audioCtx);
    voiceChat.audioCtx.decodeAudioData=bytes=>new Promise((resolve,reject)=>window.releaseDecode=()=>native(bytes).then(resolve,reject));return starts;
  });
  await page.click('#play'); await page.waitForFunction(() => !!window.releaseDecode);
  await page.evaluate(() => {MeetingMouthAnimation.remove(group);gameWorld.players.set('speaker',{group:new THREE.Group()});});
  await page.evaluate(() => releaseDecode()); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => starts), before);
  await page.evaluate(() => voiceChat.cancelRoomAudio());
  await page.evaluate(() => voiceChat.dispose());
  assert.deepEqual(errors, []);
  console.log('Meeting voice/mouth browser passed: native decode/source, audible tone/silence/tone, mute/reset, late decode/rejoin and exit cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
});
