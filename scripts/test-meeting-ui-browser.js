/** Real meeting HUD components and page markup; isolated transport and microphone stubs. */
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'../public');
const setup=`window.GAME_STATE={characterId:'me',characterName:'Fixture'};window.sent=[];window.WSClient={connected:true,ws:{readyState:1},isConnected:()=>true,send:m=>sent.push(m)};window.voiceChat={startTalk:()=>window.talkStarted=(window.talkStarted||0)+1,stopTalk:()=>window.talkStopped=(window.talkStopped||0)+1};`;
const boot=`window.addEventListener('DOMContentLoaded',async()=>{await i18n.init();if(location.pathname!='/play')return;const room={id:'fixture',name:'Long meeting name / Очень длинное название переговорной комнаты для проверки интерфейса',capacity:6,seating_mode:'seated'};window.gameWorld={players:new Map([['me',{group:new THREE.Group()}]])};RoomSeating.enter(room);RoomSeating.message('ROOM_SEAT_ASSIGNED',{roomId:room.id,seat:{id:'one',position:{x:0,y:1,z:0},orientation:{x:0,y:0,z:0,w:1}}});RoomSeating.sceneReady();RoomSeating.message('ROOM_SEATS_STATE',{roomId:room.id,version:1,seats:Array.from({length:20},(_,i)=>({id:i?'seat-'+i:'one',label:String(i+1),occupancy:i?'free':'active',character_id:i?null:'me',position:{x:i%4,y:1,z:Math.floor(i/4)}}))});});`;
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://local').pathname;
 if(url==='/api/config/language'){res.setHeader('Content-Type','application/json');return res.end('{"language":"en-US"}');}
 if(url==='/play'||url==='/__legacy'){
  let html=await fs.readFile(path.join(root,'index.html'),'utf8');
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
  html=html.replace('</head>','<script src="/js/meetingUI.js"></script></head>');
  const scripts=['i18n/i18n.js','js/lib/three.min.js','js/ui.js','js/roomSeatLabels.js','js/roomSeating.js','js/skillHUD.js','js/nearbyChat.js'].map(s=>'<script src="/'+s+'"></script>').join('');
  html=html.replace('</body>','<script>'+setup+'</script>'+scripts+'<script>'+boot+'</script></body>');
  res.setHeader('Content-Type','text/html');return res.end(html);
 }
 const file=path.resolve(root,'.'+url);if(!file.startsWith(root+path.sep))throw new Error('Invalid path');
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html');res.end(await fs.readFile(file));
}catch(error){res.writeHead(404);res.end(error.message);}});
async function executable(){if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;const cache=path.join(require('node:os').homedir(),'.cache/ms-playwright');const paths=[chromium.executablePath()];try{for(const dir of await fs.readdir(cache))if(/^chromium-\d+$/.test(dir))paths.push(path.join(cache,dir,'chrome-linux64/chrome'));}catch(_){}for(const p of paths){try{await fs.access(p);return p;}catch(_){}}throw new Error('Install Chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE');}
let browser;
(async()=>{try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({executablePath:await executable(),headless:true,args:['--no-sandbox']});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/play?room=fixture');
 await page.waitForFunction(()=>document.getElementById('meeting-toolbar')&&document.getElementById('skill-voice-btn')?.parentElement.id==='meeting-footer'&&document.getElementById('nearby-chat-wrap')?.parentElement.id==='meeting-footer');
 assert.equal(await page.locator('#skill-hud').count(),0,'meeting does not create RPG skill slots');
 const hidden=['health-bar','monster-head-hud','minimap','btn-profile','btn-inventory','controls-hint','debug-panel','world-portal-btn','inventory-page','profile-page'];
 for(const id of hidden)assert.equal(await page.locator('#'+id).isVisible(),false,id+' should be hidden');
 await page.evaluate(()=>{for(const id of ['mobile-jump-btn','mobile-joystick','performance-monitor']){const node=document.createElement('div');node.id=id;node.style.display='block';document.body.append(node);}document.getElementById('skill-voice-btn').style.cssText='position:fixed!important;top:5px;left:5px;bottom:24px';});
 for(const id of ['mobile-jump-btn','mobile-joystick','performance-monitor'])assert.equal(await page.locator('#'+id).isVisible(),false);
 // Inline changes from control settings must not break the meeting layout.
 await page.evaluate(()=>{document.getElementById('skill-voice-btn').style.position='fixed';});
 for(const locale of ['en-US','ru-RU']) {
 await page.evaluate(locale=>i18n.setLocaleLocal(locale),locale);
 for(const [width,height] of [[1366,768],[768,1024],[390,844],[320,568],[568,320]]){
  await page.setViewportSize({width,height});
  await page.locator('#room-places-toggle').click();
  await page.waitForFunction(()=>!document.getElementById('room-seat-picker').hidden);
  // ResizeObserver adjusts panel boundaries after wrapping toolbar labels.
  await page.waitForFunction(()=>{const bar=document.getElementById('meeting-toolbar').getBoundingClientRect();return Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--meeting-top-edge'))-Math.ceil(bar.bottom+10))<1;});
  const boxes=await page.evaluate(()=>{const ids=['meeting-toolbar','meeting-footer','room-seat-picker','nearby-chat-wrap','skill-voice-btn'];return Object.fromEntries(ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[id,{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}];}));});
  for(const [id,r] of Object.entries(boxes)){assert(r.x>=-1&&r.right<=width+1&&r.y>=-1&&r.bottom<=height+1,`${width}x${height} ${id} stays on screen: ${JSON.stringify(r)}`);}
  assert(boxes['meeting-toolbar'].bottom<=boxes['room-seat-picker'].y,`${width}x${height} header/picker overlap`);
  assert(boxes['room-seat-picker'].bottom<=boxes['meeting-footer'].y,`${width}x${height} picker/footer overlap`);
  const a=boxes['nearby-chat-wrap'],b=boxes['skill-voice-btn'];assert(a.right<=b.x||b.right<=a.x,'chat and microphone do not overlap');
  assert.equal(await page.locator('#nearby-chat-input').isVisible(),true);
  await page.keyboard.press('Escape');
 }
 }
 await page.locator('#nearby-chat-input').fill('Meeting message');await page.locator('#nearby-chat-send').click();
 assert.equal(await page.evaluate(()=>sent.at(-1).type),'CHAT');
 await page.locator('#skill-voice-btn').hover();await page.mouse.down();await page.mouse.up();
 assert.equal(await page.evaluate(()=>talkStarted),1);assert.equal(await page.evaluate(()=>talkStopped),1);
 await page.locator('#room-places-toggle').click();await page.locator('.room-seat-inspect').nth(1).click();await page.locator('.room-seat-row.selected .room-seat-take').click();
 assert.equal(await page.evaluate(()=>sent.at(-1).type),'ROOM_SEAT_SELECT');
 await page.goto(base+'/__legacy');await page.waitForSelector('#skill-hud');
 assert.equal(await page.locator('#health-bar').isVisible(),true,'legacy world keeps its UI');assert.equal(await page.locator('#skill-hud .skill-slot').count(),5);
 assert.deepEqual(errors,[]);
 console.log('Chromium meeting HUD: RPG removal, desktop/mobile/landscape bounds, non-overlapping panels, retained chat/PTT/seating handlers and legacy UI: OK (isolated transport stubs)');
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
