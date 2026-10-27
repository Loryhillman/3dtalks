const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright');
async function check({app,base,roomId,actors,clip}){
 const root=path.resolve(__dirname,'../public');
 app.get('/play',(_req,res)=>res.send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><html class="meeting-session"><head>
 <link rel="stylesheet" href="/css/meeting.css"><link rel="stylesheet" href="/css/room-presentation.css"><link rel="stylesheet" href="/css/room-materials.css"><link rel="stylesheet" href="/css/room-screen-preview.css"></head><body>
 <div id="meeting-toolbar"><div class="meeting-actions"><button>Exit</button></div></div>
 ${['i18n/i18n.js','js/lib/three.min.js','js/roomScreen.js','js/roomScreenPreview.js','js/roomScreenRenderer.js','js/roomMediaRenderer.js','js/roomPresentationProtocol.js','js/roomMediaContract.js','js/roomPresentationProtocolV2.js','js/roomVideoTimeline.js','js/roomVideoClock.js','js/roomVideoPlayback.js','js/roomMaterials.js','js/roomPresentation.js','js/socketClient.js','js/meetingSocket.js'].map(src=>'<script src="/'+src+'"></script>').join('')}
 <script>(async()=>{await i18n.init();window.ACTIVE_ROOM={id:'${roomId}',slug:'${roomId}',name:'Видеопереговорная'};window.GAME_STATE={characterId:localStorage.getItem('characterId')};window.CONFIG={WS_URL:location.origin.replace('http','ws')};window.UI={addChatMessage(){}};
 window.gameWorld={players:new Map(),addPlayer(id,name,position){this.players.set(id,{name,group:new THREE.Group()});},removePlayer(id){this.players.delete(id);},updatePlayerName(){}};
 window.RoomSeating={connecting(){},disconnected(){},message(){}};
 window.screenModel=RoomScreenRenderer.create(RoomScreen.create().screen);const canvas=screenModel.userData.screenCanvas;canvas.style.cssText='width:min(650px,95vw);margin-top:430px';document.body.append(canvas);
 RoomScreenPreview.mount(canvas,'Экран',document.querySelector('.meeting-actions'));RoomPresentation.attach(screenModel.userData.presentation);
 window.messages=[];const handler=WSClient.handleMessage.bind(WSClient);WSClient.handleMessage=m=>{messages.push(m);handler(m);};
 await WSClient.connect(CONFIG.WS_URL);window.sent=[];const send=WSClient.ws.send.bind(WSClient.ws);WSClient.ws.send=text=>{sent.push(JSON.parse(text));send(text);};WSClient.send({type:'PLAYER_JOIN',payload:{roomSlug:ACTIVE_ROOM.slug,characterId:GAME_STATE.characterId,token:localStorage.getItem('token')}});
 })().catch(e=>{throw e;});</script></body></html>`));
 app.use(require('express').static(root));
 let executable=chromium.executablePath();try{await fs.access(executable);}catch(_){for(const name of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(name))executable='/root/.cache/ms-playwright/'+name+'/chrome-linux64/chrome';}
 const browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const errors=[];
 try{
  async function pageFor(actor,blocked=false){const context=await browser.newContext({viewport:{width:1280,height:900}});await context.addInitScript(({actor,blocked})=>{
   localStorage.setItem('token',actor.token);localStorage.setItem('characterId',actor.character);localStorage.setItem('preferredLocale','ru-RU');window.nativeVideos=[];window.forceVideoBlock=blocked;
   const create=document.createElement.bind(document);document.createElement=(name,...args)=>{const n=create(name,...args);if(name.toLowerCase()==='video')nativeVideos.push(n);return n;};
   const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){if(forceVideoBlock&&this.src.includes('/presentation/'))return Promise.reject(new DOMException('Blocked fixture','NotAllowedError'));return play.call(this);};
  },{actor,blocked});const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/play');await page.waitForFunction(()=>window.messages?.some(m=>m.type==='ROOM_PRESENTATION_CAPABILITIES_RESULT'));return page;}
  const owner=await pageFor(actors[0]),viewer=await pageFor(actors[1],true);
  await owner.evaluate(()=>RoomMaterials.open(ACTIVE_ROOM));
  await owner.waitForFunction(()=>document.getElementById('material-file')?.accept.includes('.mp4'));
  await owner.locator('#material-file').setInputFiles({name:'UI uploaded video.mp4',mimeType:'video/mp4',buffer:clip});
  await owner.waitForFunction(()=>[...document.querySelectorAll('.material-row')].some(n=>n.textContent.includes('UI uploaded video.mp4')&&n.textContent.includes('Готов')));
  const row=owner.locator('.material-row').filter({hasText:'UI uploaded video.mp4'});await row.getByRole('button',{name:'Предпросмотр',exact:true}).click();
  await owner.waitForFunction(()=>document.querySelector('.material-video')?.readyState>=1);
  await owner.locator('.material-close').click();await owner.waitForFunction(()=>nativeVideos.every(v=>!v.getAttribute('src')));
  await owner.locator('#presentation-manage').click();await owner.waitForFunction(()=>document.querySelector('#presentation-material')?.options.length>=2);
  const value=await owner.locator('#presentation-material option').filter({hasText:'UI uploaded video.mp4'}).getAttribute('value');await owner.locator('#presentation-material').selectOption(value);await owner.locator('[data-command=show]').click();
  await owner.waitForFunction(()=>!document.querySelector('.presentation-video-commands').hidden);
  await owner.locator('[data-command=video-play]').click();
  await viewer.waitForFunction(()=>!document.querySelector('.presentation-video-local button').hidden);
  await viewer.evaluate(()=>forceVideoBlock=false);await viewer.getByRole('button',{name:'Включить видео и звук'}).click();
  const playing=async page=>{try{await page.waitForFunction(()=>nativeVideos.some(v=>v.currentSrc.includes('/presentation/')&&!v.paused&&v.currentTime>.2));}catch(e){console.error(await page.evaluate(()=>({videos:nativeVideos.map(v=>({src:!!v.getAttribute('src'),time:v.currentTime,paused:v.paused,error:v.error?.code,ready:v.readyState})),status:document.querySelector('.presentation-video-local')?.textContent,states:messages.filter(m=>['ROOM_PRESENTATION_STATE','ROOM_PRESENTATION_RESULT'].includes(m.type)).slice(-4)})));throw e;}};await Promise.all([playing(owner),playing(viewer)]);
  const frame=await viewer.evaluate(()=>{const c=screenModel.userData.screenCanvas,ctx=c.getContext('2d');return [...ctx.getImageData(c.width/2,c.height/2,1,1).data];});assert(frame[2]>frame[0]+50,JSON.stringify(frame));
  await owner.locator('[data-command=video-play]').click();await Promise.all([owner,viewer].map(p=>p.waitForFunction(()=>nativeVideos.filter(v=>v.currentSrc.includes('/presentation/')).every(v=>v.paused))));
  await owner.locator('.presentation-video-commands input').fill('3000');await owner.locator('.presentation-video-commands input').dispatchEvent('change');
  await viewer.waitForFunction(()=>nativeVideos.some(v=>v.currentSrc.includes('/presentation/')&&Math.abs(v.currentTime-3)<.2));
  await viewer.locator('.presentation-video-local input').fill('0');await viewer.locator('.presentation-video-local input').dispatchEvent('input');
  assert.equal(await viewer.evaluate(()=>nativeVideos.find(v=>v.getAttribute('src')&&v.currentSrc.includes('/presentation/')).volume),0);assert.equal(await owner.evaluate(()=>nativeVideos.find(v=>v.getAttribute('src')&&v.currentSrc.includes('/presentation/')).volume),1);
  await owner.setViewportSize({width:390,height:844});await owner.screenshot({path:'/tmp/room-video-owner-mobile.png'});
  const mobile=await owner.locator('.room-presentation-dialog').boundingBox();assert(mobile.x>=0&&mobile.y>=0&&mobile.x+mobile.width<=391&&mobile.y+mobile.height<=845);
  await owner.setViewportSize({width:1280,height:900});await owner.screenshot({path:'/tmp/room-video-owner-desktop.png'});
  for(const [locale,label] of [['en-US','Video volume'],['zh-CN','视频音量'],['ru-RU','Громкость видео']]){
    await viewer.evaluate(locale=>i18n.setLocaleLocal(locale),locale);await viewer.waitForFunction(label=>document.querySelector('.presentation-video-local input')?.getAttribute('aria-label')===label,label);
  }
  await viewer.locator('#meeting-screen-preview').click();assert.equal(await viewer.locator('.room-screen-preview .presentation-video-local input').count(),1);assert.equal(await viewer.evaluate(()=>nativeVideos.filter(v=>v.getAttribute('src')).length),1);
  const enlarged=await viewer.locator('.room-screen-preview canvas').evaluate(c=>[...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data]);assert(enlarged[2]>enlarged[0]+50);await viewer.keyboard.press('Escape');
  await owner.locator('[data-command=video-play]').click();await playing(owner);
  const late=await pageFor(actors[2]);await playing(late);
  const times=await Promise.all([owner,late].map(p=>p.evaluate(()=>nativeVideos.find(v=>v.getAttribute('src')&&v.currentSrc.includes('/presentation/')).currentTime)));assert(Math.abs(times[0]-times[1])<.75,JSON.stringify(times));
  const oldSource=await viewer.evaluate(()=>nativeVideos.find(v=>v.getAttribute('src')&&v.currentSrc.includes('/presentation/')).currentSrc);
  await viewer.evaluate(()=>{WSClient.roomEnded=true;WSClient.ws.close();});await viewer.waitForFunction(()=>nativeVideos.every(v=>!v.getAttribute('src')));
  for(let i=0;i<50;i++){if((await viewer.request.get(oldSource,{headers:{Range:'bytes=0-15'}})).status()===403)break;if(i===49)throw Error('Disconnected grant remained active');await new Promise(r=>setTimeout(r,20));}
  await viewer.evaluate(async()=>{WSClient.roomEnded=false;await WSClient.connect(CONFIG.WS_URL);WSClient.send({type:'PLAYER_JOIN',payload:{roomSlug:ACTIVE_ROOM.slug,characterId:GAME_STATE.characterId,token:localStorage.getItem('token')}});});await playing(viewer);
  assert.notEqual(await viewer.evaluate(()=>nativeVideos.find(v=>v.getAttribute('src')&&v.currentSrc.includes('/presentation/')).currentSrc),oldSource);
  await owner.locator('[data-command=stop]').click();await viewer.waitForFunction(()=>nativeVideos.every(v=>!v.getAttribute('src')));
  assert.equal(await viewer.evaluate(()=>sent.filter(m=>m.type==='ROOM_PRESENTATION_COMMAND').length),0,'viewer local controls never sent a shared command');
  await owner.keyboard.press('Escape');await owner.setViewportSize({width:390,height:844});await owner.locator('#presentation-manage').click();
  const box=await owner.locator('.room-presentation-dialog').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=391&&box.y+box.height<=845);
  for(const p of [owner,viewer,late])await p.evaluate(()=>{RoomPresentation.stop();WSClient.roomEnded=true;WSClient.ws.close();});
  assert(await owner.evaluate(()=>nativeVideos.every(v=>!v.getAttribute('src')&&v.paused)));
  assert.deepEqual(errors,[]);
  console.log('Real SQL/HTTP/WS Chromium: MP4 upload/private preview, two clients and late join, blocked autoplay recovery, shared play/pause/seek, local volume, single decoder/enlarged canvas, mobile and stop cleanup passed.');
 }finally{await browser.close();}
}
module.exports={check};
