const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const elements = [];
function element(tag) {
  const node = { classList:{add(){},toggle(){}}, focus(){}, tag, style: {}, dataset: {}, children: [], textContent: '',
    append(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
    setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; },
    querySelector() { return this.children.find(c => c.dataset.status !== undefined); } };
  elements.push(node); return node;
}
const sent = [];
const group = { position: { set(...values) { this.values = values; } }, quaternion: { set() {} }, userData: {} };
class Vector3 {constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}clone(){return new Vector3(this.x,this.y,this.z);}add(v){this.x+=v.x;this.y+=v.y;this.z+=v.z;return this;}}
const context = {THREE:{Vector3}, document: {head:element('head'),addEventListener(){}, body: element('body'), createElement: element },
  GAME_STATE: { characterId: 'me' }, WebSocket: { OPEN: 1 },
  WSClient: { connected: true, ws: { readyState: 1 }, send: msg => sent.push(msg) },
  crypto: { randomUUID: () => 'request-1' }, setTimeout: () => 1, clearTimeout() {},
  location: { reload() {}, assign() {} }, window: { gameWorld: { players: new Map([['me', { group }]]) } } };
vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/roomSeating.js'), 'utf8'), context);
const client = context.window.RoomSeating;
client.enter({ id: 'room', seating_mode: 'free' }); assert.equal(client.active, false);
client.enter({ id: 'room', seating_mode: 'seated' }); assert.equal(client.active, true);
const overlay = elements.find(n => n.style.cssText?.includes('inset:0'));
assert.equal(overlay.style.display, 'flex');
const seat = { id: 'one', position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
client.message('ROOM_SEAT_ASSIGNED', { roomId: 'foreign', seat });
assert.equal(overlay.style.display, 'flex');
client.message('ROOM_SEAT_ASSIGNED', { roomId: 'room', seat });
assert.equal(overlay.style.display, 'flex', 'seat assignment alone must not expose an empty scene');
client.sceneReady();
assert.equal(overlay.style.display, 'none');
assert.deepEqual(group.position.values, [1, 2, 3]);
client.message('ROOM_SEATS_STATE', { roomId: 'room', version: 1, seats: [
  { id: 'one', label: '1', map_x: 0, map_y: 0, position:{x:1,y:2,z:3}, occupancy: 'active', character_id: 'me' },
  { id: 'two', label: '2', map_x: 1, map_y: 1, position:{x:4,y:2,z:3}, occupancy: 'free' }
] });
const free = elements.find(n => n.tag === 'button' && n.textContent.startsWith('Место 2:'));
assert.equal(free.disabled, false); free.onclick();
assert.equal(sent.length,0,'inspection must not send a seating command');
const take=elements.filter(n=>n.tag==='button'&&n.textContent==='Занять').at(-1);
take.onclick();take.onclick();
assert.equal(sent.length, 1, 'only one command may be pending');
assert.equal(sent[0].payload.seatId, 'two');
client.message('ROOM_SEAT_RESULT', { requestId: 'request-1', success: false });
assert.deepEqual(group.position.values, [1, 2, 3], 'rejection keeps the original position');
client.disconnected(); assert.equal(overlay.style.display, 'flex');
let cameraUpdates = 0;
client.updateLocal({ characterId: 'me', position: { set() {} }, updateCamera() { cameraUpdates++; } }, {});
assert.equal(cameraUpdates, 1);
console.log('Room seat client: admission overlay, room scope, command gating and retained position OK');
