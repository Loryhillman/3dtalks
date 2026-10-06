const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');

const roomA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const roomB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MAIN_ROOM_ID = '00000000-0000-0000-0000-000000000001';
let nextId = 0;
let roomAStatus = 'open';
let roomAAllowsRejoin = false;
const persistentGrants = new Set();
const grantRefreshes = [];
const positionSaves = [];
class FakeSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(message) { this.sent.push(JSON.parse(message)); }
  close(code) { this.closedCode = code; this.readyState = 3; }
  ping() {}
}
class FakeServer extends EventEmitter {
  clients = new Set();
}
const fakeWebSocket = { Server: FakeServer, OPEN: 1 };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith(path.join('src', 'websocket', 'wsServer.js'))) {
    if (request === 'ws') return fakeWebSocket;
    if (request === 'uuid') return { v4: () => String(++nextId) };
    if (request === 'jsonwebtoken') return {
      verify: token => { if (token !== 'valid') throw Error('Invalid token'); return { userId: 'user-1' }; }
    };
    if (request === '../database/db') return { query: async (sql, values) => {
      if (sql.includes('FROM rooms r JOIN characters')) {
        const room = values[0] === 'a' ? roomA : values[0] === 'b' ? roomB : null;
        return { rows: room ? [{ id: room, capacity: 6,
          status: room === roomA ? roomAStatus : 'open',
          allow_rejoin: room === roomA ? roomAAllowsRejoin : false,
          spawn_position: { x: 0, y: 0, z: 0 }, character_name: values[2],
          last_room_id: room, last_position: { x: 5, y: 2, z: 1 } }] : [] };
      }
      if (sql.includes('SELECT status, allow_rejoin FROM rooms')) return {
        rows: [{ status: roomAStatus, allow_rejoin: roomAAllowsRejoin }]
      };
      if (sql.includes('SELECT 1 FROM room_rejoin_grants')) return {
        rows: roomAAllowsRejoin && persistentGrants.has(`${values[0]}:${values[1]}`)
          ? [{ '?column?': 1 }] : []
      };
      if (sql.includes('FROM portals')) return { rows: [{ id: 'main-portal' }] };
      if (sql.includes('UPDATE room_rejoin_grants')) grantRefreshes.push({ sql, values });
      if (sql.includes('UPDATE characters c SET last_position')) positionSaves.push({ sql, values });
      return { rows: [] };
    } };
    if (request === './voiceRelay') return { init() {}, ensureDefaultConfig() {},
      handleDisconnect() {}, handleVoiceStart() {}, handleVoiceEnd() {},
      handleVoiceProbe() {}, handleVoiceMessage() {} };
    if (request === '../services/roomScope') return { MAIN_ROOM_ID };
  }
  return originalLoad(request, parent, isMain);
};
const server = require('../src/websocket/wsServer');
Module._load = originalLoad;
process.env.ROOMS_ENABLED = 'true';
process.env.JWT_SECRET = 'test';
server.setupWebSocketServer({});
const wss = server.getWss();
function connect() {
  const ws = new FakeSocket();
  wss.clients.add(ws);
  wss.emit('connection', ws);
  return ws;
}
function send(ws, type, payload) { ws.emit('message', JSON.stringify({ type, payload })); }
const types = ws => ws.sent.map(item => item.type);

