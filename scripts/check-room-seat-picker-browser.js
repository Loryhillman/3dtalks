// Browser-only fixture: real Three.js renderer and UI, synthetic room/socket state. No database writes.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1360,height:900}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/__seat-picker-check',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head></head><body style="margin:0;overflow:hidden"><script src="/js/lib/three.min.js?v=185"></script><script src="/js/roomSeatLabels.js"></script><script src="/js/roomSeating.js"></script></body></html>`}));
    await page.goto('http://127.0.0.1:3002/__seat-picker-check');
    await page.evaluate(()=>{
      window.GAME_STATE={characterId:'me'};window.MOUSE={};window.sent=[];
      window.WSClient={connected:true,ws:{readyState:1},send:m=>sent.push(m)};
      const scene=new THREE.Scene();scene.background=new THREE.Color('#d1dfeb');
      const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,.1,1000),renderer=new THREE.WebGLRenderer({antialias:true});
      renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xffffff,0x667788,2));
      function box(w,h,d,x,y,z,color){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color}));mesh.position.set(x,y,z);scene.add(mesh);}
      box(24,.2,20,0,-.1,0,'#b9a18b');box(24,8,.2,0,4,-10,'#eee5db');box(24,8,.2,0,4,10,'#eee5db');box(.2,8,20,-12,4,0,'#eee5db');box(.2,8,20,12,4,0,'#eee5db');box(24,.2,20,0,8.1,0,'#eee5db');box(5,.2,2,0,.9,0,'#855e39');
      const group=new THREE.Group();scene.add(group);
      window.gameWorld={scene,camera,renderer,players:new Map([['me',{group}]])};
      const identity={x:0,y:0,z:0,w:1};
      window.testSeats=Array.from({length:6},(_,i)=>({id:'seat-'+i,label:String(i+1),position:{x:(i%3-1)*2,y:1,z:i<3?-2:2},orientation:identity,occupancy:i===0?'active':i===2?'held':'free',character_id:i===0?'me':i===2?'other':null,character_name:i===2?'Гость':null}));
      for(const s of testSeats){box(.8,.2,.8,s.position.x,.6,s.position.z,'#263f58');box(.8,1,.15,s.position.x,1.1,s.position.z-.4,'#263f58');}
      RoomSeating.enter({id:'test-room',seating_mode:'seated',capacity:6});
      RoomSeating.message('ROOM_SEAT_ASSIGNED',{roomId:'test-room',seat:testSeats[0]});RoomSeating.sceneReady();
      RoomSeating.message('ROOM_SEATS_STATE',{roomId:'test-room',version:1,seats:testSeats});
      const player={characterId:'me',position:new THREE.Vector3(),updateCamera(c){c.position.set(6,4,6);c.lookAt(0,1,0);}};
      function frame(){RoomSeating.updateLocal(player,camera);RoomSeating.renderPoses(gameWorld);renderer.render(scene,camera);requestAnimationFrame(frame);}frame();
      addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
    });
    await page.locator('#room-places-toggle').click();
    assert(await page.locator('#room-seat-picker').isVisible());
    assert.equal(await page.locator('dialog[open]').count(),0);
    await page.waitForFunction(()=>document.querySelectorAll('.room-seat-labels button:not([hidden])').length>=5);
    const panelBox=await page.locator('#room-seat-picker').boundingBox();assert(panelBox.width<1360*.3);
    const original=await page.evaluate(()=>gameWorld.players.get('me').group.position.toArray());
    await page.locator('#room-seat-list [data-seat-id="seat-1"] .room-seat-inspect').click();
    assert.equal(await page.evaluate(()=>sent.filter(m=>m.type==='ROOM_SEAT_SELECT').length),0);
    assert.deepEqual(await page.evaluate(()=>gameWorld.players.get('me').group.position.toArray()),original);
    // A server snapshot between pointer-down and pointer-up must not swallow the click.
    const nextButton=page.locator('#room-seat-list [data-seat-id="seat-4"] .room-seat-inspect');
    const box=await nextButton.boundingBox();await page.mouse.move(box.x+20,box.y+15);await page.mouse.down();
    await page.evaluate(()=>RoomSeating.message('ROOM_SEATS_STATE',{roomId:'test-room',version:2,seats:testSeats}));
    await page.mouse.up();assert.equal(await page.locator('#room-seat-list .selected').getAttribute('data-seat-id'),'seat-4');
    for(const id of ['seat-4','seat-0','seat-5','seat-1']){
      await page.locator('#room-seat-list [data-seat-id="'+id+'"] .room-seat-inspect').click();
      assert.equal(await page.locator('#room-seat-list .selected').getAttribute('data-seat-id'),id);
    }
    // Broken/expensive imported mesh raycasts must never delay the action panel.
    const immediate=await page.evaluate(()=>{
      const obstacle=new THREE.Mesh(new THREE.BoxGeometry(20,20,.2),new THREE.MeshBasicMaterial());
      obstacle.position.z=-1;gameWorld.scene.add(obstacle);
      gameWorld.generatedBuildings=new Map([['shell',{model:obstacle,data:{is_room_shell:true}}]]);
      let calls=0;
      gameWorld.scene.traverse(node=>{if(node.isMesh)node.raycast=()=>{calls++;throw new Error('Imported mesh raycast must not run');};});
      const selected=[];
      for(const id of ['seat-4','seat-1']){
        document.querySelector('#room-seat-list [data-seat-id="'+id+'"] .room-seat-inspect').click();
        selected.push(document.querySelector('#room-seat-list .selected').dataset.seatId);
        if(document.querySelector('#room-seat-list [data-seat-id="'+id+'"] .room-seat-take').hidden)throw new Error('Action not updated synchronously');
      }
      RoomSeating.updateLocal({characterId:'me',position:new THREE.Vector3()},gameWorld.camera);
      return {calls,selected,z:gameWorld.camera.position.z};
    });
    assert.equal(immediate.calls,0);
    assert.deepEqual(immediate.selected,['seat-4','seat-1']);
    assert(immediate.z<-1.1,'Inspection camera must remain in front of the shell wall');
    await page.screenshot({path:'/tmp/room-seat-picker-desktop.png'});
    // Occupancy can change during inspection; the action must become unavailable.
    await page.evaluate(()=>{testSeats[1].occupancy='active';testSeats[1].character_id='other';RoomSeating.message('ROOM_SEATS_STATE',{roomId:'test-room',version:3,seats:testSeats});});
    assert(await page.locator('#room-seat-list [data-seat-id="seat-1"] .room-seat-take').isDisabled());
    await page.evaluate(()=>{testSeats[1].occupancy='free';testSeats[1].character_id=null;RoomSeating.message('ROOM_SEATS_STATE',{roomId:'test-room',version:4,seats:testSeats});});
    await page.locator('#room-seat-list [data-seat-id="seat-1"] .room-seat-take').click();
    assert.equal(await page.evaluate(()=>sent.filter(m=>m.type==='ROOM_SEAT_SELECT').length),1);
    assert(await page.locator('#room-seat-list [data-seat-id="seat-1"] .room-seat-take').isDisabled());
    await page.evaluate(()=>RoomSeating.message('ROOM_SEAT_RESULT',{requestId:sent.find(m=>m.type==='ROOM_SEAT_SELECT').payload.requestId,success:false}));
    assert(await page.locator('#room-seat-picker').isVisible());
    assert.deepEqual(await page.evaluate(()=>gameWorld.players.get('me').group.position.toArray()),original);
    await page.locator('#room-seat-list [data-seat-id="seat-1"] .room-seat-take').click();
    await page.evaluate(()=>{RoomSeating.message('ROOM_SEAT_CHANGED',{roomId:'test-room',characterId:'me',seat:testSeats[1]});RoomSeating.message('ROOM_SEAT_RESULT',{requestId:sent.filter(m=>m.type==='ROOM_SEAT_SELECT').at(-1).payload.requestId,success:true});});
    assert(!(await page.locator('#room-seat-picker').isVisible()));
    await page.setViewportSize({width:390,height:844});await page.locator('#room-places-toggle').click();
    const mobile=await page.locator('#room-seat-picker').boundingBox();assert(mobile.height<844*.4);assert(mobile.y>844*.55);
    await page.screenshot({path:'/tmp/room-seat-picker-mobile.png'});
    await page.keyboard.press('Escape');assert(!(await page.locator('#room-seat-picker').isVisible()));
    await page.locator('#room-places-toggle').click();await page.evaluate(()=>RoomSeating.disconnected());
    assert(!(await page.locator('#room-seat-picker').isVisible()));assert(await page.locator('.room-seat-labels').isHidden());
    assert.deepEqual(errors,[]);
    console.log('Seat picker browser: visible room, projected labels, inspect without moving, occupancy updates, explicit selection, rejection, success, mobile layout and disconnect cleanup: OK');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
