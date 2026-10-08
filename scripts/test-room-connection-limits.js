const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const { LIMITS } = require('../src/websocket/roomSocketPolicy');
const originalLoad = Module._load;
const originalMode = process.env.APP_MODE;
process.env.APP_MODE = 'rooms';
Module._load = function(name, parent, ...args) {
  if (parent?.filename.endsWith('/websocket/wsServer.js')) {
    if (name === 'uuid') return { v4: randomUUID };
    if (name === '../database/db') return { query: async () => ({ rows: [] }) };
    if (name === './voiceRelay') return { init() {}, ensureDefaultConfig() {}, handleDisconnect() {} };
  }
  return originalLoad(name, parent, ...args);
};
const wsServer = require('../src/websocket/wsServer');
Module._load = originalLoad;
const clients = [];
let server;
const originalLog = console.log;
console.log = () => {};
(async () => {
  server = http.createServer();
  wsServer.setupWebSocketServer(server);
  const wss = wsServer.getWss();
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  async function connect() {
    const ws = new WebSocket('ws://127.0.0.1:' + server.address().port);
    ws.on('error', () => {});
    clients.push(ws);
    const closed = once(ws, 'close');
    await once(ws, 'open');
    return { ws, closed };
  }
  for (let i = 0; i < LIMITS.pendingConnections; i++) await connect();
  const excess = await connect();
  await excess.closed;
  assert.equal(wss.clients.size, LIMITS.pendingConnections, 'rejected connection leaves no extra socket');
  clients[0].terminate();
  // Client and server close events are independent; wait for server cleanup.
  await once([...wss.clients][0], 'close');
  const replacement = await connect();
  const pong = once(replacement.ws, 'message');
  replacement.ws.send(JSON.stringify({ type: 'PING' }));
  assert.equal(JSON.parse((await pong)[0]).type, 'PONG', 'released connection budget is reusable');
  assert.equal(wss.clients.size, LIMITS.pendingConnections);
  originalLog('Room socket connection limit: pending admission bounded, excess sockets terminated, released capacity reusable OK');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const ws of clients) ws.terminate();
  if (wsServer.getWss()) {
    for (const ws of wsServer.getWss().clients) ws.terminate();
    await new Promise(resolve => wsServer.getWss().close(resolve));
  }
  if (server) await new Promise(resolve => server.close(resolve));
  if (originalMode === undefined) delete process.env.APP_MODE; else process.env.APP_MODE = originalMode;
  console.log = originalLog;
});
