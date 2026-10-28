// Uses the production meeting page renderer. HTTP/WS data are fixtures; the
// remaining browser scripts and World/MeetingPlayer constructors run without replacement.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'../public');
const {renderMeetingPage}=require('../src/services/meetingPage');
const {officeGlb}=require('./room-environment-fixtures');
const environmentMode=process.argv.includes('--environment');
const builtinV3Mode=process.argv.includes('--builtin-v3');
const builtinV2Mode=process.argv.includes('--builtin-v2')||builtinV3Mode;
const builtinMode=process.argv.includes('--builtin')||builtinV2Mode;
const screenMode=process.argv.includes('--screen')||builtinV2Mode;
const videoMode=process.argv.includes('--video');
if(videoMode&&!builtinV3Mode)throw Error('--video requires --builtin-v3');
const humanMode=process.argv.includes('--human-avatars');
const {presetConfig,DEFAULT_ID}=require('../src/services/avatarCatalog');
const humanConfig=humanMode?presetConfig(DEFAULT_ID):null;
const bundledFiles=new Map();let builtinSeats=[];
const apiCalls=[];
const {getPrefab}=require('../src/services/worldPrefabs');
const objects=['room','table'].map((kind,i)=>({id:i+1,type:'geometry_building',name:kind,geometry_data:{components:getPrefab(kind).components},position_x:0,position_y:0,position_z:0,scale_x:1,scale_y:1,scale_z:1,has_collision:true}));
objects.push({id:3,type:'uploaded_model',model_type:'gltf',name:'Fixture chair',model_path:'/models/fixture-chair.glb',position_x:2,position_y:0,position_z:0,scale_x:1,scale_y:1,scale_z:1,has_collision:true});
if(environmentMode)objects[0]={id:1,type:'uploaded_model',model_type:'gltf',name:'Office',model_path:'/models/fixture-office.glb',is_room_environment:true,has_collision:false,
 position_x:0,position_y:0,position_z:0,rotation_x:0,rotation_y:.6,rotation_z:0,scale_x:.001,scale_y:.001,scale_z:.001,
 room_environment:{version:1,bounds:{min:{x:-4000,y:0,z:-3000},max:{x:4000,y:3000,z:3000}}}};
