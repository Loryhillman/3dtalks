const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const timers=new Map();let next=0,stops=0;
class Recorder {
 static isTypeSupported(){return true;}state='inactive';mimeType='audio/webm';
 start(){this.state='recording';}stop(){this.state='inactive';this.onstop?.();}
}
const stream=()=>({getTracks:()=>[{readyState:'live',stop:()=>stops++}]});
const ctx={console,Date,Set,MediaRecorder:Recorder,navigator:{mediaDevices:{getUserMedia:async()=>stream()}},
 localStorage:{getItem:()=>null},UI:{addChatMessage(){}},WSClient:{isConnected:()=>true,send(){}},
 setTimeout:fn=>{const id=++next;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
 setInterval:fn=>{const id=++next;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../public/js/voiceChat.js'),'utf8'),ctx);
(async()=>{
 const voice=ctx.voiceChat;voice._setRecordingUI=()=>{};
 await voice.startTalk();assert.equal(timers.size,1);
 voice.stopTalk();assert.equal(timers.size,0,'finished recording cannot leave a timer that stops a later recording');
 await voice.startTalk();voice._startProbe();assert.equal(timers.size,2);
 voice.dispose();assert.equal(timers.size,0);assert.equal(voice.stream,null);assert.equal(voice.recorder,null);
 assert.equal(stops,2);await voice.startTalk();assert.equal(timers.size,0);
 // Permission granted after leaving must immediately release the returned stream.
 const pending=new ctx.VoiceChatManager();pending._setRecordingUI=()=>{};
 let grant;ctx.navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{grant=resolve;});
 const acquiring=pending.startTalk();pending.dispose();grant(stream());await acquiring;
 assert.equal(stops,3);assert.equal(pending.stream,null);assert.equal(timers.size,0);
 // MediaRecorder stop is asynchronous: do not create a second recorder before
 // the preceding stop callback has released its stream and chunks.
 ctx.navigator.mediaDevices.getUserMedia=async()=>stream();
 const deferred=new ctx.VoiceChatManager();deferred._setRecordingUI=()=>{};
 await deferred.startTalk();const recorder=deferred.recorder;
 recorder.stop=function(){this.state='inactive';};
 deferred.stopTalk();await deferred.startTalk();assert.equal(deferred.recorder,recorder);
 recorder.onstop();assert.equal(deferred.recorder,null);deferred.dispose();
 console.log('Voice lifecycle: recording deadline cleanup, exit cancellation, probe shutdown and late microphone permission release OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
