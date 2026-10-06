const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const path = require('node:path');

const roomA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const roomB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const roomC = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const mainRoom = '00000000-0000-0000-0000-000000000001';
const updateOrder = [];
let releaseFirst;
const firstUpdate = new Promise(resolve => { releaseFirst = resolve; });
let releaseCapacity;
const capacityUpdate = new Promise(resolve => { releaseCapacity = resolve; });
let releaseDisconnect;
const disconnectUpdate = new Promise(resolve => { releaseDisconnect = resolve; });
let nextId = 0;
class FakeSocket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code) { this.closedCode = code; this.readyState = 3; }
  ping() {}
}
class FakeServer extends EventEmitter { clients = new Set(); }
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith(path.join('src', 'websocket', 'wsServer.js'))) {
    if (request === 'ws') return { Server: FakeServer, OPEN: 1 };
    if (request === 'uuid') return { v4: () => String(++nextId) };
    if (request === 'jsonwebtoken') return { verify: () => ({ userId: 'user-1' }) };
    if (request === '../database/db') return { query: async (sql, values) => {
      if (sql.includes('FROM rooms r JOIN characters')) return { rows: [{
        id: values[0] === 'a' ? roomA : values[0] === 'c' ? roomC : roomB,
        capacity: values[0] === 'c' ? 1 : 6, status: 'open',
        spawn_position: { x: 0, y: 0, z: 0 }, character_name: 'Player'
      }] };
      if (sql.includes('UPDATE characters SET last_room_id')) {
        if (values[1] === 'closing-character') await disconnectUpdate;
        if (values[0] === roomA) await firstUpdate;
        if (values[0] === roomC) await capacityUpdate;
        updateOrder.push(values[0]);
        return { rows: [{ name: 'Player' }] };
      }
      return { rows: [] };
    } };
    if (request === './voiceRelay') return { init() {}, ensureDefaultConfig() {},
      handleDisconnect() {}, handleVoiceStart() {}, handleVoiceEnd() {},
      handleVoiceProbe() {}, handleVoiceMessage() {} };
    if (request === '../services/roomScope') return { MAIN_ROOM_ID: mainRoom };
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
function join(ws, roomSlug, characterId = 'same-character') {
  ws.emit('message', JSON.stringify({ type: 'PLAYER_JOIN', payload: {
    roomSlug, token: 'valid', characterId,
    characterName: 'Player', position: { x: 0, y: 2, z: 0 }
  } }));
}
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  try {
    const first = connect();
    const second = connect();
    join(first, 'a');
    join(second, 'b');
    await tick();
    assert.deepEqual(updateOrder, [], 'second join must wait for the first database update');
    releaseFirst();
    await tick();
    await tick();
    assert.deepEqual(updateOrder, [roomA, roomB]);
    assert.equal(first.closedCode, 4002);
    assert.deepEqual([...server.getPlayerPositions().values()]
      .filter(player => player.characterId === 'same-character').map(player => player.roomId), [roomB]);

    const main = connect();
    join(main, 'main');
    await tick();
    await tick();
    assert.deepEqual(updateOrder, [roomA, roomB, mainRoom]);
    assert.equal(second.closedCode, 4002);
    assert.deepEqual([...server.getPlayerPositions().values()]
      .filter(player => player.characterId === 'same-character').map(player => player.roomId), [mainRoom]);
    const contenderOne = connect();
    const contenderTwo = connect();
    join(contenderOne, 'c', 'character-one');
    join(contenderTwo, 'c', 'character-two');
    await tick();
    releaseCapacity();
    await tick();
    await tick();
    assert.equal(updateOrder.filter(id => id === roomC).length, 1,
      'only one character may claim the last place');
    assert.equal([...server.getPlayerPositions().values()].filter(p => p.roomId === roomC).length, 1);
    assert.ok(contenderTwo.sent.some(message => message.type === 'ROOM_JOIN_DENIED'),
      'the second concurrent entrant receives a denial');
    const closing = connect();
    join(closing, 'b', 'closing-character');
    await tick();
    closing.close(1000);
    releaseDisconnect();
    await tick();
    await tick();
    assert.ok(![...server.getPlayerPositions().values()].some(p => p.characterId === 'closing-character'),
      'disconnect during authorization must not leave a ghost participant');
    console.log('Room join race: OK');
  } finally {
    wss.emit('close');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
