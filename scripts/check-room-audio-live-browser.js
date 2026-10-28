/** Opt-in real HTTP/WS/SFU acceptance. Use dedicated disposable actors/rooms.
 * AUTH_FILE: { actors:[{token,userId,characterId},...], rooms:[{id,slug},...] }.
 * No credentials, SDP or ICE addresses are printed. Does not mutate room content.
 */
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
let stage = 'connect';
(async () => {
  const base = process.env.ROOM_AUDIO_LIVE_URL, file = process.env.ROOM_AUDIO_AUTH_FILE;
  if (!base || !file) throw Error('Set ROOM_AUDIO_LIVE_URL and ROOM_AUDIO_AUTH_FILE explicitly');
  const auth = JSON.parse(await fs.readFile(file, 'utf8'));
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || chromium.executablePath(),
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      ...(process.env.ROOM_AUDIO_AUTOPLAY_CHECK==='1'?[]:['--autoplay-policy=no-user-gesture-required'])] });
  const errors = [];
  const pages = []; let complete = false;
  const tokens = new WeakMap();
  try {
    async function enter(actor, room) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 },
        permissions: process.env.ROOM_AUDIO_AUTOPLAY_CHECK==='1'?[]:['microphone'] });
      await ctx.addInitScript(({actor, autoplayCheck}) => {
        for (const key of ['token', 'userId', 'characterId']) localStorage.setItem(key, actor[key]);
        localStorage.setItem('locale', 'ru-RU');
        const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        window.audioTestTracks = [];
        navigator.mediaDevices.getUserMedia = async (...args) => {
          const stream = await get(...args); window.audioTestTracks.push(...stream.getTracks()); return stream;
        };
        if (autoplayCheck) {
          const play = HTMLMediaElement.prototype.play;
          window.audioAutoplayDenied = true;
          HTMLMediaElement.prototype.play = function(...args) {
            if (window.audioAutoplayDenied && this.tagName==='AUDIO' && this.srcObject) return Promise.reject(new DOMException('Autoplay denied for acceptance check','NotAllowedError'));
            return play.apply(this,args);
          };
        }
      }, {actor, autoplayCheck:process.env.ROOM_AUDIO_AUTOPLAY_CHECK==='1'});
      const page = await ctx.newPage(); page.setDefaultTimeout(45000);
      if(process.env.ROOM_AUDIO_FORCE_RELAY==='1')await page.route('**/js/roomRealtimeAudio.js*',async route=>{
        const response=await route.fetch();
        const prefix=`window.LivekitClient = { ...window.LivekitClient, Room: class extends window.LivekitClient.Room {
          constructor(options) { super(options); const connect=this.connect;
            this.connect=(url,token,options)=>connect(url,token,{...options,rtcConfig:{iceTransportPolicy:'relay'}});
          }
        }};\n`;
        await route.fulfill({status:response.status(),contentType:'application/javascript',body:prefix+await response.text()});
      });
      pages.push(page);
      page.on('websocket', socket => socket.on('framereceived', event => {
        try { const m=JSON.parse(event.payload); if(m.type==='ROOM_AUDIO_SESSION'&&m.payload.token)tokens.set(page,m.payload.token); } catch (_) {}
      }));
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/play?room=' + encodeURIComponent(room.slug));
      await page.waitForFunction(() => window.voiceChat?.isRealtime && voiceChat.phase === 'muted');
      await page.locator('#room-connection-overlay').waitFor({ state: 'hidden' });
      await page.evaluate(() => gameWorld.stopRendering()); // Bound software-rendering load; media remains real.
      await page.evaluate(() => {
        window.audioTestStops=[]; const stop=voiceChat.stopTalk.bind(voiceChat);
        voiceChat.stopTalk=function(){audioTestStops.push(new Error().stack.split('\n').slice(2,5));return stop();};
      });
      assert.equal(await page.evaluate(() => voiceChat.recording || voiceChat.wantRecording), false);
      assert.equal(await page.locator('script[src*="voiceChat.js"]').count(), 0);
      console.log('Admitted audio session with microphone off');
      return page;
    }
    const first = await enter(auth.actors[0], auth.rooms[0]);
    const second = await enter(auth.actors[1], auth.rooms[0]);
    const isolated = await enter(auth.actors[2], auth.rooms[1]);
    assert.equal((await fetch(base+'/api/room-audio/admission',{headers:{'X-Audio-Token':tokens.get(first)}})).status,204);
    if (base.startsWith('https:')) {
      assert.equal((await fetch(base+'/livekit/rtc/validate?access_token=invalid')).status,403);
      assert.equal((await fetch(base+'/livekit/twirp/livekit.RoomService/ListRooms',{method:'POST'})).status,404);
    }
    const clickMic = page => page.locator('#skill-voice-btn').click();
    console.log('Enabling first microphone');
    await clickMic(first);
    console.log('Microphone request:', await first.evaluate(() => ({phase:voiceChat.phase,error:voiceChat.error})));
    await first.waitForFunction(() => voiceChat.recording);
    console.log('First microphone is publishing');
    await second.waitForFunction(() => voiceChat.remote.size === 1);
    if (process.env.ROOM_AUDIO_AUTOPLAY_CHECK === '1') {
      await second.waitForFunction(() => voiceChat.playbackBlocked);
      await second.evaluate(() => { window.audioAutoplayDenied = false; });
      await second.locator('#meeting-menu-toggle').click();
      await second.locator('.meeting-audio-notice button').click();
      await second.waitForFunction(() => !voiceChat.playbackBlocked && [...voiceChat.remote.values()].every(e=>!e.element.paused));
      await second.locator('#meeting-menu-toggle').click();
      console.log('Injected autoplay denial and explicit audio recovery through real media elements: OK');
    }
    async function stats(page) {
      return page.evaluate(async () => {
        const track = [...voiceChat.remote.keys()][0];
        if (!track) return null;
        const report = await track.getRTCStatsReport();
        const inbound = [...report.values()].find(s => s.type === 'inbound-rtp' && s.kind === 'audio');
        const pair = [...report.values()].find(s => s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded');
        const candidate = pair && report.get(pair.localCandidateId);
        return { bytes: inbound?.bytesReceived || 0, energy: inbound?.totalAudioEnergy || 0, candidateType: candidate?.candidateType };
      });
    }
    const before = await stats(second); await first.waitForTimeout(1800); const after = await stats(second);
    assert(after.bytes > before.bytes && after.energy > 0, 'Live RTP and audio energy must arrive while microphone stays on');
    assert(await first.evaluate(() => voiceChat.recording), 'Sender must not need to stop recording before audio arrives');
    assert.equal(await isolated.evaluate(() => voiceChat.remote.size), 0);
    const animated = (page, id) => page.waitForFunction(id => {
      MeetingMouthAnimation.update(gameWorld);
      let amount=0;
      gameWorld.players.get(id)?.group.userData.accountAvatarRoot?.traverse(mesh=>{
        const index=mesh.morphTargetDictionary?.viseme_aa??mesh.morphTargetDictionary?.jawOpen;
        if(Number.isInteger(index))amount=Math.max(amount,mesh.morphTargetInfluences[index]||0);
      });
      return amount>.01;
    },id,{timeout:15000});
    await animated(first,auth.actors[0].characterId); await animated(second,auth.actors[0].characterId);
    console.log('Real local/remote avatar mouths follow live stream energy: OK');
    console.log('Live microphone RTP/energy before release and room isolation: OK');
    if(process.env.ROOM_AUDIO_FORCE_RELAY==='1'){
      assert.equal(after.candidateType,'relay');console.log('Forced authenticated TURN relay and received audio: OK');
    }
    await second.locator('#skill-voice-btn').press('Space'); await second.waitForFunction(() => voiceChat.recording);
    await first.waitForFunction(() => voiceChat.remote.size === 1);
    await first.waitForTimeout(1200); assert((await stats(first)).energy > 0, 'Simultaneous reverse audio');
    const hold=Math.min(90,Math.max(0,Number(process.env.ROOM_AUDIO_HOLD_SECONDS)||0));
    if(hold){
      const initial=await stats(first);await first.waitForTimeout(hold*1000);
      assert(await first.evaluate(()=>voiceChat.recording));assert(await second.evaluate(()=>voiceChat.recording));
      assert((await stats(first)).bytes>initial.bytes);console.log('Continuous duplex speech survived '+hold+' seconds, including join-token expiry: OK');
    }
    await second.evaluate(() => voiceChat.toggleMute());
    assert(await second.evaluate(() => [...voiceChat.remote.values()].every(e => e.element.muted)));
    assert(await second.evaluate(() => voiceChat.recording), 'Speaker mute must not stop microphone');
    await second.evaluate(() => voiceChat.toggleMute());
    await first.locator('#skill-voice-btn').press('Enter'); await first.waitForFunction(() => !voiceChat.recording && audioTestTracks.every(t => t.readyState === 'ended'));
    const oldIdentity = await first.evaluate(() => voiceChat.room.localParticipant.identity);
    const oldToken = tokens.get(first);
    await first.evaluate(() => WSClient.ws.close());
    await first.waitForFunction(old => voiceChat.phase === 'muted' && voiceChat.room?.localParticipant.identity !== old, oldIdentity);
    assert.equal(await first.evaluate(() => voiceChat.recording || voiceChat.wantRecording), false);
    await second.waitForFunction(() => voiceChat.remote.size === 0);
    assert.equal((await fetch(base+'/api/room-audio/admission',{headers:{'X-Audio-Token':oldToken}})).status,403);
    console.log('Duplex speech, separate speaker/microphone mute, WS recovery without capture: OK');
    await clickMic(second); // off
    // A delayed permission grant must not revive a cancelled capture.
    await first.evaluate(() => {
      const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.originalAudioCapture = get;
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await get(...args); await new Promise(resolve => { window.releaseAudioPermission = resolve; }); return stream;
      };
    });
    await clickMic(first); await first.waitForFunction(() => !!window.releaseAudioPermission);
    await clickMic(first); await first.evaluate(() => releaseAudioPermission());
    await first.waitForFunction(() => audioTestTracks.every(t => t.readyState === 'ended'));
    assert.equal(await first.evaluate(() => voiceChat.recording), false);
    console.log('Late microphone permission after cancellation: OK');
    await first.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
    await clickMic(first); await first.waitForFunction(() => voiceChat.error === 'permissionDenied');
    assert(await first.evaluate(() => !voiceChat.wantRecording && !voiceChat.recording));
    await first.evaluate(() => { navigator.mediaDevices.getUserMedia = window.originalAudioCapture; });
    console.log('Permission denial remains retryable without live capture: OK');
    const beforeExit = await second.evaluate(() => [...audioTestTracks].length);
    stage = 'teardown';
    assert(beforeExit > 0);
    await second.evaluate(() => MeetingMain.stop());
    assert(await second.evaluate(() => audioTestTracks.every(t => t.readyState === 'ended') && !document.querySelector('[data-room-audio]')));
    assert.deepEqual(errors, []);
    console.log('Meeting exit released all captures and playback; browser errors: none');
    complete = true;
  } finally {
    if (!complete) for (const page of pages) {
      try { console.log('Audio diagnostic:', await page.evaluate(() => ({phase:voiceChat?.phase,error:voiceChat?.error,
        recording:voiceChat?.recording,want:voiceChat?.wantRecording,remote:voiceChat?.remote.size,
        tracks:window.audioTestTracks?.map(t=>t.readyState),stops:window.audioTestStops}))); } catch (_) {}
    }
    await browser.close();
  }
})().catch(e => { console.error(stage + ': ' + e.message); process.exitCode = 1; });
