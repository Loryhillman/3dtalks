/** Roster truth, local capture races and room audio cancellation. No production data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const timeouts=new Map(),intervals=new Map(),events=new Map(),storage=new Map(),contexts=[];
let sequence=0,getCalls=0,nextCapture,barrier;
function track(){const listeners=new Map();return {readyState:'live',stops:0,
 addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},
 end(){this.readyState='ended';listeners.get('ended')?.();this.onended?.();},
 stop(){this.readyState='ended';this.stops++;}};}
function stream(){const item=track();return {item,getTracks:()=>[item]};}
class Audio {
 constructor(){contexts.push(this);}
 resume(){return barrier||Promise.resolve();}
 close(){this.closed=true;return Promise.resolve();}
 createMediaStreamSource(){this.source={connect:n=>{this.target=n;},disconnect:()=>{this.sourceDisconnected=true;}};return this.source;}
 createAnalyser(){this.analyser={fftSize:256,getByteTimeDomainData:a=>a.fill(170),disconnect:()=>{this.analyserDisconnected=true;}};return this.analyser;}
}
const context={
 console,Map,Set,Uint8Array,Object,Array,Date,Promise,isSecureContext:true,
 MeetingUI:{active:true},GAME_STATE:{characterId:'self'},
 localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
 document:{hidden:false,addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:(type,fn)=>{if(events.get(type)===fn)events.delete(type);}},
 navigator:{mediaDevices:{getUserMedia:async()=>{getCalls++;return nextCapture?nextCapture():stream();},enumerateDevices:async()=>[{kind:'audioinput',deviceId:'usb',label:'USB microphone'},{kind:'videoinput',deviceId:'camera',label:'Camera'}]}},
 AudioContext:Audio,voiceChat:{recording:false,resetMicrophoneError(){}},
 setTimeout:fn=>{const id=++sequence;timeouts.set(id,fn);return id;},clearTimeout:id=>timeouts.delete(id),
 setInterval:fn=>{const id=++sequence;intervals.set(id,fn);return id;},clearInterval:id=>intervals.delete(id)
};context.window=context;vm.createContext(context);
const load=(name,target=context)=>vm.runInContext(fs.readFileSync(require.resolve('../public/js/'+name),'utf8'),target);
load('meetingRoster.js');load('meetingAudioSettings.js');
(async()=>{
 const roster=context.MeetingRoster,audio=context.MeetingAudioSettings;
 roster.start('room');roster.snapshot([{characterId:'peer',characterName:'<b>Peer</b>'},{characterId:'self',characterName:'Me'}]);
 assert.equal(roster.getState().members[0].id,'self');
 roster.joined({characterId:'peer',characterName:'Renamed'});assert.equal(roster.getState().members.length,2);
 roster.recording('unknown',true);assert.equal(roster.getState().members.length,2);
 roster.recording('peer',true);assert(roster.getState().members[1].recording);
 const first={},second={};roster.playback('peer',first,true);roster.playback('peer',second,true);
 roster.playback('peer',first,false);assert(roster.getState().members[1].playing);
 roster.playback('peer',second,false);assert(!roster.getState().members[1].playing);
 roster.connection('reconnecting');assert.equal(timeouts.size,0);assert(!roster.getState().members[1].recording);
 roster.snapshot([{characterId:'self',characterName:'Me'}]);assert.equal(roster.getState().members.length,1);
 for(let i=0;i<10;i++)roster.joined({characterId:'peer'+i,characterName:'P'+i});
 assert.equal(roster.getState().members.length,6,'roster is bounded to room capacity');
 let updates=0;roster.subscribe(()=>updates++);roster.stop();const stoppedUpdates=updates;
 roster.joined({characterId:'late',characterName:'Late'});assert.equal(updates,stoppedUpdates);

 assert.equal(getCalls,0);assert.equal((await audio.devices()).length,1);assert.equal(getCalls,0,'enumeration requests no microphone');
 audio.selectDevice('usb');assert.equal(audio.constraints().audio.deviceId.exact,'usb');
 context.voiceChat.recording=true;await audio.beginTest();assert.equal(audio.getState().error,'recordingBusy');assert.equal(getCalls,0);
 context.voiceChat.recording=false;
 let resolve;nextCapture=()=>new Promise(r=>{resolve=r;});
 const pending=audio.beginTest();audio.stopTest();const late=stream();resolve(late);await pending;
 assert.equal(late.item.readyState,'ended');assert.equal(audio.getState().phase,'idle');assert.equal(contexts.length,0);
 nextCapture=undefined;await audio.beginTest();assert.equal(audio.getState().phase,'testing');
 const active=contexts.at(-1);assert.equal(active.target,active.analyser,'analyser never feeds speaker destination');
 for(const tick of intervals.values())tick();assert(audio.getState().level>0);
 audio.stopTest();assert(active.closed&&active.sourceDisconnected&&active.analyserDisconnected);assert.equal(intervals.size,0);assert.equal(timeouts.size,0);
 await audio.beginTest();for(const timeout of [...timeouts.values()])timeout();assert.equal(audio.getState().phase,'idle');assert.equal(intervals.size,0);
 const unplugged=stream();nextCapture=async()=>unplugged;await audio.beginTest();unplugged.item.end();assert.equal(audio.getState().error,'deviceGone');assert.equal(intervals.size,0);
 nextCapture=async()=>{const e=Error();e.name='NotAllowedError';throw e;};await audio.beginTest();assert.equal(audio.getState().error,'permissionDenied');
 // Closing while AudioContext.resume is pending must close the context and release tracks.
 nextCapture=undefined;let resume;barrier=new Promise(r=>{resume=r;});
 const resuming=audio.beginTest();await Promise.resolve();await Promise.resolve();
 audio.stopTest();resume();await resuming;barrier=undefined;
 assert.equal(audio.getState().phase,'idle');assert.equal(intervals.size,0);
 await audio.beginTest();context.document.hidden=true;events.get('visibilitychange')();assert.equal(audio.getState().phase,'idle');
 context.document.hidden=false;audio.stop();assert.equal(events.size,0);

 // Exercise the real clip manager: no offline queue, late capture/read/decode guards.
 const packets=[],readers=[],tracks=[],playbackEvents=[];
 let online=true,decodeResolve;
 class Recorder {
  static isTypeSupported(){return true;}state='inactive';mimeType='audio/webm';
  start(){if(Recorder.failStart)throw Error('Recorder unavailable');this.state='recording';}
  stop(){this.state='inactive';this.onstop?.();}
 }
 class Reader {constructor(){readers.push(this);}readAsDataURL(){this.result='data:audio/webm;base64,YQ==';}abort(){this.aborted=true;this.onloadend?.();}}
 class PlaybackAudio {
  constructor(){this.state='running';}resume(){return Promise.resolve();}close(){return Promise.resolve();}
  decodeAudioData(){return new Promise(r=>{decodeResolve=r;});}
  createBufferSource(){const source={connect:()=>source,disconnect(){},stop(){source.onended?.();},start(){}};return source;}
  createGain(){return {gain:{value:0},connect:()=>({}),disconnect(){}};}
 }
 const voiceContext={...context,AudioContext:PlaybackAudio,MediaRecorder:Recorder,FileReader:Reader,Blob,atob:s=>Buffer.from(s,'base64').toString('binary'),
  navigator:{mediaDevices:{getUserMedia:async()=>{const value=stream();tracks.push(value);return value;}}},
  UI:{addChatMessage(){}},WSClient:{isConnected:()=>online,send:p=>packets.push(p)},
  MeetingRoster:{recording(){},playback:(...args)=>playbackEvents.push(args)},MeetingAudioSettings:undefined};
 voiceContext.window=voiceContext;vm.createContext(voiceContext);load('voiceChat.js',voiceContext);
 const voice=voiceContext.voiceChat;voice._getBtn=()=>null;
 let grant;voiceContext.navigator.mediaDevices.getUserMedia=()=>new Promise(r=>{grant=r;});
 const old=voice.startTalk();voice.cancelRoomAudio();const oldStream=stream();grant(oldStream);await old;
 assert.equal(oldStream.item.readyState,'ended');assert.equal(voice.stream,null);assert.equal(voice.recording,false);
 voiceContext.navigator.mediaDevices.getUserMedia=async()=>stream();
 await voice.startTalk();voice.chunks=[new Blob(['audio'])];voice.recordStartTime=Date.now()-1500;voice.stopTalk();
 assert.equal(readers.length,1);const before=packets.length;voice.cancelRoomAudio();assert(readers[0].aborted);assert.equal(voice.pendingReaders.size,0);readers[0].onload();assert.equal(packets.length,before,'old FileReader cannot send after room cancellation');
 const playing=voice.playVoiceMessage({characterId:'peer',audio:'YQ=='});await Promise.resolve();
 voice.toggleMute();voice.toggleMute();decodeResolve({});await playing;
 assert.equal(voice.playbackSources.size,0,'mute/unmute cannot revive an earlier pending decode');
 const activePlayback=voice.playVoiceMessage({characterId:'peer',audio:'YQ=='});await Promise.resolve();decodeResolve({});await activePlayback;
 assert.equal(voice.playbackSources.size,1);assert.equal(playbackEvents.at(-1)[2],true);
 voice.toggleMute();assert.equal(voice.playbackSources.size,0);assert.equal(playbackEvents.at(-1)[2],false);
 await voice.startTalk();voice.stream.item.end();assert.equal(voice.recording,false);assert.equal(voice.stream,null);assert.equal(voice.disabledReason,'microphone');
 voice.resetMicrophoneError();Recorder.failStart=true;await voice.startTalk();assert.equal(voice.recorder,null);assert.equal(voice.stream,null);assert.equal(voice.wantRecording,false);
 Recorder.failStart=false;voice.resetMicrophoneError();await voice.startTalk();voice.recordStartTime=Date.now()-1500;voice.chunks=[new Blob(['audio'])];
 const beforeDenied=readers.length;voice.handleServerMessage('VOICE_DENIED',{});
 assert.equal(readers.length,beforeDenied,'denied recording is discarded before encoding');assert.equal(voice.recording,false);
 voice.resetMicrophoneError();assert(voice.disabled,'local microphone retry cannot override a server congestion denial');
 voice.handleServerMessage('VOICE_PROBE_RESULT',{allowed:true});assert(!voice.disabled);
 online=false;const beforeOffline=packets.length;voice.stopTalk();voice._sendLive('VOICE_PROBE');assert.equal(packets.length,beforeOffline);
 voice.dispose();
 console.log('Meeting controls: bounded server roster, distinct recording/playback, selected microphone, local test/no capture on enumerate, permission/resume/timeout/visibility cleanup, late grants/readers/decodes, incoming mute and offline voice cancellation OK');
})().catch(e=>{console.error(e);process.exitCode=1;});
