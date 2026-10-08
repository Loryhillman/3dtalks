const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sockets = [], timers = [], calls = { chat: [], seats: [], avatars: [], blocked: [], removed: [], connections: 0, disconnected: 0, redirects: [] };
class Socket {
  static OPEN = 1;
  readyState = 0; sent = [];
  constructor() { sockets.push(this); }
  send(text) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState=3;this.onclose?.({code:1000}); }
  open() { this.readyState=1;this.onopen(); }
  message(data) { this.onmessage({data:typeof data==='string'?data:JSON.stringify(data)}); }
}
function group() { return {position:{set(){}},userData:{}}; }
const own={group:group(),name:'Me'};
const world={ players:new Map([['me',own]]),
 addPlayer:(...args)=>{calls.add=args;world.players.set(args[0],{group:group(),name:args[1]});},
 updatePlayerName:(id,name)=>{world.players.get(id).name=name;},
 removePlayer:id=>{calls.removed.push(id);world.players.delete(id);} };
const context={console:{warn(){},log(){}},WebSocket:Socket,
 setTimeout:handler=>{timers.push(handler);return timers.length;},clearTimeout(){},setInterval(){},
 location:{pathname:'/play',replace:url=>calls.redirects.push(url)},CONFIG:{WS_URL:'ws://fixture'},
 GAME_STATE:{characterId:'me'},gameWorld:world,localStorage:{getItem:()=> 'token'},
 RoomSeating:{connecting:()=>calls.connections++,disconnected:()=>calls.disconnected++,message:(...args)=>calls.seats.push(args),blocked:reason=>calls.blocked.push(reason)},
 UserAvatarRenderer:{apply:(...args)=>calls.avatars.push(args)},UI:{addChatMessage:(...args)=>calls.chat.push(args)},
 i18n:{t:key=>key,tp:(key,params)=>key+params.name},voiceChat:{handleServerMessage:(...args)=>{calls.voice=args;}},
 nearbyBubbles:{show(){},removeFor(){}},document:{addEventListener(){}},addEventListener(){} };
context.window=context;vm.createContext(context);
for(const file of ['socketClient.js','meetingSocket.js','wsPresenceGuard.js']){
 vm.runInContext(fs.readFileSync(require.resolve('../public/js/'+file),'utf8'),context);
}
(async()=>{
 const ws=context.WSClient;
 const initial=ws.connect('ws://fixture');sockets[0].open();await initial;
 ws.send({type:'PLAYER_JOIN',payload:{characterId:'me',roomSlug:'fixture',token:'token'}});
 const peer={characterId:'peer',characterName:'Peer',position:{x:1,y:2,z:3},avatarConfig:{headType:'cube'},
 glbUrl:'/legacy-missing.glb',weaponConfig:{type:'sword'},animUrls:{idle:'/legacy-anim.glb'},entityType:'agent'};
 sockets[0].message({type:'WORLD_STATE',payload:{players:[peer],weather:{type:'storm'}}});
 assert.equal(world.players.has('peer'),true);
 assert.equal(calls.add[1],'Peer','meeting names have no legacy AI decoration');
 assert.deepEqual(Array.from(calls.add.slice(4,9)),[null,null,null,null,null]);
 assert.equal(calls.add[9].headType,'cube');
 sockets[0].message({type:'PLAYER_JOINED',payload:{...peer,characterName:'Renamed'}});
 assert.equal(world.players.get('peer').name,'Renamed');assert.equal(calls.avatars.length,1);
 sockets[0].message({type:'ROOM_LOOK',payload:{characterId:'peer',look:{yaw:0,pitch:0}}});
 assert.equal(calls.seats.at(-1)[0],'ROOM_LOOK');
 sockets[0].message({type:'CHAT',payload:{sender:'Peer',message:'Hello',characterId:'peer'}});
 assert.deepEqual(calls.chat.at(-1),['Peer','Hello']);
 sockets[0].message({type:'VOICE_MESSAGE',payload:{characterId:'peer',audioData:'fixture'}});
 assert.equal(calls.voice[0],'VOICE_MESSAGE');
 for(const type of ['SKILL_CAST','MONSTER_ATTACK','MONSTER_SPAWNED','MONSTER_MOVE','MONSTER_DIED','VOICE_COMMAND','WEATHER_CHANGE','MODEL_UPDATE','POSITION_UPDATE']){
  sockets[0].message({type,payload:{}});
 }
 for(const malformed of ['not json','null','[]','{}','{"type":12}','{"type":"WORLD_STATE","payload":null}','{"type":"CHAT","payload":[]}'])sockets[0].message(malformed);
 assert.equal(world.players.size,2);
 // The production reconnect wrapper replays join and removes stale peers from a snapshot.
 const reconnect=ws.connect('ws://fixture');sockets[1].open();await reconnect;
 assert.equal(sockets[1].sent[0].type,'PLAYER_JOIN');
 sockets[0].close();assert.equal(ws.connected,true,'old close cannot mark the current socket disconnected');
 assert.equal(calls.disconnected,0);
 sockets[0].message({type:'CHAT',payload:{sender:'Stale',message:'ignored'}});
 assert.deepEqual(calls.chat.at(-1),['Peer','Hello']);
 sockets[1].message({type:'WORLD_STATE',payload:{players:[]}});
 assert.equal(world.players.has('peer'),false);assert.deepEqual(calls.removed,['peer']);
 sockets[1].message({type:'PLAYER_JOINED',payload:peer});
 sockets[1].message({type:'PLAYER_LEFT',payload:{characterId:'peer'}});
 assert.equal(world.players.has('peer'),false);
 sockets[1].message({type:'ROOM_JOIN_DENIED',payload:{code:'ROOM_FULL'}});
 assert.equal(ws.roomEnded,true);assert.deepEqual(calls.blocked,['full']);assert.equal(calls.disconnected,0,'close preserves the room-full explanation');
 assert.equal(ws.messageQueue.length,0);
 // A pre-open close rejects initialization instead of leaving it pending forever.
 ws.roomEnded=false;
 const early=ws.connect('ws://fixture');const rejection=assert.rejects(early,/closed before/);
 sockets[2].close();await rejection;ws.roomEnded=true;
 console.log('Meeting socket: avatars, seats, chat, voice, malformed/RPG messages, reconnect roster, stale transport and denied joins OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
