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
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const pages = []; let complete = false;
  const tokens = new WeakMap();
  try {
    async function enter(actor, room) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['microphone'] });
      await ctx.addInitScript(actor => {
        for (const key of ['token', 'userId', 'characterId']) localStorage.setItem(key, actor[key]);
        localStorage.setItem('locale', 'ru-RU');
        const get = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        window.audioTestTracks = [];
        navigator.mediaDevices.getUserMedia = async (...args) => {
          const stream = await get(...args); window.audioTestTracks.push(...stream.getTracks()); return stream;
        };
      }, actor);
      const page = await ctx.newPage(); page.setDefaultTimeout(45000);
      pages.push(page);
      page.on('websocket', socket => socket.on('framereceived', event => {
        try { const m=JSON.parse(event.payload); if(m.type==='ROOM_AUDIO_SESSION'&&m.payload.token)tokens.set(page,m.payload.token); } catch (_) {}
      }));
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/play?room=' + encodeURIComponent(room.slug));
      await page.waitForFunction(() => window.voiceChat?.isRealtime && voiceChat.phase === 'muted');
      await page.locator('#room-connection-overlay').waitFor({ state: 'hidden' });
      await page.evaluate(() => gameWorld.stopRendering()); // Bound software-rendering load; media remains real.
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
    console.log('Live microphone RTP/energy before release and room isolation: OK');
    await clickMic(second); await second.waitForFunction(() => voiceChat.recording);
    await first.waitForFunction(() => voiceChat.remote.size === 1);
    await first.waitForTimeout(1200); assert((await stats(first)).energy > 0, 'Simultaneous reverse audio');
    await second.evaluate(() => voiceChat.toggleMute());
    assert(await second.evaluate(() => [...voiceChat.remote.values()].every(e => e.element.muted)));
    assert(await second.evaluate(() => voiceChat.recording), 'Speaker mute must not stop microphone');
    await second.evaluate(() => voiceChat.toggleMute());
    await clickMic(first); await first.waitForFunction(() => !voiceChat.recording && audioTestTracks.every(t => t.readyState === 'ended'));
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
    if (process.env.ROOM_AUDIO_FORCE_RELAY === '1') {
      stage = 'relay receiver reconnect';
      await second.evaluate(() => {
        const Peer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Peer {
          constructor(config) { super({ ...config, iceTransportPolicy: 'relay' }); }
          setConfiguration(config) { super.setConfiguration({ ...config, iceTransportPolicy: 'relay' }); }
        };
        voiceChat.connect();
      });
      await second.waitForFunction(() => voiceChat.phase === 'muted');
      console.log('Forced relay session connected');
      await clickMic(isolated); await isolated.waitForFunction(() => voiceChat.recording);
      await clickMic(second); await second.waitForFunction(() => voiceChat.recording);
      stage = 'relay publication';
      await first.waitForFunction(() => voiceChat.remote.size === 1);
      stage = 'relay subscriber reconnect';
      // A subscriber relay candidate proves the receive path as well as publication.
      await first.evaluate(() => {
        const Peer = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Peer {
          constructor(config) { super({ ...config, iceTransportPolicy: 'relay' }); }
          setConfiguration(config) { super.setConfiguration({ ...config, iceTransportPolicy: 'relay' }); }
        };
        voiceChat.connect();
      });
      await first.waitForFunction(() => voiceChat.phase === 'muted' && voiceChat.remote.size === 1);
      await first.waitForTimeout(1500);
      const relay = await stats(first); assert.equal(relay.candidateType, 'relay'); assert(relay.energy > 0);
      console.log('Forced authenticated TURN relay and received audio: OK');
    }
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
        tracks:window.audioTestTracks?.map(t=>t.readyState)}))); } catch (_) {}
    }
    await browser.close();
  }
})().catch(e => { console.error(stage + ': ' + e.message); process.exitCode = 1; });
