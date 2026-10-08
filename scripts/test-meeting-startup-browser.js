// Uses the production meeting page renderer. HTTP/WS data are fixtures; the
// remaining browser scripts and World/MeetingPlayer constructors run without replacement.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'../public');
const {renderMeetingPage}=require('../src/services/meetingPage');
const apiCalls=[];
const {getPrefab}=require('../src/services/worldPrefabs');
const objects=['room','table'].map((kind,i)=>({id:i+1,type:'geometry_building',name:kind,geometry_data:{components:getPrefab(kind).components},position_x:0,position_y:0,position_z:0,scale_x:1,scale_y:1,scale_z:1,has_collision:true}));
objects.push({id:3,type:'uploaded_model',model_type:'gltf',name:'Fixture chair',model_path:'/models/fixture-chair.glb',position_x:2,position_y:0,position_z:0,scale_x:1,scale_y:1,scale_z:1,has_collision:true});
const binary=Buffer.alloc(36);[-1,0,0,1,0,0,0,1,0].forEach((v,i)=>binary.writeFloatLE(v,i*4));
let json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,1,0]}]}));
json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);const chairGlb=Buffer.concat([header,json,binHeader,binary]);
const room={id:'fixture-room',slug:'fixture',name:'Meeting fixture',status:'open',capacity:6,seating_mode:'seated',spawn_position:{x:0,y:1,z:0}};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://fixture').pathname;
 if(url==='/models/fixture-chair.glb'){res.setHeader('Content-Type','model/gltf-binary');res.end(chairGlb);return;}
 if(url.startsWith('/api/')){
  apiCalls.push({url,method:req.method});res.setHeader('Content-Type','application/json');
  const data=url==='/api/config/language'?{language:'en-US'}:
    url==='/api/users/character/me'?{character:{id:'me',name:'Fixture',health:100,max_health:100},appearance:{},equipment:[],skills:[]}:
    url==='/api/rooms/fixture'?{success:true,room}:
    url==='/api/rooms/fixture/objects'?{success:true,objects}:
    url==='/api/my/avatar'?{config:{mode:'standard',headType:'sphere',headColor:'#ffaa99',bodyColor:'#4a90e2',headScale:1,headOffset:0,headYaw:0}}:
    {success:false,error:'Legacy API is deliberately unavailable'};
  res.end(JSON.stringify(data));return;
 }
 const file=url==='/play'?path.join(root,'index.html'):path.resolve(root,'.'+url);
 if(!file.startsWith(root+path.sep))throw Error('Invalid path');
 res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html'})[path.extname(file)]||'application/octet-stream');const contents=await fs.readFile(file);res.end(url==='/play'?renderMeetingPage(contents.toString()):contents);
}catch(e){res.statusCode=404;res.end(e.message);}});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const cache='/root/.cache/ms-playwright';let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();
 try{await fs.access(executable);}catch(_){for(const dir of await fs.readdir(cache))if(dir.startsWith('chromium-')){const file=path.join(cache,dir,'chrome-linux64/chrome');try{await fs.access(file);executable=file;break;}catch(_){}}}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],dialogs=[],scripts=[];page.on('request',req=>{if(req.url().includes('/js/'))scripts.push(req.url());});page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
 await page.addInitScript(()=>{
  localStorage.setItem('token','fixture-token');localStorage.setItem('userId','user');localStorage.setItem('characterId','me');
  localStorage.setItem('selectedTemplateGlbUrl','/uploads/legacy-missing.glb');localStorage.setItem('selectedTemplateHeight','99');localStorage.setItem('selectedTemplateWeaponConfig','{\"weapon\":\"legacy\"}');
  window.legacyReads=[];const originalGet=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key.startsWith('selectedTemplate'))legacyReads.push(key);return originalGet.call(this,key);};
  window.sent=[];
  class Socket {
   static OPEN=1;static CLOSED=3;readyState=0;
   constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.({});},0);}
   send(text){const message=JSON.parse(text);sent.push(message);if(message.type==='PLAYER_JOIN')setTimeout(()=>{
    this.onmessage?.({data:JSON.stringify({type:'ROOM_SEAT_ASSIGNED',payload:{roomId:'fixture-room',seat:{id:'one',position:{x:0,y:1,z:0},orientation:{x:0,y:0,z:0,w:1}}}})});
    this.onmessage?.({data:JSON.stringify({type:'WORLD_STATE',payload:{players:[],weather:{type:'storm',intensity:100}}})});
   },0);}
   close(){this.readyState=3;}
   addEventListener(){}
  }
  window.WebSocket=Socket;
 });
 await page.addInitScript(() => {
  window.legacyWork = [];
  document.addEventListener('DOMContentLoaded', () => {
   for (const name of ['initWorker', 'initObjectPools', 'preloadCoreResources', 'updateObjectLoading',
    'updateLOD', 'updateFrustumCulling', 'optimizeGeometryProcessing', 'cleanupMemory', 'adjustLoadStrategy',
    'updateParticles', 'updatePortals', '_updateWeatherParticles', '_updateDebugPanel']) {
    const original = World.prototype[name];
    World.prototype[name] = function (...args) { legacyWork.push(name); return original.apply(this, args); };
   }
  });
 });
 await page.goto('http://127.0.0.1:' +server.address().port+'/play?room=fixture');
 await page.waitForFunction(()=>window.gameWorld&&window.RoomSeating?.active&&window.sent?.some(m=>m.type==='PLAYER_JOIN'),{timeout:15000});
 await page.waitForFunction(()=>window.gameWorld?.loadedObjects.has(3));
 assert.equal(await page.evaluate(()=>gameWorld.generatedBuildings.size),3,'room geometry and uploaded GLB render with the lean script set');
 // Allow delayed legacy initializers to run, then exercise their old shortcuts.
 await page.waitForTimeout(1700);
 for(const key of ['p','i','v','m'])await page.keyboard.press(key);
 await page.waitForTimeout(150);
 const forbidden=apiCalls.filter(call=>/^\/api\/(federation|world\/ground-config|ui-controls|config\/(lod-enabled|weather)|shop|skills|monsters|inventory|public\/character-templates|model-guard)/.test(call.url));
 assert.deepEqual(forbidden,[],'room startup and RPG shortcuts must not call legacy APIs');
 assert.deepEqual(await page.evaluate(()=>legacyWork),[], 'meeting frames and constructor never execute global-world subsystems');
 assert.equal(await page.evaluate(() => player.constructor.name), 'MeetingPlayer');
 assert.equal(await page.evaluate(() => 'combatState' in player || 'health' in player), false);
 assert.equal(await page.evaluate(() => gameWorld.worker), null);
 assert.deepEqual(await page.evaluate(() => Object.values(gameWorld.objectPools).map(pool => pool.length)), [0,0]);
 assert.deepEqual(await page.evaluate(()=>legacyReads),[],'meeting does not read legacy character settings');
 assert(scripts.every(url=>!/(main\.js|player\.js|modelCacheDB|model-detector|entitySleepManager|lightPool|preloadSweeper|loadFacing|geometryBatcher|gltfWorkerClient|worldObjectBounds|placeholderField|worldTextureOptimizer|worldLoadingOptimizer|capsuleCollision|OBJLoader|MTLLoader|legacyAvatarSession|federationUI|worldLod|worldGroundSync|skillManager|skillHUD|portalManager|bone-physics|gaussianSplat|buildingManager|skyManager|agentPositionSmoother)/.test(url)),'legacy scripts must not be requested');
 const join=await page.evaluate(()=>sent.find(message=>message.type==='PLAYER_JOIN').payload);assert.deepEqual(Object.keys(join).sort(),['characterId','position','roomSlug','token']);
 assert.deepEqual(dialogs,[],'room startup must not display browser dialogs');assert.deepEqual(errors,[]);
 const state=await page.evaluate(()=>({weather:gameWorld._weather,recognition:!!window.voiceManagerInstance,avatar:player.worldObject.userData.accountAvatarConfig?.headType,movementControls:!!document.getElementById('mobile-joystick'),hudSettings:!!window.uiControlManager?.initialized,chat:!!document.getElementById('nearby-chat-input'),mic:!!document.getElementById('skill-voice-btn')}));
 assert.deepEqual(state,{weather:'clear',recognition:false,avatar:'sphere',movementControls:false,hudSettings:false,chat:true,mic:true});
 // Camera drag works independently of the legacy input handlers.
 const before = await page.evaluate(() => MOUSE.targetRotationY);
 await page.mouse.move(180, 300);await page.mouse.down();
 await page.mouse.move(200, 315);await page.mouse.move(225, 330);await page.mouse.up();
 assert.notEqual(await page.evaluate(() => MOUSE.targetRotationY), before);
 assert.equal(await page.evaluate(() => MOUSE.isDragging), false);
 // Touch must rotate the view without invoking inherited attack animation.
 const touch = await page.evaluate(() => {
  let attacks = 0;gameWorld.triggerAttackAnimation = () => attacks++;
  const canvas = document.getElementById('canvas'), before = MOUSE.targetRotationY;
  // Synthetic pointers cannot be captured; the real mouse path above checks capture.
  const capture = canvas.setPointerCapture;canvas.setPointerCapture = () => {};
  for (const [type, x] of [['pointerdown', 120], ['pointermove', 145], ['pointerup', 145]]) {
   canvas.dispatchEvent(new PointerEvent(type, {pointerId:42,pointerType:'touch',isPrimary:true,clientX:x,clientY:250,bubbles:true}));
  }
  canvas.setPointerCapture = capture;
  return {rotated:MOUSE.targetRotationY!==before,dragging:MOUSE.isDragging,attacks};
 });
 assert.deepEqual(touch,{rotated:true,dragging:false,attacks:0});
 await page.keyboard.down('w');
 assert.equal(await page.evaluate(() => KEYS.w), false, 'meetings do not activate free movement');
 await page.keyboard.up('w');
 const stoppedFrame = await page.evaluate(() => { MeetingMain.stop(); return gameWorld.frameCount; });
 await page.waitForTimeout(200);
 assert.equal(await page.evaluate(() => gameWorld.frameCount), stoppedFrame, 'stopped startup releases its rendering loop');
 assert.equal(await page.evaluate(() => gameWorld.generatedBuildings.size), 0);
 assert.deepEqual(errors, []);
 console.log('Complete meeting page: real startup, legacy APIs disabled, RPG shortcuts inert, chat/microphone retained, no dialogs or JS errors OK');
})().catch(e=>{console.error(e);console.error('Requests:',apiCalls);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
