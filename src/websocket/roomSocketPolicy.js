const { performance } = require('node:perf_hooks');

// Audio is currently sent as a single base64 JSON message (up to 2 MiB).
// Control messages must not inherit this large allowance.
const LIMITS = Object.freeze({
  packetBytes: 2 * 1024 * 1024 + 16 * 1024,
  controlBytes: 64 * 1024,
  outgoingBytes: 8 * 1024 * 1024,
  connections: 256,
  pendingConnections: 32,
  joinTimeoutMs: 30000
});
const TYPES = new Set([
  'PLAYER_JOIN', 'PING', 'POSITION_UPDATE', 'ROOM_LOOK', 'ROOM_SEAT_SELECT',
  'ROOM_LEAVE', 'CHAT', 'VOICE_START', 'VOICE_END', 'VOICE_PROBE', 'VOICE_MESSAGE'
]);
const RATES = {
  all: [120, 240], bytes: [1024 * 1024, 8 * 1024 * 1024],
  join: [0.2, 3], chat: [2, 8], seat: [2, 10], voice: [4, 12], audio: [0.5, 3]
};
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function byteLength(value) {
  return typeof value === 'string' ? Buffer.byteLength(value) : value.byteLength;
}
function createIngress(now = () => performance.now()) {
  const buckets = new Map();
  function take(name, cost = 1) {
    const [rate, capacity] = RATES[name];
    const time = now();
    const bucket = buckets.get(name) || { tokens: capacity, time };
    bucket.tokens = Math.min(capacity, bucket.tokens + Math.max(0, time - bucket.time) * rate / 1000);
    bucket.time = time;
    buckets.set(name, bucket);
    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  }
  return function inspect(raw, isBinary, joined) {
    if (isBinary) return { code: 1003, reason: 'Text messages required' };
    const bytes = byteLength(raw);
    if (bytes > LIMITS.packetBytes) return { code: 1009, reason: 'Message too large' };
    if (!take('all') || !take('bytes', bytes)) return { code: 1008, reason: 'Message rate exceeded' };
    let data;
    try { data = JSON.parse(raw.toString()); }
    catch (_) { return { code: 1007, reason: 'Invalid JSON' }; }
    if (!record(data) || typeof data.type !== 'string' ||
        (data.payload !== undefined && !record(data.payload))) {
      return { code: 1008, reason: 'Invalid message format' };
    }
    if (data.type !== 'VOICE_MESSAGE' && bytes > LIMITS.controlBytes) {
      return { code: 1009, reason: 'Control message too large' };
    }
    // Removed RPG commands cannot invoke the old handlers in rooms mode.
    if (!TYPES.has(data.type) || (!joined && !['PLAYER_JOIN', 'PING'].includes(data.type))) return {};
    let bucket;
    if (data.type === 'PLAYER_JOIN') bucket = 'join';
    else if (data.type === 'CHAT') bucket = 'chat';
    else if (['ROOM_SEAT_SELECT', 'ROOM_LEAVE'].includes(data.type)) bucket = 'seat';
    else if (data.type === 'VOICE_MESSAGE') bucket = 'audio';
    else if (data.type.startsWith('VOICE_')) bucket = 'voice';
    if (bucket && !take(bucket)) return { code: 1008, reason: 'Command rate exceeded' };
    return { data: { ...data, payload: data.payload || {} } };
  };
}

function protectRoomSocket(ws, { isJoined, onMessage, joinTimeoutMs = LIMITS.joinTimeoutMs }) {
  const inspect = createIngress();
  let stopped = false;
  function reject(code, reason) {
    if (stopped) return;
    stopped = true;
    ws.close(code, reason);
  }
  const joinTimer = setTimeout(() => {
    if (!isJoined()) reject(1008, 'Room join timed out');
  }, joinTimeoutMs);
  joinTimer.unref?.();
  ws.once('close', () => { stopped = true; clearTimeout(joinTimer); });
  const send = ws.send;
  ws.send = function(data, ...args) {
    if (stopped || ws.readyState !== 1) return;
    if ((ws.bufferedAmount || 0) + byteLength(data) > LIMITS.outgoingBytes) {
      stopped = true;
      ws.terminate();
      return;
    }
    return send.call(ws, data, ...args);
  };
  ws.on('message', (raw, isBinary) => {
    if (stopped || ws.readyState !== 1) return;
    const result = inspect(raw, isBinary, isJoined());
    if (result.code) return reject(result.code, result.reason);
    if (result.data) onMessage(result.data);
  });
}
module.exports = { LIMITS, createIngress, protectRoomSocket };
