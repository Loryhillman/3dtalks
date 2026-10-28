/** Local microphone preferences and a bounded, non-transmitted level test. */
(() => {
  if(!window.MeetingUI?.active)return;
  const listeners=new Set(), key='meetingMicrophoneDevice';
  let preferred='', phase='idle', error=null, level=0, generation=0, stopped=false;
  let stream=null, context=null, source=null, analyser=null, meter=null, deadline=null;
  try{preferred=localStorage.getItem(key)||'';if(preferred.length>1024)preferred='';}catch(_){}
  const busy=()=>!!(window.voiceChat?.wantRecording||window.voiceChat?.recording||window.voiceChat?.recorder);
  const state=()=>Object.freeze({deviceId:preferred,phase,error,level,busy:busy()});
  const emit=()=>{const value=state();for(const fn of listeners)fn(value);};
  const code=e=>({NotAllowedError:'permissionDenied',SecurityError:'permissionDenied',NotFoundError:'noDevice',
    NotReadableError:'deviceBusy',OverconstrainedError:'deviceGone'}[e?.name]||'testFailed');
  function stopTest(reason=null){
    ++generation;clearInterval(meter);clearTimeout(deadline);meter=deadline=null;
    if(stream){for(const track of stream.getTracks()){track.onended=null;track.stop();}stream=null;}
    source?.disconnect();analyser?.disconnect();source=analyser=null;
    if(context){context.close().catch(()=>{});context=null;}
    level=0;error=reason;phase=reason?'error':'idle';emit();
  }
  function constraints(){return {audio:{echoCancellation:true,noiseSuppression:true,...(preferred?{deviceId:{exact:preferred}}:{})}};}
  async function beginTest(){
    if(stopped)return;
    if(busy()){error='recordingBusy';emit();return;}
    stopTest();
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){error='unsupported';phase='error';emit();return;}
    const ticket=++generation;phase='requesting';emit();
    deadline=setTimeout(()=>{if(ticket===generation)stopTest('permissionTimeout');},15000);
    let acquired;
    try{
      acquired=await navigator.mediaDevices.getUserMedia(constraints());
      if(stopped||ticket!==generation){for(const track of acquired.getTracks())track.stop();return;}
      clearTimeout(deadline);stream=acquired;
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(!Audio)throw Error('AudioContext unavailable');
      context=new Audio();await context.resume();
      if(stopped||ticket!==generation)return;
      source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=256;source.connect(analyser);
      const samples=new Uint8Array(analyser.fftSize);
      for(const track of stream.getTracks())track.onended=()=>{if(ticket===generation)stopTest('deviceGone');};
      phase='testing';window.voiceChat?.resetMicrophoneError?.();emit();
      meter=setInterval(()=>{
        if(stopped||ticket!==generation)return;
        analyser.getByteTimeDomainData(samples);let energy=0;
        for(const value of samples)energy+=((value-128)/128)**2;
        level=Math.min(100,Math.round(Math.sqrt(energy/samples.length)*300));emit();
      },100);
      deadline=setTimeout(()=>{if(ticket===generation)stopTest();},30000);
    }catch(e){
      if(stopped||ticket!==generation){if(acquired)for(const track of acquired.getTracks())if(track.readyState!=='ended')track.stop();return;}
      stopTest(code(e));
    }
  }
  function hidden(){if(document.hidden)stopTest();}
  document.addEventListener('visibilitychange',hidden);
  window.MeetingAudioSettings={
    getState:state,constraints,beginTest,stopTest,busy,refresh:emit,
    subscribe(fn){listeners.add(fn);fn(state());return ()=>listeners.delete(fn);},
    async devices(){
      if(!navigator.mediaDevices?.enumerateDevices)return [];
      return (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'&&d.deviceId).slice(0,32).map(d=>({id:d.deviceId,label:d.label||''}));
    },
    selectDevice(id){
      if(stopped||busy()||typeof id!=='string'||id.length>1024)return false;
      stopTest();preferred=id;
      try{if(id)localStorage.setItem(key,id);else localStorage.removeItem(key);}catch(_){}
      window.voiceChat?.resetMicrophoneError?.();emit();return true;
    },
    stop(){if(stopped)return;stopped=true;stopTest();listeners.clear();document.removeEventListener('visibilitychange',hidden);}
  };
})();
