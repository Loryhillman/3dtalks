// Private, bounded microphone rehearsal. No upload, localStorage or live monitoring.
(() => {
  window.AvatarVoicePreview = {
    create({onState,onMouth}) {
      let phase='empty', error='', clip=null, signal=null, context=null, source=null;
      let capture=null, deadline=null, frame=null, generation=0, disposed=false;
      const state=()=>({phase,error,duration:clip?.duration||0});
      const emit=()=>onState(state());
      function release() {
        clearTimeout(deadline);deadline=null;
        const old=capture;capture=null;
        if(!old)return;
        old.recorder.ondataavailable=old.recorder.onstop=old.recorder.onerror=null;
        try{if(old.recorder.state!=='inactive')old.recorder.stop();}catch(_){}
        for(const track of old.stream.getTracks()){track.onended=null;track.stop();}
        old.chunks.length=0;
      }
      function stop() {
        ++generation;release();cancelAnimationFrame(frame);frame=null;
        const old=source;source=null;
        if(old){old.onended=null;try{old.stop();}catch(_){}old.disconnect();}
        onMouth(0);phase=disposed?'disposed':clip?'ready':'empty';error='';emit();
      }
      function fail(code,ticket) {
        if(disposed||ticket!==generation)return;
        stop();phase='error';error=code;emit();
      }
      async function record() {
        if(disposed||['requesting','recording','preparing'].includes(phase))return;
        stop();clip=signal=null;phase='requesting';emit();const ticket=generation;
        if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){fail('voiceUnsupported',ticket);return;}
        deadline=setTimeout(()=>fail('voiceTimeout',ticket),15000);
        let stream;
        try{
          stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
          if(disposed||ticket!==generation||document.hidden){stream.getTracks().forEach(track=>track.stop());if(ticket===generation&&!disposed)stop();return;}
          clearTimeout(deadline);
          const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(type=>MediaRecorder.isTypeSupported(type));
          const recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:64000});
          const current=capture={stream,recorder,chunks:[],bytes:0,ticket};
          recorder.ondataavailable=event=>{
            if(ticket!==generation||capture!==current)return;
            current.bytes+=event.data.size;
            if(current.bytes>3*1048576){fail('voiceFailed',ticket);return;}
            if(event.data.size)current.chunks.push(event.data);
          };
          recorder.onerror=()=>fail('voiceFailed',ticket);
          recorder.onstop=async()=>{
            if(disposed||ticket!==generation||capture!==current)return;
            try{
              const blob=new Blob(current.chunks,{type:recorder.mimeType});release();
              if(!blob.size)throw Error('empty');
              const bytes=await blob.arrayBuffer();if(disposed||ticket!==generation)return;
              const Audio=window.AudioContext||window.webkitAudioContext;context ||= new Audio();
              const decoded=await context.decodeAudioData(bytes);if(disposed||ticket!==generation)return;
              if(!decoded.length||decoded.duration>16)throw Error('invalid');
              signal=AvatarAudioSignal.envelope({sampleRate:decoded.sampleRate,duration:decoded.duration,
                channels:Array.from({length:decoded.numberOfChannels},(_,i)=>decoded.getChannelData(i))});
              clip=decoded;phase='ready';emit();
            }catch(_){fail('voiceFailed',ticket);}
          };
          for(const track of stream.getTracks())track.onended=()=>fail('voiceFailed',ticket);
          recorder.start(250);phase='recording';emit();deadline=setTimeout(finish,15000);
        }catch(e){
          stream?.getTracks().forEach(track=>track.stop());
          fail(e.name==='NotAllowedError'?'voiceDenied':'voiceFailed',ticket);
        }
      }
      function finish() {
        if(phase!=='recording'||!capture)return;
        phase='preparing';emit();clearTimeout(deadline);
        try{
          capture.recorder.stop();
          for(const track of capture.stream.getTracks()){track.onended=null;track.stop();}
        }catch(_){fail('voiceFailed',generation);}
      }
      async function play() {
        if(disposed||!clip||['requesting','recording','preparing','starting','playing'].includes(phase))return;
        stop();const ticket=generation;phase='starting';emit();
        try{
          await context.resume();if(disposed||ticket!==generation)return;
          if(document.hidden||context.state!=='running'){stop();return;}
          source=context.createBufferSource();source.buffer=clip;source.connect(context.destination);
          const startedAt=context.currentTime;
          source.onended=()=>{if(ticket===generation)stop();};
          source.start(startedAt);phase='playing';emit();
          function tick(){
            if(disposed||ticket!==generation||phase!=='playing')return;
            onMouth(context.state==='running'?AvatarAudioSignal.at(signal,context.currentTime-startedAt):0);
            frame=requestAnimationFrame(tick);
          }
          frame=requestAnimationFrame(tick);
        }catch(_){fail('voiceFailed',ticket);}
      }
      const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);
      return {record,finish,play,stop,getState:state,dispose(){
        if(disposed)return;disposed=true;stop();clip=signal=null;document.removeEventListener('visibilitychange',hidden);
        const old=context;context=null;old?.close().catch(()=>{});
      }};
    }
  };
})();
