const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const script = fs.readFileSync(require.resolve('../public/js/meetingMain.js'), 'utf8');
function fixture() {
  const events = {}, storage = new Map([['token', 'token'], ['userId', 'user'], ['characterId', 'me']]);
  const calls = { worlds: 0, players: 0, connects: 0, sent: [], redirects: [], panels: [], clear: 0, renderStopped: 0 };
  const element = () => ({style:{},setAttribute(){},append(){}});
  const room = {slug:'fixture',status:'open'};
  const context = { console: {error(){}}, AbortController, URLSearchParams,
    location:{pathname:'/play',search:'?room=fixture',replace:url=>calls.redirects.push(url)},
    document:{getElementById:()=>element(),createElement:element,body:{append:panel=>calls.panels.push(panel)}},
    localStorage:{getItem:key=>storage.get(key)||null,removeItem:key=>storage.delete(key)},
    i18n:{t:key=>key,tp:(key,params)=>key+params.name},
    API:{getCharacter:async()=>({character:{id:'me',name:'Fixture'}})},
    fetch:async()=>({ok:true,status:200,json:async()=>({success:true,room})}),
    RoomAvatarSession:{prepare:async()=>({accountAvatar:{headType:'sphere'}})},
    RoomSeating:{enter(){}},UserAvatarRenderer:{apply(){}},
    MeetingInput:{attach:()=>()=>{}},UI:{hideLoadingScreen(){},addChatMessage(){}},CONFIG:{WS_URL:'ws://fixture'},
    WSClient:{messageQueue:[],connect:async()=>{calls.connects++;},send:message=>calls.sent.push(message)},
    World:class {constructor(){calls.worlds++;}getSpawnPosition(){return{x:0,y:1,z:0};}clearRoomScene(){calls.clear++;}stopRendering(){calls.renderStopped++;}},
    Player:class {constructor(){calls.players++;this.position={set(){}};this.worldObject={};}},
    addEventListener:(name,handler)=>{events[name]=handler;}
  };
  context.window=context;vm.createContext(context);vm.runInContext(script,context);
  return {context,calls,events,storage,room};
}
(async()=>{
  let f=fixture();await Promise.all([f.context.MeetingMain.start(),f.context.MeetingMain.start()]);
  assert.equal(f.calls.worlds,1);assert.equal(f.calls.connects,1);assert.equal(f.calls.sent.length,1);
  assert.deepEqual(Object.keys(f.calls.sent[0].payload).sort(),['characterId','position','roomSlug','token']);
  assert.equal(f.context.GAME_STATE.isLoggedIn,true);

  f=fixture();f.storage.delete('token');await f.context.MeetingMain.start();
  assert.deepEqual(f.calls.redirects,['/join/fixture']);assert.equal(f.calls.worlds,0);
  f=fixture();f.context.API.getCharacter=async()=>{const error=new Error('missing');error.status=404;throw error;};
  await f.context.MeetingMain.start();assert.equal(f.storage.size,0);assert.equal(f.calls.worlds,0);
  assert.deepEqual(f.calls.redirects,['/join/fixture']);
  f=fixture();f.context.fetch=async()=>({ok:false,status:404,json:async()=>({code:'ROOM_NOT_FOUND'})});
  await f.context.MeetingMain.start();assert.equal(f.calls.worlds,0);assert.equal(f.calls.panels.length,1);
  f=fixture();f.context.RoomAvatarSession.prepare=async()=>{throw Error('Avatar failed');};
  await f.context.MeetingMain.start();assert.equal(f.calls.worlds,0);assert.equal(f.calls.panels.length,1);

  // Logout while awaiting the room API must not create a scene or join later.
  f=fixture();let finishRoom;
  f.context.fetch=()=>new Promise(resolve=>{finishRoom=resolve;});
  const pending=f.context.MeetingMain.start();await new Promise(resolve=>setImmediate(resolve));
  f.storage.delete('token');f.events.storage({key:'token',newValue:null});
  finishRoom({ok:true,json:async()=>({success:true,room:f.room})});await pending;
  assert.equal(f.calls.worlds,0);assert.equal(f.calls.sent.length,0);
  assert.deepEqual(f.calls.redirects,['/rooms']);

  // A second account's login must not be erased by a stale 404 response.
  f=fixture();let missing;
  f.context.API.getCharacter=()=>new Promise((_resolve,reject)=>{missing=reject;});
  const stale=f.context.MeetingMain.start();f.storage.set('userId','other');
  const error=new Error('missing');error.status=404;missing(error);await stale;
  assert.equal(f.storage.get('token'),'token');assert.equal(f.storage.get('userId'),'other');
  assert.deepEqual(f.calls.redirects,['/rooms']);

  f=fixture();let connected;
  f.context.WSClient.connect=()=>new Promise(resolve=>{connected=resolve;});
  const connecting=f.context.MeetingMain.start();await new Promise(resolve=>setImmediate(resolve));
  f.context.MeetingMain.stop();connected();await connecting;
  assert.equal(f.calls.sent.length,0);assert.equal(f.calls.renderStopped,1);assert.equal(f.calls.clear,1);
  console.log('Meeting startup: single start, auth redirects, API failure, stale identity and cancelled WebSocket join OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
