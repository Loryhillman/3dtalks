/** Regression for native media failures and a retry resolving after room exit. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
class Video extends EventTarget {
 constructor(){super();this.readyState=2;this.paused=true;this.currentTime=0;this.playCalls=0;this.loads=0;this.error=null;}
 pause(){this.paused=true;}
 play(){this.playCalls++;this.paused=false;return Promise.resolve();}
 load(){this.loads++;}
 removeAttribute(){}
 remove(){}
}
const document=new EventTarget();document.hidden=false;document.createElement=()=>new Video();
const timers=new Set(),context={document,Event,AbortController,URL,console,RoomVideoTimeline:{position:()=>0},localStorage:{getItem:()=>null},setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)};
context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../public/js/roomVideoPlayback'),'utf8'),context);
(async()=>{
 const player=new context.RoomVideoPlayback();player.state={asset:{durationMs:10000},playback:{status:'playing'}};
 player.video.dispatchEvent(new Event('error'));
 for(let n=0;n<5;n++)player.sync();
 assert.equal(player.video.playCalls,0,'decoder errors require user retry instead of repeated timer play calls');
 assert.equal(player.lastStatus,'failed');
 let resolve;player.renew=()=>new Promise(r=>resolve=r);player.video.error={code:2};player.source='/clip.mp4';
 const retry=player.unlock();player.dispose();const loads=player.video.loads;resolve();await retry;
 assert.equal(player.video.loads,loads,'late renewal cannot reload a disposed video');
 await player.unlock();assert.equal(player.video.loads,loads);assert.equal(timers.size,0);
 const active=new context.RoomVideoPlayback();active.state={asset:{durationMs:10000},playback:{status:'playing'}};
 active.video.dispatchEvent(new Event('error'));active.renew=()=>Promise.resolve();await active.unlock();await Promise.resolve();
 assert.equal(active.video.playCalls,1,'a successful explicit retry resumes the active player');active.dispose();assert.equal(timers.size,0);
 console.log('Video lifecycle: no decoder retry loop, late retry cannot revive disposed media, active retry and timer cleanup passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
