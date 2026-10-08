// Loads the complete player page. HTTP/WS data are fixtures; every production
// browser script and the World/Player constructors run without replacement.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'../public');
const apiCalls=[];
const room={id:'fixture-room',slug:'fixture',name:'Meeting fixture',status:'open',capacity:6,seating_mode:'seated',spawn_position:{x:0,y:1,z:0}};
const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://fixture').pathname;
 if(url.startsWith('/api/')){
  apiCalls.push({url,method:req.method});res.setHeader('Content-Type','application/json');
  const data=url==='/api/config/language'?{language:'en-US'}:
    url==='/api/users/character/me'?{character:{id:'me',name:'Fixture',health:100,max_health:100},appearance:{},equipment:[],skills:[]}:
    url==='/api/rooms/fixture'?{success:true,room}:
    url==='/api/rooms/fixture/objects'?{success:true,objects:[]}:
    url==='/api/my/avatar'?{config:{mode:'standard',headType:'sphere',headColor:'#ffaa99',bodyColor:'#4a90e2',headScale:1,headOffset:0,headYaw:0}}:
    {success:false,error:'Legacy API is deliberately unavailable'};
  res.end(JSON.stringify(data));return;
 }
 const file=url==='/play'?path.join(root,'index.html'):path.resolve(root,'.'+url);
 if(!file.startsWith(root+path.sep))throw Error('Invalid path');
 res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.html':'text/html'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));
}catch(e){res.statusCode=404;res.end(e.message);}});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const cache='/root/.cache/ms-playwright';let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();
 try{await fs.access(executable);}catch(_){for(const dir of await fs.readdir(cache))if(dir.startsWith('chromium-')){const file=path.join(cache,dir,'chrome-linux64/chrome');try{await fs.access(file);executable=file;break;}catch(_){}}}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],dialogs=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
 await page.addInitScript(()=>{
  localStorage.setItem('token','fixture-token');localStorage.setItem('userId','user');localStorage.setItem('characterId','me');
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
 await page.goto('http://127.0.0.1:'+server.address().port+'/play?room=fixture');
 await page.waitForFunction(()=>window.gameWorld&&window.RoomSeating?.active&&window.sent?.some(m=>m.type==='PLAYER_JOIN'),{timeout:15000});
 // Allow delayed legacy initializers to run, then exercise their old shortcuts.
 await page.waitForTimeout(1700);
 for(const key of ['p','i','v','m'])await page.keyboard.press(key);
 await page.waitForTimeout(150);
 const forbidden=apiCalls.filter(call=>/^\/api\/(federation|world\/ground-config|ui-controls|config\/(lod-enabled|weather)|shop|skills|monsters|inventory|public\/character-templates|model-guard)/.test(call.url));
 assert.deepEqual(forbidden,[],'room startup and RPG shortcuts must not call legacy APIs');
 assert.deepEqual(dialogs,[],'room startup must not display browser dialogs');assert.deepEqual(errors,[]);
 const state=await page.evaluate(()=>({weather:gameWorld._weather,recognition:!!window.voiceManagerInstance,avatar:player.worldObject.userData.accountAvatarConfig?.headType,movementControls:!!document.getElementById('mobile-joystick'),hudSettings:!!window.uiControlManager?.initialized,chat:!!document.getElementById('nearby-chat-input'),mic:!!document.getElementById('skill-voice-btn')}));
 assert.deepEqual(state,{weather:'clear',recognition:false,avatar:'sphere',movementControls:false,hudSettings:false,chat:true,mic:true});
 console.log('Complete meeting page: real startup, legacy APIs disabled, RPG shortcuts inert, chat/microphone retained, no dialogs or JS errors OK');
})().catch(e=>{console.error(e);console.error('Requests:',apiCalls);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server.close(r));});
