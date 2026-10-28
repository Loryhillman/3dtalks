const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const signal = require('../public/js/avatarAudioSignal'), { wav } = require('./avatar-lab-audio-fixture');
const lab = require('../tools/avatar-lipsync-lab/audio-signal');
const bytes = wav(), pcm = lab.parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const envelope = signal.envelope(pcm);
assert.throws(() => signal.envelope({ ...pcm, duration: 1000 }));
assert.throws(() => signal.envelope({ ...pcm, channels: [new Float32Array([NaN])] }));
assert.equal(signal.at(envelope, NaN), 0);
const ctx = { console, URL, AvatarAudioSignal: signal }; ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require.resolve('../public/js/lib/three.min.js'), 'utf8'), ctx);
ctx.document = { hidden: false };
vm.runInContext(fs.readFileSync(require.resolve('../public/js/meetingMouthAnimation.js'), 'utf8'), ctx);
const THREE = ctx.THREE, mouth = ctx.MeetingMouthAnimation;
function avatar(shape = 'viseme_aa') {
  const group = new THREE.Group(), root = new THREE.Group(), mesh = new THREE.Object3D();
  mesh.morphTargetDictionary = { [shape]: 0 }; mesh.morphTargetInfluences = [0];
  root.add(mesh); group.userData.accountAvatarRoot = root;
  return { group, mesh, root };
}
const a = avatar(), b = avatar('jawOpen');
const world = ctx.gameWorld = { isMeeting: true, players: new Map([['a', a], ['b', b]]) };
const clock = { state: 'running', currentTime: .5 }, one = {}, two = {};
mouth.start('a', one, clock, 0, envelope); mouth.update(world);
assert(a.mesh.morphTargetInfluences[0] > .1); assert.equal(b.mesh.morphTargetInfluences[0], 0);
const normal=a.mesh.morphTargetInfluences[0];
a.group.userData.accountAvatarConfig={mouthGain:.5};mouth.update(world);
assert(Math.abs(a.mesh.morphTargetInfluences[0]-normal*.5)<1e-6);
a.group.userData.accountAvatarConfig={mouthGain:2};mouth.update(world);
assert(Math.abs(a.mesh.morphTargetInfluences[0]-Math.min(.85,normal*2))<1e-6);
assert.equal(signal.calibrate(0,2),0);assert.equal(signal.calibrate(1,100),.85);assert.equal(signal.calibrate(.2,NaN),.2);
delete a.group.userData.accountAvatarConfig;
clock.currentTime = 1.6; mouth.update(world); assert.equal(a.mesh.morphTargetInfluences[0], 0);
mouth.start('b', two, clock, 1.1, envelope); mouth.update(world);
assert(b.mesh.morphTargetInfluences[0] > .1); assert.equal(a.mesh.morphTargetInfluences[0], 0);
clock.state = 'suspended'; mouth.update(world); assert.equal(b.mesh.morphTargetInfluences[0], 0);
clock.state = 'running'; ctx.document.hidden = true; mouth.update(world); assert.equal(b.mesh.morphTargetInfluences[0], 0);
ctx.document.hidden = false;
// A GLB completing after the binding was first inspected must acquire mouth targets.
const late = new THREE.Object3D(); late.morphTargetDictionary = { viseme_aa: 0 }; late.morphTargetInfluences = [0];
b.root.clear(); b.root.add(late); b.group.userData.accountAvatarGeometryVersion = 1;
mouth.update(world); assert(late.morphTargetInfluences[0] > .1); assert.equal(b.mesh.morphTargetInfluences[0], 0);
mouth.remove(b.group); assert.equal(late.morphTargetInfluences[0], 0);
mouth.start('a', {}, clock, 1.1, envelope); mouth.update(world); assert(a.mesh.morphTargetInfluences[0] > .1);
mouth.end(one); mouth.update(world); assert(a.mesh.morphTargetInfluences[0] > .1, 'overlapping source still speaks');
mouth.clear(); assert.equal(a.mesh.morphTargetInfluences[0], 0);
mouth.start('a', {}, clock, 1.1, envelope); world.players.set('a', avatar()); mouth.update(world);
assert.equal(world.players.get('a').mesh.morphTargetInfluences[0], 0, 'rejoined identity must not inherit old playback');
console.log('Meeting mouth animation passed: bounds, per-speaker audio clocks, silence/suspension/hidden, delayed GLB, overlap, removal/rejoin and reset');
// Streaming analysis shares calibration but owns/disposes only its graph nodes.
world.players.set('a', a); let enabled = true, disconnected = 0, amplitude = .1;
const streamClock = {state:'running',currentTime:0,
 createMediaStreamSource:()=>({connect(){},disconnect(){disconnected++;}}),
 createAnalyser:()=>({fftSize:1024,getFloatTimeDomainData(samples){samples.fill(amplitude);},disconnect(){disconnected++;}})};
const live = {}; mouth.clear();mouth.stream(live,'a',streamClock,{},()=>enabled);
streamClock.currentTime=.1;mouth.update(world);assert(a.mesh.morphTargetInfluences[0]>.1);
const liveNormal=a.mesh.morphTargetInfluences[0];a.group.userData.accountAvatarConfig={mouthGain:2};mouth.update(world);
assert(a.mesh.morphTargetInfluences[0]>=liveNormal);
enabled=false;mouth.update(world);assert.equal(a.mesh.morphTargetInfluences[0],0);
enabled=true;amplitude=0;streamClock.currentTime=.2;mouth.update(world);assert.equal(a.mesh.morphTargetInfluences[0],0);
mouth.end(live);assert.equal(disconnected,2);mouth.clear();assert.equal(disconnected,2);
console.log('Streaming mouths: actual sample energy, calibrated strength, mute/silence and graph cleanup OK');
