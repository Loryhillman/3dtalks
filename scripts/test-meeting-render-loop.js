const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { console, URL, performance: { now: () => 0, memory: { usedJSHeapSize: 1024, totalJSHeapSize: 4096 } } };
context.window = context;vm.createContext(context);
for (const file of ['lib/three.min.js', 'playerCamera.js', 'player.js', 'meetingPlayer.js', 'meetingFrame.js']) {
  try { vm.runInContext(fs.readFileSync(require.resolve('../public/js/'+file),'utf8'),context); }
  catch (error) { console.error(file, error.message); process.exit(1); }
}
const THREE = context.THREE;
const order = [];
context.RoomSeating = { updateLocal(participant, camera) {
  participant.position.set(2,1,3);participant.updateCamera(camera);
}, renderPoses: () => order.push('seat') };
context.MOUSE = {rotationX:0.1,rotationY:0.4,targetRotationX:0.1,isDragging:true};
context.GAME_STATE = {cameraMode:'third-person'};
const world = { addPlayer:()=>new THREE.Group() };
const participant = new context.MeetingPlayer(world,'me',{character:{name:'Fixture'}});
const camera = new THREE.PerspectiveCamera();
participant.update(16,camera);
assert.deepEqual(Array.from(participant.position.toArray()),[2,1,3]);
assert.equal('combatState' in participant,false);assert.equal('velocity' in participant,false);
// Legacy and meeting controllers must use the same orbit and first-person camera.
const legacy = Object.create(context.Player.prototype);
legacy.position=participant.position.clone();legacy.worldObject=new THREE.Group();
for(const mode of ['third-person','first-person']){
 context.GAME_STATE.cameraMode=mode;
 const legacyCamera=new THREE.PerspectiveCamera(),meetingCamera=new THREE.PerspectiveCamera();
 legacy.updateCamera(legacyCamera);participant.updateCamera(meetingCamera);
 assert.deepEqual(legacyCamera.position.toArray(),meetingCamera.position.toArray());
 assert.deepEqual(legacyCamera.quaternion.toArray(),meetingCamera.quaternion.toArray());
 assert.equal(legacy.worldObject.visible,participant.worldObject.visible);
}
const mixer = {update:dt=>{assert.equal(dt,0.016);order.push('mixer');}};
const frameWorld = {players:new Map([['me',{group:{userData:{glbMixer:mixer,sharedMixer:mixer}}}]]),
 generatedBuildings:new Map([[1,{}],[2,{}]]),loadedObjects:new Set([1,2]),frameCount:89,lastFPSCheck:0,
 performanceMonitor:{lastFrameTime:0},renderer:{render:()=>order.push('render')}};
context.MeetingFrame.update(frameWorld,16,1500);
assert.deepEqual(order,['mixer','seat','render'],'shared mixer updates once and seating is applied before render');
assert.equal(frameWorld.currentFPS,60,'FPS uses elapsed time rather than assuming exactly one second');
assert.equal(frameWorld.performanceMonitor.objects.total,2);
assert.equal(frameWorld.performanceMonitor.objects.visible,2);
console.log('Meeting rendering: seated controller, shared orbit/first-person camera, pose order and accurate FPS/object statistics OK');
