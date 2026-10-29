const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createRoomAudio } = require('../src/services/roomAudio');
(async () => {
  const peers = new Map([['one', { roomId: 'room-a', epoch: 1, characterId: 'alice' }],
    ['two', { roomId: 'room-b', epoch: 1, characterId: 'bob' }]]);
  const removed = [], warnings = [];
  let fail = false, blocked, reads = 0;
  const config = { ROOM_REALTIME_AUDIO_ENABLED: 'true', LIVEKIT_API_KEY: 'test-key',
    LIVEKIT_API_SECRET: 'a'.repeat(64), LIVEKIT_URL: 'wss://test/livekit', LIVEKIT_INTERNAL_URL: 'http://test' };
  const client = {
    async removeParticipant(room, id) { if (fail) throw Error('offline'); removed.push([room, id]); },
    async listRooms() { reads++; if (blocked) await blocked; return [{ name: '3dtalks_room-a_1' }, { name: 'other-app' }]; },
    async listParticipants() { return [{ identity: 'ws_one' }, { identity: 'survived-restart' }]; }
  };
  const audio = createRoomAudio({ identity: id => peers.get(id), config, client, warn: code => warnings.push(code) });
  await assert.rejects(audio.grant('anonymous'), /ADMISSION/);
  const one = await audio.grant('one'), two = await audio.grant('two');
  const claims = jwt.verify(one.token, config.LIVEKIT_API_SECRET);
  assert.equal(claims.sub, 'ws_one'); assert.equal(claims.exp - claims.nbf, 60);
  assert.equal(claims.video.room, '3dtalks_room-a_1'); assert.equal(claims.video.canPublishData, false);
  assert.equal(claims.video.canUpdateOwnMetadata, false);
  assert.deepEqual(claims.video.canPublishSources, ['microphone']);
  assert.notEqual(claims.video.room, jwt.decode(two.token).video.room);
  assert(audio.authorize(one.token)); assert(!audio.authorize('garbage'));
  assert(!audio.authorize(jwt.sign({ sub: 'ws_one', video: { roomJoin: true, room: '3dtalks_room-b_1' } }, config.LIVEKIT_API_SECRET, { issuer: config.LIVEKIT_API_KEY })));
  peers.get('one').epoch = 2; assert(!audio.authorize(one.token));
  await audio.reconcile(); assert.equal(removed.length, 2);
  peers.get('one').epoch = 1;
  const next = await audio.grant('one'); fail = true; audio.revoke('one');
  assert(!audio.authorize(next.token));
  await new Promise(resolve => setImmediate(resolve)); assert(warnings.includes('remove_failed'));
  fail = false; await audio.reconcile(); assert(removed.some(([, id]) => id === 'ws_one'));
  let release; blocked = new Promise(resolve => { release = resolve; }); const before = reads;
  const pending = audio.reconcile(); await audio.reconcile(); assert.equal(reads, before + 1); release(); await pending;
  audio.stop();
  const disabled = createRoomAudio({ identity: () => null, config: {} });
  assert(!disabled.enabled); assert(!disabled.authorize(one.token)); await assert.rejects(disabled.grant('one'), /DISABLED/);
  console.log('Room audio: admission, microphone-only grants, isolation, expiry/epoch, revocation, restart cleanup and non-overlapping retries OK');
})().catch(e => { console.error(e); process.exitCode = 1; });
