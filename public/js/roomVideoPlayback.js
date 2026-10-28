/** One native decoder/audio source; the scene owns canvas/texture, never this player. */
(() => {
 const text=key=>window.i18n?.t('roomVideo.'+key)||key;
 class RoomVideoPlayback {
  constructor({view=null,clock=()=>Date.now(),status=()=>{}}={}){
   this.view=view;this.clock=clock;this.status=status;this.video=document.createElement('video');this.video.playsInline=true;this.video.preload='auto';
   try{const saved=localStorage.getItem('roomVideoVolume');if(saved!==null&&Number.isFinite(Number(saved))&&Number(saved)>=0&&Number(saved)<=1)this.video.volume=Number(saved);}catch(_){}
   this.video.muted=this.video.volume===0;
   this.controller=new AbortController();this.closed=false;this.blocked=false;this.state=null;this.playPending=false;this.source=null;
   const signal=this.controller.signal;
   for(const event of ['loadedmetadata','seeked','canplay'])this.video.addEventListener(event,()=>{this.sync(true);this.draw();},{signal});
   this.video.addEventListener('waiting',()=>this.report('buffering'),{signal});
   this.video.addEventListener('playing',()=>{this.blocked=false;this.report('playing');},{signal});
   this.video.addEventListener('ended',()=>{this.draw();this.report('paused');},{signal});
   this.video.addEventListener('error',()=>{if(!this.closed){this.blocked=true;this.video.pause();this.report('failed');}},{signal});
   this.visibility=()=>{if(document.hidden)this.cancelFrame();else{this.renew().then(()=>{this.sync(true);this.frame();}).catch(()=>{});}};
   document.addEventListener('visibilitychange',this.visibility,{signal});
   this.tick=setInterval(()=>{this.localize();this.sync();if(this.state&&!document.hidden){this.progress();this.status(this.lastStatus);}},500);
  }
  report(key){if(this.closed||this.lastStatus===key&&(!this.message||this.message.textContent===text(key)))return;this.lastStatus=key;this.status(key);if(this.message)this.message.textContent=text(key);if(this.enable)this.enable.hidden=key!=='blocked'&&key!=='failed';}
  async load({grantUrl,headers}){
   this.grantUrl=grantUrl;this.headers=headers;await this.renew();if(this.closed)return;
   this.video.src=this.source;this.video.load();this.frame();
   this.renewal=setInterval(()=>this.renew().catch(()=>{}),20000);
  }
  renew(){
   if(this.closed||!this.grantUrl)return Promise.resolve();if(this.renewing)return this.renewing;
   const task=(async()=>{
    const response=await fetch(this.grantUrl,{method:'POST',headers:{...this.headers,'Content-Type':'application/json'},body:'{}',cache:'no-store',signal:this.controller.signal});
    if(!response.ok)throw Error('VIDEO_ACCESS_LOST');const data=await response.json();if(this.closed)return;
    const url=new URL(data.contentPath||this.grantUrl.replace(/\/grant$/,'/content'),location.href),base=new URL(this.grantUrl,location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith(base.pathname.slice(0,base.pathname.lastIndexOf('/'))+'/'))throw Error('VIDEO_ACCESS_LOST');
    this.source=url.href;
   })().catch(e=>{if(!this.closed&&e.name!=='AbortError'){this.video.pause();this.blocked=true;this.report('failed');}throw e;}).finally(()=>{if(this.renewing===task)this.renewing=null;});
   this.renewing=task;return task;
  }
  update(state){this.state=state;this.sync(true);}
  sync(force=false){
   if(this.closed||!this.state||!this.video.readyState||document.hidden)return;
   const v=this.video,target=RoomVideoTimeline.position(this.state.playback,this.state.asset.durationMs,this.clock())/1000;
   const playing=this.state.playback.status==='playing'&&target<this.state.asset.durationMs/1000;
   const drift=target-v.currentTime;
   if(!v.seeking&&(force&&Math.abs(drift)>.2||Math.abs(drift)>.75||!playing&&Math.abs(drift)>.05))try{v.currentTime=target;}catch(_){}
   v.playbackRate=playing&&Math.abs(drift)>.2&&Math.abs(drift)<=.75?(drift>0?1.05:.95):1;
   if(!playing){v.pause();if(this.lastStatus!=='failed'){this.blocked=false;this.report('paused');}}
   else if(v.paused&&!this.blocked&&!this.playPending){
    this.playPending=true;v.play().catch(e=>{if(!this.closed&&e.name!=='AbortError'){this.blocked=true;this.report(e.name==='NotAllowedError'?'blocked':'failed');}}).finally(()=>{this.playPending=false;});
   }
  }
  async unlock(){
   if(this.closed)return;
   // Called directly from a user gesture; do not await network before play().
   if(this.lastStatus==='failed'){try{await this.renew();if(this.closed)return;if(this.video.error){this.video.src=this.source;this.video.load();}this.blocked=false;this.lastStatus=null;this.sync(true);}catch(_){}return;}
   if(this.state&&(this.state.playback.status!=='playing'||RoomVideoTimeline.position(this.state.playback,this.state.asset.durationMs,this.clock())>=this.state.asset.durationMs)){this.blocked=false;this.sync(true);return;}
   const playing=this.video.play();this.blocked=false;
   try{await playing;await this.renew();this.sync(true);}catch(_){this.blocked=true;this.report('blocked');}
  }
  mount(container){
   const box=this.box=document.createElement('div');box.className='presentation-video-local';
   const enable=this.enable=document.createElement('button');enable.type='button';enable.className='ui-button';enable.textContent=text('enable');enable.onclick=()=>this.unlock();enable.hidden=true;
   const label=document.createElement('label'),caption=this.caption=document.createElement('span');caption.textContent=text('volume');label.append(caption);
   const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='1';volume.step='.05';volume.value=String(this.video.volume);volume.setAttribute('aria-label',text('volume'));
   this.volumeControl=volume;volume.oninput=()=>{this.video.volume=Number(volume.value);this.video.muted=this.video.volume===0;try{localStorage.setItem('roomVideoVolume',volume.value);}catch(_){};};label.append(volume);
   const time=this.time=document.createElement('output');time.setAttribute('aria-live','off');time.setAttribute('aria-label',text('time'));
   const message=this.message=document.createElement('span');message.setAttribute('role','status');box.append(enable,label,time,message);container.append(box);
  }
  localize(){const set=(n,v)=>{if(n&&n.textContent!==v)n.textContent=v;};set(this.enable,text(this.lastStatus==='failed'?'retry':'enable'));set(this.caption,text('volume'));if(this.lastStatus)set(this.message,text(this.lastStatus));this.volumeControl?.setAttribute('aria-label',text('volume'));this.time?.setAttribute('aria-label',text('time'));}
  progress(){if(!this.time||!this.state)return;const seconds=ms=>Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0');this.time.textContent=seconds(RoomVideoTimeline.position(this.state.playback,this.state.asset.durationMs,this.clock()))+' / '+seconds(this.state.asset.durationMs);}
  draw(){if(!this.closed&&this.view&&this.video.readyState>=2&&this.video.videoWidth)this.view.draw(this.video);}
  frame(){
   if(this.closed||document.hidden||this.frameId!==undefined)return;
   if(this.video.requestVideoFrameCallback)this.frameId=this.video.requestVideoFrameCallback(()=>{this.frameId=undefined;this.draw();this.frame();});
   else this.frameId=requestAnimationFrame(time=>{this.frameId=undefined;if(!this.lastFrame||time-this.lastFrame>=33){this.draw();this.lastFrame=time;}this.frame();});
  }
  cancelFrame(){if(this.frameId===undefined)return;if(this.video.cancelVideoFrameCallback)this.video.cancelVideoFrameCallback(this.frameId);else cancelAnimationFrame(this.frameId);this.frameId=undefined;}
  dispose(){if(this.closed)return;this.closed=true;this.controller.abort();clearInterval(this.tick);clearInterval(this.renewal);this.cancelFrame();this.video.pause();this.video.removeAttribute('src');this.video.load();this.video.remove();this.box?.remove();this.headers=null;this.state=null;}
 }
 window.RoomVideoPlayback=RoomVideoPlayback;
})();
