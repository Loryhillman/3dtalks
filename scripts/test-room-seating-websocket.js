const assert = require('node:assert/strict');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const roomId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
let nextId = 0;
let moves = 0;
let claim;
let rejectAdmission = false;
const pose = { position: { x: 4, y: 1, z: 2 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
const service = {
  async admit(input) { if (rejectAdmission) throw Object.assign(new Error('ROOM_FULL'), { code: 'ROOM_FULL' }); claim = { ...input, seatId: claim?.seatId || 'seat-one', state: 'active' };
    return { seat: { id: claim.seatId }, pose }; },
  async move(input) { moves++; assert.equal(input.sessionId, claim.sessionId);
    claim.seatId = input.seatId; return { seat: { id: input.seatId }, pose }; },
  async hold(input) { if (claim?.sessionId !== input.sessionId) return false; claim.state = 'held'; return true; },
  async release(input) { if (claim?.sessionId !== input.sessionId) return false; claim = null; return true; },
  async list() { return claim ? [{ id: claim.seatId, occupancy: claim.state }] : []; }
};
class Socket extends EventEmitter {
  readyState = 1; sent = [];
  send(text) { this.sent.push(JSON.parse(text)); }
  close(code) { this.code = code; this.readyState = 3; this.emit('close'); }
  ping() {}
}
class Server extends EventEmitter { clients = new Set(); }
const original = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.endsWith(path.join('websocket', 'wsServer.js'))) {
    if (request === 'ws') return { Server, OPEN: 1 };
    if (request === 'uuid') return { v4: () => String(++nextId) };
    if (request === 'jsonwebtoken') return { verify: () => ({ userId: 'user' }) };
    if (request === '../database/db') return { pool: {}, query: async sql => ({ rows:
      sql.includes('c.id=u.room_character_id') ? [{ id: 'character' }] : sql.includes('FROM rooms r JOIN characters') ? [{ id: roomId, status: 'open', seating_mode: 'seated', capacity: 0 }] : [] }) };
    if (request === '../services/roomSeats') return { createRoomSeatService: () => service };
    if (request === './voiceRelay') return { init() {}, ensureDefaultConfig() {}, handleDisconnect() {} };
  }
  return original(request, parent, isMain);
};
process.env.ROOMS_ENABLED = 'true';
process.env.APP_MODE = 'rooms';
const server = require('../src/websocket/wsServer');
server.setupWebSocketServer({});
const wss = server.getWss();
const tick = () => new Promise(resolve => setImmediate(resolve));
const send = (ws, type, payload) => ws.emit('message', JSON.stringify({ type, payload }));
function connect() { const ws = new Socket(); wss.clients.add(ws); wss.emit('connection', ws); return ws; }
function join(ws) { send(ws, 'PLAYER_JOIN', { roomSlug: 'meeting', characterId: 'character', token: 'valid', position: { x: 999, y: 999, z: 999 } }); }

(async () => {
  try {
    const first = connect(); join(first); await tick();
    assert.equal(first.sent.find(m => m.type === 'ROOM_SEAT_ASSIGNED').payload.seat.id, 'seat-one');
    assert.deepEqual([...server.getPlayerPositions().values()][0].position, pose.position);
    send(first, 'POSITION_UPDATE', { position: { x: 99, y: 99, z: 99 } });
    send(first, 'SKILL_CAST', {});
    assert.deepEqual([...server.getPlayerPositions().values()][0].position, pose.position);
    assert.ok(!first.sent.some(m => ['POSITION_UPDATE', 'SKILL_CAST'].includes(m.type)));
    send(first, 'ROOM_LOOK', { yaw: 99, pitch: -99, characterId: 'someone-else' });
    const look = first.sent.find(m => m.type === 'ROOM_LOOK');
    assert.equal(look.payload.characterId, 'character');
    assert.deepEqual(look.payload.look, { yaw: 1.2, pitch: -.65 });
    send(first, 'ROOM_LOOK', { yaw: 0, pitch: 0 });
    assert.equal(first.sent.filter(m => m.type === 'ROOM_LOOK').length, 1, 'head updates must be rate limited');
    send(first, 'ROOM_SEAT_SELECT', { requestId: 'move-1', seatId: 'seat-two' });
    send(first, 'ROOM_SEAT_SELECT', { requestId: 'move-1', seatId: 'seat-two' });
    await tick();
    assert.equal(moves, 1, 'replayed command must not execute twice');
    send(first, 'ROOM_SEAT_SELECT', { requestId: 'move-1', seatId: 'seat-three' });
    await tick();
    assert.ok(first.sent.some(m => m.payload.code === 'REQUEST_ID_CONFLICT'));
    const invalid = connect();
    send(invalid, 'PLAYER_JOIN', { roomSlug: 'meeting', characterId: 'another-character', token: 'valid' }); await tick();
    assert.ok(invalid.sent.some(m => m.type === 'ROOM_JOIN_DENIED' && m.payload.code === 'CHARACTER_SESSION_CHANGED'));
    assert.equal(first.readyState, 1);
    const noRoom = connect(); send(noRoom, 'PLAYER_JOIN', { characterId: 'character', token: 'valid' }); await tick();
    assert.ok(noRoom.sent.some(m => m.payload.code === 'ROOM_REQUIRED'));
    rejectAdmission = true;
    const full = connect(); join(full); await tick();
    assert.ok(full.sent.some(m => m.payload.code === 'ROOM_FULL'));
    assert.equal(first.readyState, 1, 'failed destination must retain original connection');
    assert.equal(claim.sessionId, '1');
    rejectAdmission = false;
    const second = connect(); join(second); await tick(); await tick();
    assert.equal(first.code, 4002);
    assert.equal(claim.state, 'active', 'old close must not hold the replacement seat');
    assert.equal([...server.getPlayerPositions().values()].length, 1);
    second.close(1006); await tick(); await tick();
    assert.equal(claim.state, 'held');
    const third = connect(); join(third); await tick();
    assert.equal(claim.state, 'active');
    send(third, 'ROOM_LEAVE', { requestId: 'leave-1' }); await tick(); await tick();
    assert.equal(claim, null);
    assert.equal(server.getPlayerPositions().size, 0);
    assert.ok(third.sent.some(m => m.type === 'ROOM_LEFT'));
    console.log('Room seating WebSocket: assignment, movement lock, replay, replacement, hold and leave OK');
  } finally { wss.emit('close'); Module._load = original; }
})().catch(error => { console.error(error); process.exitCode = 1; });