const binary=Buffer.alloc(36);[-1,0,0,1,0,0,0,1,0].forEach((v,i)=>binary.writeFloatLE(v,i*4));
let json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],buffers:[{byteLength:36}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,0,0],max:[1,1,0]}]}));
json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+binary.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length,0);binHeader.writeUInt32LE(0x004e4942,4);const chairGlb=Buffer.concat([header,json,binHeader,binary]);
const room={id:'a1000000-0000-4000-8000-000000000001',slug:'fixture',name:'Meeting fixture',status:'open',capacity:6,seating_mode:'seated',spawn_position:{x:0,y:1,z:0}};
if(humanMode)room.avatar_scale=1.4;
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://fixture').pathname;
 if(bundledFiles.has(url)){res.setHeader('Content-Type','model/gltf-binary');res.end(bundledFiles.get(url));return;}
 if(url==='/models/fixture-office.glb'){res.setHeader('Content-Type','model/gltf-binary');res.end(officeGlb({units:1000}));return;}
 if(url==='/models/fixture-chair.glb'){res.setHeader('Content-Type','model/gltf-binary');res.end(chairGlb);return;}
 if(url.startsWith('/api/')){
  apiCalls.push({url,method:req.method});res.setHeader('Content-Type','application/json');
  const data=url==='/api/config/language'?{language:'en-US'}:
    url==='/api/users/character/me'?{character:{id:'me',name:'Fixture',health:100,max_health:100},appearance:{},equipment:[],skills:[]}:
    url==='/api/rooms/fixture'?{success:true,room}:
    url==='/api/rooms/fixture/objects'?{success:true,objects}:
    url==='/api/my/avatar'?{config:humanConfig||{mode:'standard',headType:'sphere',headColor:'#ffaa99',bodyColor:'#4a90e2',headScale:1,headOffset:0,headYaw:0}}:
    {success:false,error:'Legacy API is deliberately unavailable'};
  res.end(JSON.stringify(data));return;
 }
 const file=url==='/play'?path.join(root,'index.html'):path.resolve(root,'.'+url);
 if(!file.startsWith(root+path.sep))throw Error('Invalid path');
 res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');const contents=await fs.readFile(file);res.end(url==='/play'?renderMeetingPage(contents.toString()):contents);
}catch(e){res.statusCode=404;res.end(e.message);}});
let browser;
(async()=>{
 if(builtinMode){
  const bundle=await require('../src/services/roomBuiltinBundle').readBundle(path.resolve(__dirname,'../database/seeds/meeting-six-'+(builtinV3Mode?'v3':builtinV2Mode?'v2':'v1')));
  if(builtinV3Mode)room.avatar_scale=bundle.manifest.avatarScale;
  for(const asset of bundle.assets)bundledFiles.set(asset.runtimePath,asset.data);
  objects.splice(0,objects.length,...bundle.layout.map((item,index)=>{
   const row={id:item.type==='presentation_screen'?100:index+1,type:item.type==='presentation_screen'?item.type:'uploaded_model',model_type:item.model_path?'gltf':null,name:item.name,model_path:item.model_path||null,presentation_screen:item.screen||null,
    has_collision:item.collision,is_room_environment:item.type==='room_environment',room_environment:item.environment||null};
   for(const prefix of ['position','rotation','scale'])for(const axis of ['x','y','z'])row[prefix+'_'+axis]=item[prefix][axis];
   return row;
  }));
  builtinSeats=bundle.layout.flatMap((item,index)=>(item.seats||[]).map(seat=>require('../src/services/roomSeatPose').roomSeatPose(seat,objects[index])));
 }
 if(screenMode&&!builtinV2Mode){
  const item=require('../public/js/roomScreen').create();
  objects.push({id:100,type:item.type,name:item.name,has_collision:false,presentation_screen:item.screen,
   ...Object.fromEntries(['position','rotation','scale'].flatMap(p=>['x','y','z'].map(a=>[p+'_'+a,item[p][a]])))});
 }
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const cache='/root/.cache/ms-playwright';let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();
 try{await fs.access(executable);}catch(_){for(const dir of await fs.readdir(cache))if(dir.startsWith('chromium-')){const file=path.join(cache,dir,'chrome-linux64/chrome');try{await fs.access(file);executable=file;break;}catch(_){}}}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],dialogs=[],scripts=[];page.on('request',req=>{if(req.url().includes('/js/'))scripts.push(req.url());});page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
 await page.addInitScript(config=>{window.fixtureHumanPeer=config;},humanMode?presetConfig('female-neutral-v1'):null);
 await page.addInitScript(seats=>{
  window.fixtureSeats=seats;
  localStorage.setItem('token','fixture-token');localStorage.setItem('userId','user');localStorage.setItem('characterId','me');
  localStorage.setItem('selectedTemplateGlbUrl','/uploads/legacy-missing.glb');localStorage.setItem('selectedTemplateHeight','99');localStorage.setItem('selectedTemplateWeaponConfig','{\"weapon\":\"legacy\"}');
  window.legacyReads=[];const originalGet=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key.startsWith('selectedTemplate'))legacyReads.push(key);return originalGet.call(this,key);};
  window.sent=[];
  class Socket {
   static OPEN=1;static CLOSED=3;readyState=0;
   constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.({});},0);}
   send(text){const message=JSON.parse(text);sent.push(message);if(message.type==='PLAYER_JOIN')setTimeout(()=>{
    this.onmessage?.({data:JSON.stringify({type:'ROOM_SEAT_ASSIGNED',payload:{roomId:'a1000000-0000-4000-8000-000000000001',seat:{id:'one',position:{x:0,y:1,z:0},orientation:{x:0,y:0,z:0,w:1},...window.fixtureSeats?.[0]}}})});
    this.onmessage?.({data:JSON.stringify({type:'WORLD_STATE',payload:{players:[{characterId:message.payload.characterId,characterName:'Fixture',position:message.payload.position},{characterId:'peer',characterName:'Peer',position:{x:3,y:1,z:0},avatarConfig:window.fixtureHumanPeer||{mode:'standard',headType:'cube',headColor:'#ffaa99',bodyColor:'#4a90e2',headScale:1,headOffset:0,headYaw:0},seat:{id:'two',position:{x:3,y:1,z:0},orientation:{x:0,y:0,z:0,w:1}},glbUrl:'/legacy-missing.glb',weaponConfig:{type:'sword'},animUrls:{idle:'/legacy-idle.glb'}}],weather:{type:'storm',intensity:100}}})});
   },0);}
   close(){this.readyState=3;}
   addEventListener(){}
  }
  window.WebSocket=Socket;
 },builtinSeats);
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
 await page.waitForFunction(count=>window.gameWorld?.loadedObjects.size===count,objects.length);
 await page.waitForFunction(human => {const data=gameWorld.players.get('peer')?.group.userData;return human?data?.accountAvatarConfig?.builtinId==='female-neutral-v1'&&data?.roomSeatRig?.supported:data?.accountAvatarConfig?.headType==='cube';},humanMode);
 assert.equal(await page.evaluate(()=>MeetingRoster.getState().connection),'connected');
 assert.deepEqual(await page.evaluate(()=>MeetingRoster.getState().members.map(p=>p.id).sort()),['me','peer']);
 await page.evaluate(()=>MeetingUI.setMenu(true));await page.locator('#meeting-participants').click();assert.equal(await page.locator('.meeting-member').count(),2);await page.keyboard.press('Escape');

 // The seated first-person camera must follow the scaled head, hide only self,
 // retain the assigned seat and restore the avatar in overview/picker modes.
 const seatBeforeCamera=await page.evaluate(()=>player.position.toArray());
 await page.locator('#meeting-camera-toggle').click();
 await page.waitForFunction(()=>GAME_STATE.cameraMode==='first-person'&&!player.worldObject.visible);
 const cameraCheck=await page.evaluate(()=>{
  const head=player.worldObject.userData.roomSeatRig?.found?.head;
  const expected=head?head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.1*player.worldObject.scale.y,0)):player.position.clone().add(new THREE.Vector3(0,.85*player.worldObject.scale.y,0));
  return {distance:gameWorld.camera.position.distanceTo(expected),peer:gameWorld.players.get('peer').group.visible,seat:player.position.toArray()};
 });
 assert(cameraCheck.distance<.02,JSON.stringify(cameraCheck));assert.equal(cameraCheck.peer,true);assert.deepEqual(cameraCheck.seat,seatBeforeCamera);
 await page.evaluate(()=>RoomSeating.message('ROOM_SEATS_STATE',{roomId:'a1000000-0000-4000-8000-000000000001',version:1,seats:[{id:'one',label:'1',occupancy:'active',character_id:'me',position:{x:0,y:1,z:0},...window.fixtureSeats?.[0]}]}));
 await page.locator('#room-places-toggle').click();await page.waitForFunction(()=>!document.getElementById('room-seat-picker').hidden&&player.worldObject.visible);
 if(process.env.MEETING_UI_SCREENSHOTS==='1'){await page.waitForTimeout(120);await page.screenshot({path:'/tmp/meeting-seats-live-refinement.png'});}
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!player.worldObject.visible);
 await page.locator('#meeting-camera-toggle').click();await page.waitForFunction(()=>GAME_STATE.cameraMode==='third-person'&&player.worldObject.visible);
 assert.deepEqual(await page.evaluate(()=>player.position.toArray()),seatBeforeCamera);
 console.log('First-person: scaled seated head, hidden self/visible peer, picker restoration, unchanged seat and overview passed');
 assert.equal(await page.evaluate(() => gameWorld.players.get('peer').group.userData.roomSeat?.id), 'two');
 assert.equal(await page.evaluate(()=>gameWorld.generatedBuildings.size),objects.length,'room geometry and uploaded GLB render with the lean script set');
 if(builtinMode){
  const rendered=await page.evaluate(()=>[...gameWorld.generatedBuildings.values()].map(entry=>{
   let meshes=0,textures=0;entry.model.traverse(node=>{if(node.isMesh){meshes++;for(const material of [].concat(node.material||[]))if(material.map)textures++;}});
   return {name:entry.data.name,meshes,textures,scale:entry.model.scale.x,environment:entry.data.is_room_environment===true};
  }));
  assert.equal(rendered.length,screenMode?9:8);assert(rendered.every(entry=>entry.meshes>0));
  assert.equal(rendered.filter(entry=>entry.environment).length,1);
  assert(rendered.some(entry=>entry.textures>0),'the real bundled models retain their textures');
  for(let i=0;i<objects.length;i++)assert.equal(rendered[i].scale,objects[i].scale_x);
  const ownPose=await page.evaluate(()=>({x:player.position.x,y:player.position.y,z:player.position.z}));
  for(const axis of ['x','y','z'])assert(Math.abs(ownPose[axis]-builtinSeats[0].position[axis])<1e-7,'real bundled seat pose is applied');
  console.log('Bundled meeting: office, table, six chairs, textures, authored transforms and seat pose rendered OK');
 }
 if(environmentMode){
  const office=await page.evaluate(()=>{
   const entry=gameWorld.generatedBuildings.get(1);let meshes=0;entry.model.traverse(n=>{if(n.isMesh)meshes++;});
   return {meshes,scale:entry.model.scale.x,yaw:entry.model.rotation.y,geometry:entry.isGeometry,environment:entry.data.is_room_environment,
    shells:[...gameWorld.generatedBuildings.values()].filter(e=>e.data.is_room_shell).length};
  });
  assert.deepEqual(office,{meshes:8,scale:.001,yaw:.6,geometry:false,environment:true,shells:0});
 }
 if(builtinMode&&process.env.MEETING_UI_SCREENSHOTS){
  const locale=await page.evaluate(()=>i18n.currentLocale);await page.evaluate(()=>i18n.setLocaleLocal('ru-RU'));
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'/tmp/meeting-redesign-live-mobile.png'});
  await page.evaluate(()=>MeetingUI.setMenu(true));await page.locator('#meeting-participants').click();await page.screenshot({path:'/tmp/meeting-controls-room-mobile.png'});await page.keyboard.press('Escape');
  await page.evaluate(()=>MeetingUI.setMenu(true));await page.locator('#meeting-sound-settings').click();await page.screenshot({path:'/tmp/meeting-sound-room-mobile.png'});await page.keyboard.press('Escape');
  await page.setViewportSize({width:1280,height:800});await page.screenshot({path:'/tmp/meeting-redesign-live-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.evaluate(l=>i18n.setLocaleLocal(l),locale);
 }
 // Allow delayed legacy initializers to run, then exercise their old shortcuts.
 if(screenMode){
  assert.equal(await page.locator('#meeting-screen-preview').count(),1);
  const before=await page.evaluate(()=>({yaw:MOUSE.targetRotationY,position:player.position.toArray(),collisions:gameWorld.collisionObjects.some(o=>o.id===100)}));
  assert.equal(before.collisions,false);
  await page.evaluate(()=>MeetingUI.setMenu(true));await page.locator('#meeting-screen-preview').click();assert(await page.locator('dialog').isVisible());
  await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('dialog')));
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('dialog'));
  assert.equal(await page.evaluate(()=>document.activeElement.id),'meeting-screen-preview');
  assert.equal(await page.evaluate(()=>MOUSE.targetRotationY),before.yaw);
  assert.deepEqual(await page.evaluate(()=>player.position.toArray()),before.position);
  // Instrument owned resources, including one texture referenced by the front material.
  await page.evaluate(()=>{window.screenDisposals={geometry:0,material:0,texture:0};const model=gameWorld.generatedBuildings.get(100).model;
   model.traverse(n=>{if(n.geometry)n.geometry.addEventListener('dispose',()=>screenDisposals.geometry++);if(n.material){n.material.addEventListener('dispose',()=>screenDisposals.material++);n.material.map?.addEventListener('dispose',()=>screenDisposals.texture++);}});
  });
 }
 await page.waitForTimeout(1700);
 for(const key of ['p','i','v','m'])await page.keyboard.press(key);
 await page.waitForTimeout(150);
 assert.equal(await page.title(),'3DTalks — Meeting room');
 const forbidden=apiCalls.filter(call=>/^\/api\/(federation|world\/ground-config|ui-controls|config\/(seo|lod-enabled|weather)|shop|skills|monsters|inventory|public\/character-templates|model-guard)/.test(call.url));
 assert.deepEqual(forbidden,[],'room startup and RPG shortcuts must not call legacy APIs');
 assert.deepEqual(await page.evaluate(()=>legacyWork),[], 'meeting frames and constructor never execute global-world subsystems');
 assert.equal(await page.evaluate(() => player.constructor.name), 'MeetingPlayer');
 assert.equal(await page.evaluate(() => 'combatState' in player || 'health' in player), false);
 assert.equal(await page.evaluate(() => gameWorld.worker), null);
 assert.deepEqual(await page.evaluate(() => Object.values(gameWorld.objectPools).map(pool => pool.length)), [0,0]);
 assert.deepEqual(await page.evaluate(()=>legacyReads),[],'meeting does not read legacy character settings');
 assert(scripts.every(url=>!/(main\.js|websocket\.js|player\.js|modelCacheDB|model-detector|entitySleepManager|lightPool|preloadSweeper|loadFacing|geometryBatcher|gltfWorkerClient|worldObjectBounds|placeholderField|worldTextureOptimizer|worldLoadingOptimizer|capsuleCollision|OBJLoader|MTLLoader|legacyAvatarSession|federationUI|worldLod|worldGroundSync|skillManager|skillHUD|portalManager|bone-physics|gaussianSplat|buildingManager|skyManager|agentPositionSmoother)/.test(url)),'legacy scripts must not be requested');
 const join=await page.evaluate(()=>sent.find(message=>message.type==='PLAYER_JOIN').payload);assert.deepEqual(Object.keys(join).sort(),['characterId','position','roomSlug','token']);
 assert.deepEqual(dialogs,[],'room startup must not display browser dialogs');assert.deepEqual(errors,[]);
 const state=await page.evaluate(()=>({weather:gameWorld._weather,recognition:!!window.voiceManagerInstance,avatar:player.worldObject.userData.accountAvatarConfig?.builtinId||player.worldObject.userData.accountAvatarConfig?.headType,movementControls:!!document.getElementById('mobile-joystick'),hudSettings:!!window.uiControlManager?.initialized,chat:!!document.getElementById('nearby-chat-input'),mic:!!document.getElementById('skill-voice-btn')}));
 assert.deepEqual(state,{weather:'clear',recognition:false,avatar:humanMode?humanConfig.builtinId:'sphere',movementControls:false,hudSettings:false,chat:true,mic:true});
 // Camera drag works independently of the legacy input handlers.
 const before = await page.evaluate(() => MOUSE.targetRotationY);
 const drag=await page.evaluate(()=>{const top=document.getElementById('meeting-toolbar').getBoundingClientRect().bottom,bottom=document.getElementById('meeting-footer').getBoundingClientRect().top;return {x:90,y:Math.floor((top+bottom)/2),space:bottom-top};});
 assert(drag.space>=80,'meeting retains a usable scene area between its panels');
 await page.mouse.move(drag.x,drag.y);await page.mouse.down();
 await page.mouse.move(drag.x+20,drag.y+10);await page.mouse.move(drag.x+45,drag.y+25);await page.mouse.up();
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
 if(humanMode){
  await page.evaluate(({male,female})=>{
   const entries=fixtureSeats.map((pose,i)=>({characterId:i===0?'me':i===1?'peer':'human-'+i,characterName:'Human '+i,
     position:pose.position,seat:{id:i===0?'one':i===1?'two':'seat-'+i,...pose},avatarConfig:i%2?female:male}));
   WSClient.handleMessage({type:'WORLD_STATE',payload:{players:entries}});
  },{male:humanConfig,female:presetConfig('female-neutral-v1')});
  await page.waitForFunction(()=>gameWorld.players.size===6&&[...gameWorld.players.values()].every(p=>p.group.userData.accountAvatarRoot?.children.length&&p.group.userData.roomSeatRig?.supported));
  assert(await page.evaluate(scale=>[...gameWorld.players.values()].every(({group})=>{group.updateWorldMatrix(true,true);return group.scale.x===scale&&group.userData.roomSeatRig.found.hips.getWorldPosition(new THREE.Vector3()).distanceTo(group.getWorldPosition(new THREE.Vector3()))<1e-6;}),room.avatar_scale),'room snapshot scales every seated participant around its hips');
  const audio=require('./avatar-lab-audio-fixture').wav().toString('base64');
  await page.evaluate(audio=>WSClient.handleMessage({type:'VOICE_MESSAGE',payload:{characterId:'peer',audio,durationMs:3000}}),audio);
  await page.waitForFunction(()=>{let open=false;gameWorld.players.get('peer').group.traverse(n=>{const i=n.morphTargetDictionary?.viseme_aa;if(i!==undefined&&n.morphTargetInfluences[i]>.1)open=true;});return open;});
  assert(await page.evaluate(()=>[...gameWorld.players].filter(([id])=>id!=='peer').every(([,p])=>{let open=false;p.group.traverse(n=>{const i=n.morphTargetDictionary?.viseme_aa;if(i!==undefined&&n.morphTargetInfluences[i]!==0)open=true;});return !open;})));
  await page.waitForFunction(()=>voiceChat.playbackSources.size===0);
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(()=>{
   window.fixtureCameraUpdate=player.updateCamera;
   player.updateCamera=camera=>{
    const center=new THREE.Vector3();for(const seat of fixtureSeats)center.add(new THREE.Vector3(seat.position.x,seat.position.y,seat.position.z));center.divideScalar(fixtureSeats.length);
    camera.position.copy(center).add(new THREE.Vector3(3,2.5,3));camera.lookAt(center.clone().add(new THREE.Vector3(0,.4,0)));
   };
  });
  await page.screenshot({path:'/tmp/meeting-human-avatars.png'});
  await page.evaluate(()=>{player.updateCamera=fixtureCameraUpdate;delete window.fixtureCameraUpdate;});
  console.log('Human meeting: six real built-in models seated in the shipped office, independent mouths and native voice playback OK');
 }
 if(videoMode)await require('./room-video-full-scene-browser').check(page);
 if(screenMode){await page.evaluate(()=>MeetingUI.setMenu(true));await page.locator('#meeting-screen-preview').click();}
 const stoppedFrame = await page.evaluate(() => { MeetingMain.stop(); return gameWorld.frameCount; });
 await page.waitForTimeout(200);
 assert.equal(await page.evaluate(() => gameWorld.frameCount), stoppedFrame, 'stopped startup releases its rendering loop');
 assert.equal(await page.evaluate(() => gameWorld.generatedBuildings.size), 0);
 if(videoMode)assert(await page.evaluate(()=>fixtureVideos.every(v=>!v.getAttribute('src')&&v.paused)),'room exit disposed every video source');
 if(screenMode){
  await page.waitForFunction(()=>!document.querySelector('#meeting-screen-preview,dialog'));
  assert.deepEqual(await page.evaluate(()=>screenDisposals),{geometry:2,material:2,texture:1});
  console.log('Screen meeting: mobile modal/focus, preserved seat/camera, no collisions and single GPU disposal on exit OK');
 }
 assert.deepEqual(errors, []);
 console.log('Complete meeting page: real startup, legacy APIs disabled, RPG shortcuts inert, chat/microphone retained, no dialogs or JS errors OK');
})().catch(e=>{console.error(e);console.error('Requests:',apiCalls);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
