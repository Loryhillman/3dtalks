const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith(path.join('src', 'websocket', 'voiceRelay.js')) &&
      request === '../database/db') return { query: async () => ({ rows: [] }) };
  return originalLoad(request, parent, isMain);
};
const relay = require('../src/websocket/voiceRelay');
Module._load = originalLoad;
process.env.ROOMS_ENABLED = 'true';
const roomA = 'room-a', roomB = 'room-b';
const positions = new Map([
  ['a1', { roomId: roomA, position: { x: 0, y: 0, z: 0 }, characterId: 'a1', characterName: 'A1' }],
  ['a2', { roomId: roomA, position: { x: 1, y: 0, z: 0 }, characterId: 'a2', characterName: 'A2' }],
  ['a3', { roomId: roomA, position: { x: 2, y: 0, z: 0 }, characterId: 'a3', characterName: 'A3' }],
  ['a4', { roomId: roomA, position: { x: 3, y: 0, z: 0 }, characterId: 'a4', characterName: 'A4' }],
  ['b1', { roomId: roomB, position: { x: 1, y: 0, z: 0 }, characterId: 'b1', characterName: 'B1' }]
]);
const sent = new Map();
const broadcasts = [];
const connections = new Map([...positions.keys()].map(id => [id, {
  readyState: 1, send(data) { sent.set(id, JSON.parse(data)); }
}]));
relay.init({ activeConnections: connections, playerPositions: positions,
  calculateDistance: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  broadcastToNearby(...args) { broadcasts.push(args); } });
(async () => {
  await relay.handleVoiceMessage('a1', connections.get('a1'),
    { audio: 'base64-audio', durationMs: 1000 });
  assert.equal(sent.get('a2')?.type, 'VOICE_MESSAGE');
  assert.ok(!sent.has('b1'));
  await relay.handleVoiceStart('a1', connections.get('a1'));
  await relay.handleVoiceStart('a2', connections.get('a2'));
  await relay.handleVoiceStart('a3', connections.get('a3'));
  await relay.handleVoiceStart('a4', connections.get('a4'));
  assert.equal(sent.get('a4')?.type, 'VOICE_DENIED');
  relay.handleDisconnect('a1');
  positions.delete('a1');
  assert.ok(broadcasts.some(args => args[2].type === 'VOICE_STATE' &&
    args[2].payload.characterId === 'a1' && args[2].payload.speaking === false &&
    args[4] === roomA));
  await relay.handleVoiceStart('a4', connections.get('a4'));
  assert.equal(sent.get('a4')?.type, 'VOICE_GRANTED');
  sent.delete('a2');
  await relay.handleVoiceMessage('a1', connections.get('a1'),
    { audio: 'stale-audio', durationMs: 1000 });
  assert.ok(!sent.has('a2'));
  console.log('Room voice isolation: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
