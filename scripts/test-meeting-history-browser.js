// Real browser history and WebSocket transport; auth, admission and rendering are fixtures.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {WebSocketServer}=require('ws'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../public');
let admissions=0,joins=0,leaves=0,browser;
const peers=new Map();
const setup=`
window.API={getCharacter:async id=>({character:{id,name:id}})};
window.RoomAvatarSession={prepare:async()=>({accountAvatar:{}})};
window.RoomSeating={enter(){},connecting(){},disconnected(){}};
window.MeetingInput={attach:()=>()=>{}};
window.UserAvatarRenderer={apply(){}};
window.UI={hideLoadingScreen(){},addChatMessage(){}};
window.CONFIG={WS_URL:location.origin.replace('http:','ws:')+'/socket'};
window.i18n={t:k=>k,tp:k=>k};
window.voiceChat={dispose(){sessionStorage.setItem('disposed',String(Number(sessionStorage.getItem('disposed')||0)+1));}};
window.WSPresenceGuard={stop(){}};
window.World=class {
 constructor(){this.players=new Map();}
 getSpawnPosition(){return {x:0,y:0,z:0};}
 clearRoomScene(){} clearMeetingParticipants(){this.players.clear();} stopRendering(){}
};
window.MeetingPlayer=class {constructor(){this.position={set(){}};this.worldObject={};}};
window.WSClient=class extends SocketClient {
 static handleMessage(message){if(message.type==='PRESENCE'&&window.gameWorld)gameWorld.players=new Map(message.payload.map(id=>[id,{}]));}
};
window.addEventListener('load',()=>window.addEventListener('pagehide',event=>{
 const history=JSON.parse(sessionStorage.getItem('historyEvents')||'[]');
 history.push({persisted:event.persisted,ended:WSClient.roomEnded,disposed:Number(sessionStorage.getItem('disposed'))});
 sessionStorage.setItem('historyEvents',JSON.stringify(history));
}));
`;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://fixture').pathname;
  res.setHeader('Cache-Control','private, max-age=120');
  if(url==='/api/rooms/fixture'){res.setHeader('Cache-Control','no-store');admissions++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,room:{id:'fixture',slug:'fixture',status:'open'}}));return;}
  if(url==='/rooms'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Rooms</title><a href="/play?room=fixture">Enter meeting</a>');return;}
  if(url==='/play'){
   res.setHeader('Content-Type','text/html');
   res.end('<!doctype html><title>Meeting</title><canvas id="canvas"></canvas><a href="/rooms">Cabinet</a><script src="/js/socketClient.js"></script><script>'+setup+'</script><script src="/js/meetingMain.js"></script>');return;
  }
  if(['/js/socketClient.js','/js/meetingMain.js'].includes(url)){res.setHeader('Content-Type','application/javascript');res.end(await fs.readFile(path.join(root,url)));return;}
  res.writeHead(404);res.end();
 }catch(e){res.writeHead(500);res.end(e.message);}
});
const sockets=new WebSocketServer({server,path:'/socket'});
function publish(){const data=JSON.stringify({type:'PRESENCE',payload:[...peers.values()]});for(const socket of peers.keys())if(socket.readyState===1)socket.send(data);}
sockets.on('connection',socket=>{
 socket.on('message',raw=>{const message=JSON.parse(raw);if(message.type==='PLAYER_JOIN'){peers.set(socket,message.payload.characterId);joins++;publish();}});
 socket.on('close',()=>{if(peers.delete(socket)){leaves++;publish();}});
});
async function executable(){
 const candidates=[process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,chromium.executablePath()].filter(Boolean);
 const cache=path.join(require('node:os').homedir(),'.cache/ms-playwright');
 for(const dir of await fs.readdir(cache))if(dir.startsWith('chromium-'))candidates.push(path.join(cache,dir,'chrome-linux64/chrome'));
 for(const file of candidates){try{await fs.access(file);return file;}catch(_){}}
 throw Error('Chromium unavailable');
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:await executable(),headless:true,ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--no-sandbox']});
 const contexts=[];
 async function participant(id){
  const context=await browser.newContext();contexts.push(context);
  await context.addInitScript(id=>{localStorage.setItem('token','fixture');localStorage.setItem('userId',id);localStorage.setItem('characterId',id);},id);
  const page=await context.newPage();page.setDefaultTimeout(10000);return page;
 }
 const observer=await participant('observer'),traveller=await participant('traveller'),errors=[];
 for(const page of [observer,traveller])page.on('pageerror',error=>errors.push(error.message));
 const count=number=>observer.waitForFunction(number=>gameWorld?.players.size===number,number);
 const admitted=()=>traveller.waitForFunction(()=>WSClient.connected&&gameWorld?.players.has('traveller'));
 await observer.goto(base+'/play?room=fixture');await count(1);
 await traveller.goto(base+'/rooms');await traveller.locator('a').click();await admitted();await count(2);
 for(let cycle=0;cycle<2;cycle++){
  const previousAdmissions=admissions;
  await traveller.goBack({waitUntil:'commit'});await traveller.waitForURL(base+'/rooms',{waitUntil:'commit'});await count(1);
  assert.equal(peers.size,1,'cached meeting must release its live socket');
  await traveller.goForward({waitUntil:'commit'});await admitted();await count(2);
  assert(admissions>previousAdmissions,'history restore must repeat server admission');
 }
 // Opposite direction: leave by link, then Back enters and Forward leaves.
 await traveller.locator('a').click();await count(1);
 const previousAdmissions=admissions;
 await traveller.goBack({waitUntil:'commit'});await admitted();await count(2);
 assert(admissions>previousAdmissions);
 await traveller.goForward({waitUntil:'commit'});await traveller.waitForURL(base+'/rooms',{waitUntil:'commit'});await count(1);
 const events=await traveller.evaluate(()=>JSON.parse(sessionStorage.getItem('historyEvents')||'[]'));
 assert(events.length>=4);assert(events.every(event=>event.ended&&event.disposed>0),'every navigation disposes the meeting before cache freeze');
 assert(joins>=5&&leaves>=4);assert.deepEqual(errors,[]);
 console.log('History navigation: actual Back/Forward in both directions, observer removes/re-adds participant, fresh admission, socket/capture cleanup and repeated cycles passed; cached pagehide events: '+events.filter(event=>event.persisted).length);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
 await browser?.close();for(const socket of sockets.clients)socket.terminate();
 await new Promise(resolve=>sockets.close(resolve));await new Promise(resolve=>server.close(resolve));
});
