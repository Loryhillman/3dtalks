const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const sent = [], timers = [], intervals = [];
let connections = 0, flushed = 0;
const context = {console:{log(){},warn(){}},Date,Set,CONFIG:{WS_URL:'ws://fixture'},
  localStorage:{getItem:()=> 'current-token'},document:{addEventListener(){}},addEventListener(){},
  setTimeout:handler=>{timers.push(handler);return timers.length;},setInterval:handler=>intervals.push(handler),
  WSClient:{messageQueue:[],connected:true,roomEnded:false,ws:{readyState:1,send:text=>sent.push(JSON.parse(text))},
    send:message=>sent.push(message),flushMessageQueue:()=>flushed++,handleMessage(){},handleWorldState(){},
    connect:async()=>{connections++;}}
};
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../public/js/wsPresenceGuard.js'),'utf8'),context);
const ws=context.WSClient;
ws.send({type:'PLAYER_JOIN',payload:{characterId:'me',roomSlug:'fixture',token:'old'}});
ws.flushMessageQueue();assert.equal(sent.length,2);assert.equal(sent[1].payload.token,'current-token');
ws.connected=false;ws.ws.readyState=3;ws.attemptReconnect();assert.equal(timers.length,1);
ws.roomEnded=true;ws.messageQueue.push({type:'CHAT_MESSAGE'});ws.ws.readyState=1;
ws.flushMessageQueue();ws.send({type:'PLAYER_JOIN',payload:{characterId:'me'}});
for(const timer of timers)timer();for(const interval of intervals)interval();
assert.equal(sent.length,2,'stopped meetings must not replay identity or send later commands');
assert.equal(flushed,1);assert.equal(connections,0,'previously scheduled retry must respect roomEnded');
assert.equal(ws.messageQueue.length,0);
console.log('Meeting presence stop: no cached rejoin, queued messages, probes or scheduled reconnect after exit OK');