(async () => {
  const a = connect(), b = connect(), main = connect();
  send(a, 'PLAYER_JOIN', { roomSlug: 'a', token: 'valid', characterId: 'char-a',
    characterName: 'A', position: { x: 0, y: 0, z: 0 } });
  send(b, 'PLAYER_JOIN', { roomSlug: 'b', token: 'valid', characterId: 'char-b',
    characterName: 'B', position: { x: 0, y: 0, z: 0 } });
  send(main, 'PLAYER_JOIN', { characterId: 'guest', characterName: 'Guest',
    position: { x: 0, y: 0, z: 0 }, isGuest: true });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(a.sent.find(item => item.type === 'WORLD_STATE').payload.players.map(p => p.characterId), ['char-a']);
  assert.deepEqual(b.sent.find(item => item.type === 'WORLD_STATE').payload.players.map(p => p.characterId), ['char-b']);
  a.sent.length = b.sent.length = main.sent.length = 0;
  send(a, 'POSITION_UPDATE', { characterId: 'spoofed', position: { x: 2, y: 0, z: 0 } });
  assert.ok(types(a).includes('POSITION_UPDATE'));
  assert.equal(a.sent.find(item => item.type === 'POSITION_UPDATE').payload.characterId, 'char-a');
  assert.ok(!types(b).includes('POSITION_UPDATE'));
  assert.ok(!types(main).includes('POSITION_UPDATE'));
  send(a, 'CHAT', { message: 'hello from A' });
  assert.ok(types(a).includes('CHAT'));
  assert.ok(!types(b).includes('CHAT'));
  assert.ok(!types(main).includes('CHAT'));
  send(a, 'REQUEST_PORTALS', {});
  send(main, 'REQUEST_PORTALS', {});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(a.sent.find(item => item.type === 'PORTALS_LIST').payload.portals, []);
  assert.deepEqual(main.sent.find(item => item.type === 'PORTALS_LIST').payload.portals,
    [{ id: 'main-portal' }]);
  roomAStatus = 'closed';
  roomAAllowsRejoin = true;
  persistentGrants.add(`${roomA}:char-restored`);
  persistentGrants.add(`${roomA}:char-a`);
  await server.refreshActiveRoomGrants();
  assert.ok(grantRefreshes.some(item => item.values[0] === roomA && item.values[1].includes('char-a')));
  assert.ok(positionSaves.some(item => item.values[0] === roomA &&
    JSON.parse(item.values[1]).some(player => player.id === 'char-a' && player.position.x === 2)));
  assert.equal(await server.hasPersistentRoomReturnAccess(roomA, 'char-restored'), true);
  assert.equal(await server.hasPersistentRoomReturnAccess(roomA, 'stranger'), false);
  const restored = connect();
  send(restored, 'PLAYER_JOIN', { roomSlug: 'a', token: 'valid', characterId: 'char-restored',
    characterName: 'Restored' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(server.getPlayerPositions().get(String(nextId)).position.x, 5);
  const replacement = connect();
  send(replacement, 'PLAYER_JOIN', { roomSlug: 'a', token: 'valid',
    characterId: 'char-restored', characterName: 'Restored',
    position: { x: 6, y: 2, z: 1 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restored.closedCode, 4002);
  assert.ok(types(restored).includes('ROOM_SESSION_REPLACED'));
  const beforeStaleChat = a.sent.length;
  send(restored, 'CHAT', { message: 'stale' });
  send(restored, 'PLAYER_JOIN', { roomSlug: 'a', token: 'valid',
    characterId: 'char-restored', characterName: 'Restored' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(a.sent.length, beforeStaleChat);
  assert.equal([...server.getPlayerPositions().values()]
    .filter(player => player.characterId === 'char-restored').length, 1);
  assert.equal(server.getPlayerPositions().get(String(nextId)).position.x, 5);
  assert.equal(replacement.sent.find(item => item.type === 'WORLD_STATE').payload.players
    .filter(player => player.characterId === 'char-restored').length, 1);
  a.sent.length = 0;
  restored.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!types(a).includes('PLAYER_LEFT'));
  a.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(server.hasRoomReturnAccess(roomA, 'char-a'), true);
  const returned = connect();
  send(returned, 'PLAYER_JOIN', { roomSlug: 'a', token: 'valid', characterId: 'char-a',
    characterName: 'A', position: { x: 7, y: 2, z: 1 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(types(returned).includes('WORLD_STATE'));
  assert.equal(server.getPlayerPositions().get(String(nextId)).position.x, 7);
  const stranger = connect();
  send(stranger, 'PLAYER_JOIN', { roomSlug: 'a', token: 'valid', characterId: 'stranger',
    characterName: 'Stranger', position: { x: 0, y: 0, z: 0 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(types(stranger).includes('ROOM_JOIN_DENIED'));
  returned.sent.length = b.sent.length = main.sent.length = 0;
  assert.equal(server.endRoom(roomA), 2);
  assert.deepEqual(types(returned), ['ROOM_ENDED']);
  assert.equal(returned.closedCode, 4001);
  assert.equal(server.hasRoomReturnAccess(roomA, 'char-a'), false);
  roomAAllowsRejoin = false;
  assert.equal(await server.hasPersistentRoomReturnAccess(roomA, 'char-restored'), false);
  assert.equal(types(b).length, 0);
  assert.equal(types(main).length, 0);
  console.log('Room WebSocket isolation: OK');
  wss.emit('close');
})().catch(error => { console.error(error); process.exitCode = 1; wss.emit('close'); });
