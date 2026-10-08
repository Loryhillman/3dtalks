const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { LIMITS, createIngress, protectRoomSocket } = require('../src/websocket/roomSocketPolicy');

const raw = (type, payload = {}) => JSON.stringify({ type, payload });
let time = 0;
const ingress = createIngress(() => time);
for (let i = 0; i < 8; i++) assert(ingress(raw('CHAT', { message: 'hello' }), false, true).data);
assert.equal(ingress(raw('CHAT'), false, true).code, 1008);
time = 500;
assert(ingress(raw('CHAT'), false, true).data, 'chat allowance refills with elapsed time');
assert(createIngress()(raw('ROOM_LOOK'), false, true).data);
assert(!createIngress()(raw('CHAT'), false, false).data, 'unregistered sockets cannot broadcast');
assert(!createIngress()(raw('MONSTER_ATTACK'), false, true).data, 'legacy commands do not dispatch');
assert.equal(createIngress()('null', false, true).code, 1008);
assert.equal(createIngress()(raw('PING', []), false, true).code, 1008);
assert.equal(createIngress()(raw('PING'), true, true).code, 1003);
assert.equal(createIngress()('{broken', false, true).code, 1007);
assert.equal(createIngress()(raw('PING', { pad: 'x'.repeat(LIMITS.controlBytes) }), false, true).code, 1009);
const audio = raw('VOICE_MESSAGE', { audio: 'A'.repeat(2 * 1024 * 1024), durationMs: 60000 });
assert(createIngress()(audio, false, true).data, 'current maximum voice message fits');
const joins = createIngress(() => 0);
for (let i = 0; i < 3; i++) assert(joins(raw('PLAYER_JOIN'), false, false).data);
assert.equal(joins(raw('PLAYER_JOIN'), false, false).code, 1008, 'join flood stops before database work');
const packets = createIngress(() => 0);
for (let i = 0; i < 240; i++) assert(packets(raw('ROOM_LOOK'), false, true).data);
assert.equal(packets(raw('ROOM_LOOK'), false, true).code, 1008);
const traffic = createIngress(() => 0);
let bytesRejected = false;
for (let i = 0; i < 140; i++) {
  if (traffic(raw('ROOM_LOOK', { pad: 'x'.repeat(63000) }), false, true).code === 1008) {
    bytesRejected = true;
    break;
  }
}
assert(bytesRejected, 'byte budget must reject sustained large control packets');

let server;
let accepted = [];
async function connect(timeout = 1000) {
  nextTimeout = timeout;
  const client = new WebSocket('ws://127.0.0.1:' + server.address().port);
  client.on('error', () => {});
  await once(client, 'open');
  return client;
}
let nextTimeout;
async function expectClose(send, code) {
  const client = await connect();
  const closed = once(client, 'close');
  send(client);
  assert.equal((await closed)[0], code);
}

(async () => {
  server = new WebSocket.Server({ host: '127.0.0.1', port: 0, maxPayload: LIMITS.packetBytes });
  server.on('connection', ws => {
    let joined = false;
    ws.on('error', () => {});
    protectRoomSocket(ws, { joinTimeoutMs: nextTimeout, isJoined: () => joined, onMessage: data => {
      accepted.push(data.type);
      if (data.type === 'PLAYER_JOIN') joined = true;
      ws.send(JSON.stringify({ type: 'ACK', command: data.type }));
    } });
  });
  await once(server, 'listening');
  const good = await connect(150);
  accepted = [];
  let ack = once(good, 'message'); good.send(raw('PLAYER_JOIN')); await ack;
  ack = once(good, 'message'); good.send(audio); await ack;
  ack = once(good, 'message'); good.send(raw('ROOM_SEAT_SELECT', { requestId: 'seat-1', seatId: 'one' })); await ack;
  // Wait beyond the initial admission deadline: registered users stay connected.
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(good.readyState, WebSocket.OPEN);
  assert.deepEqual(accepted, ['PLAYER_JOIN', 'VOICE_MESSAGE', 'ROOM_SEAT_SELECT']);
  let closed = once(good, 'close'); good.close(); await closed;

  await expectClose(client => client.send('null'), 1008);
  await expectClose(client => client.send('{bad'), 1007);
  await expectClose(client => client.send(Buffer.from('binary')), 1003);
  await expectClose(client => client.send('x'.repeat(LIMITS.packetBytes + 1)), 1009);
  const spam = await connect();
  ack = once(spam, 'message'); spam.send(raw('PLAYER_JOIN')); await ack;
  accepted = [];
  closed = once(spam, 'close');
  for (let i = 0; i < 20; i++) spam.send(raw('CHAT', { message: 'spam' }));
  assert.equal((await closed)[0], 1008);
  assert.equal(accepted.length, 8, 'excess messages never dispatch');
  const idle = await connect(40);
  assert.equal((await once(idle, 'close'))[0], 1008);

  // Artificially blocked transport: its outgoing buffer cannot grow unbounded.
  const blocked = await connect();
  const peer = [...server.clients][0];
  Object.defineProperty(peer, 'bufferedAmount', { value: LIMITS.outgoingBytes });
  closed = once(blocked, 'close'); peer.send('overflow'); await closed;
  console.log('Room sockets: real transport size limits, valid audio/seats, spam rejection, join timeout and slow-receiver termination OK');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) {
    for (const ws of server.clients) ws.terminate();
    await new Promise(resolve => server.close(resolve));
  }
});
