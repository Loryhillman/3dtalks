/** Native meeting dialogs; roster and microphone lifetimes belong to their services. */
(() => {
  if(!window.MeetingUI?.active)return;
  let tools, rosterButton, soundButton, current, unsubscribe, stopped=false;
  const t=(key,params)=>params?window.i18n.tp('meetingControls.'+key,params):window.i18n.t('meetingControls.'+key);
  const text=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const node=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;};
  const button=(value,action,cls='')=>{const n=node('button','ui-button '+cls,value);n.type='button';n.onclick=action;return n;};
  function finish(session,restore=true){
    if(session.finished)return;session.finished=true;
    session.cleanup?.();session.dialog.remove();
    if(current===session)current=null;
    if(restore&&!stopped&&session.trigger?.isConnected&&!session.trigger.disabled)session.trigger.focus({preventScroll:true});
  }
  function close(restore=true){if(!current)return;const session=current;session.dialog.close();finish(session,restore);}
  function shell(kind,trigger){
    close(false);if(stopped)return;
    const dialog=node('dialog','meeting-ui meeting-room-dialog');dialog.dataset.kind=kind;
    const header=node('div','meeting-room-header'),title=node('h2'),body=node('div','meeting-room-body');
    title.id='meeting-room-panel-title';dialog.setAttribute('aria-labelledby',title.id);
    body.tabIndex=0;body.setAttribute('role','region');body.setAttribute('aria-labelledby',title.id);
    const dismiss=button('',()=>close(), 'ui-button--ghost meeting-room-close');dismiss.autofocus=true;
    const icon=node('img');icon.src='/icons/lucide/x.svg';icon.alt='';icon.width=icon.height=20;dismiss.append(icon);
    header.append(title,dismiss);dialog.append(header,body);
    const session=current={dialog,body,title,dismiss,trigger,finished:false};
    session.translate=()=>{text(title,t(kind));dismiss.setAttribute('aria-label',t('close'));};
    session.translate();
    dialog.addEventListener('close',()=>finish(session),{once:true});
    dialog.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const focus=[...dialog.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
      const first=focus[0],last=focus.at(-1);
      if(event.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){event.preventDefault();first?.focus();}
    });
    for(const event of ['pointerdown','pointerup','click','keydown','keyup','wheel','touchstart','touchmove'])dialog.addEventListener(event,e=>e.stopPropagation());
    document.body.append(dialog);dialog.showModal();return session;
  }
  function openRoster(){
    const s=shell('participants',rosterButton);if(!s)return;
    const status=node('p','meeting-room-status');status.setAttribute('role','status');
    const count=node('p','meeting-room-count'),list=node('ul','meeting-room-members');list.setAttribute('aria-labelledby',s.title.id);
    s.body.append(status,count,list);
    function render(state){
      if(s.finished)return;
      s.translate();text(status,t(state.connection==='connected'?'connected':state.connection==='reconnecting'?'reconnecting':'connecting'));
      status.classList.toggle('is-stale',state.connection!=='connected');
      text(count,state.connection==='connecting'?t('waitingRoster'):t('memberCount',{count:state.members.length}));
      list.replaceChildren(...state.members.map(member=>{
        const row=node('li','meeting-member'),identity=node('div','meeting-member-identity');
        identity.append(node('strong','meeting-member-name',member.name||t('unnamed')));
        if(member.self)identity.append(node('span','meeting-member-self',t('you')));
        const voice=node('span','meeting-member-audio',t(state.connection!=='connected'?'unknown':member.playing?'playing':member.recording?(member.self?'youRecording':'recording'):'present'));
        row.classList.toggle('is-active',state.connection==='connected'&&(member.recording||member.playing));row.append(identity,voice);return row;
      }));
    }
    const off=window.MeetingRoster.subscribe(render);s.cleanup=off;s.refresh=()=>render(window.MeetingRoster.getState());
  }
  function openAudio(){
    const s=shell('sound',soundButton);if(!s)return;
    const hint=node('p','meeting-room-hint'),label=node('label','meeting-room-field'),labelText=node('span');
    const select=node('select');select.id='meeting-microphone-select';label.htmlFor=select.id;label.append(labelText,select);
    const deviceHint=node('p','meeting-room-hint');deviceHint.id='meeting-device-hint';select.setAttribute('aria-describedby',deviceHint.id);
    const status=node('p','meeting-room-status');status.setAttribute('role','status');
    const meter=node('progress','meeting-microphone-level');meter.max=100;meter.value=0;
    const test=button('',()=>{const state=window.MeetingAudioSettings.getState();if(['requesting','testing'].includes(state.phase))window.MeetingAudioSettings.stopTest();else window.MeetingAudioSettings.beginTest();},'ui-button--primary');
    const playback=node('label','meeting-playback-control'),check=node('input'),checkText=node('span');check.type='checkbox';playback.append(check,checkText);
    check.onchange=()=>{if(check.checked!==!window.voiceChat.muted)window.voiceChat.toggleMute();};
    select.onchange=()=>{window.MeetingAudioSettings.selectDevice(select.value);};
    s.body.append(hint,label,deviceHint,status,meter,test,playback);
    let devices=[],deviceError=false,previousPhase;
    function render(state){
      if(s.finished)return;
      s.translate();text(hint,t('clipHint'));text(labelText,t('microphone'));text(checkText,t('hearParticipants'));
      meter.setAttribute('aria-label',t('level'));meter.value=state.level;meter.hidden=state.phase!=='testing';
      check.checked=!window.voiceChat?.muted;
      select.disabled=state.busy||['requesting','testing'].includes(state.phase);
      const missing=!!state.deviceId&&!devices.some(d=>d.id===state.deviceId);
      text(deviceHint,t(state.busy?'recordingBusy':deviceError?'devicesFailed':missing?'deviceGone':'localHint'));
      deviceHint.classList.toggle('is-error',deviceError||missing);
      const phaseKey=state.phase==='error'?state.error:state.phase==='requesting'?'requesting':state.phase==='testing'?'testing':'idle';
      text(status,t(phaseKey));status.classList.toggle('is-error',state.phase==='error');status.classList.toggle('is-neutral',!['testing','error'].includes(state.phase));
      text(test,t(['requesting','testing'].includes(state.phase)?'stopTest':'testMicrophone'));test.disabled=state.busy;
      const options=[node('option','',t('defaultDevice'))];options[0].value='';
      devices.forEach((device,index)=>{const option=node('option','',device.label||t('deviceNumber',{number:index+1}));option.value=device.id;options.push(option);});
      if(missing){const option=node('option','',t('selectedUnavailable'));option.value=state.deviceId;options.push(option);}
      const signature=JSON.stringify(options.map(n=>[n.value,n.textContent]));
      if(select.dataset.options!==signature){select.replaceChildren(...options);select.dataset.options=signature;}
      select.value=state.deviceId;
      const refreshLabels=state.phase==='testing'&&previousPhase!=='testing';previousPhase=state.phase;
      if(refreshLabels)refreshDevices();
    }
    async function refreshDevices(){
      try{const found=await window.MeetingAudioSettings.devices();if(s.finished)return;devices=found;deviceError=false;}
      catch(_){if(s.finished)return;deviceError=true;}
      render(window.MeetingAudioSettings.getState());
    }
    const changed=()=>{window.MeetingAudioSettings.stopTest();refreshDevices();};
    navigator.mediaDevices?.addEventListener?.('devicechange',changed);
    const off=window.MeetingAudioSettings.subscribe(render);
    const observer=new MutationObserver(()=>render(window.MeetingAudioSettings.getState()));
    const mic=document.getElementById('skill-voice-btn');if(mic)observer.observe(mic,{attributes:true,attributeFilter:['class']});
    s.cleanup=()=>{off();observer.disconnect();navigator.mediaDevices?.removeEventListener?.('devicechange',changed);window.MeetingAudioSettings.stopTest();};
    s.refresh=()=>render(window.MeetingAudioSettings.getState());refreshDevices();
  }
  function refreshTools(){
    if(stopped||!tools)return;
    const state=window.MeetingRoster.getState();
    text(rosterButton,t('participantsButton',{count:state.connection==='connecting'?'—':state.members.length}));
    rosterButton.title=t(state.connection==='reconnecting'?'reconnecting':'participants');text(soundButton,t('sound'));
  }
  function refresh(){refreshTools();if(!stopped)current?.refresh?.();}
  window.MeetingRoomPanel={
    mount(toolbar){
      if(stopped||tools||!window.MeetingRoster||!window.MeetingAudioSettings)return;
      tools=node('div','meeting-room-tools');rosterButton=button('',openRoster);rosterButton.id='meeting-participants';
      soundButton=button('',openAudio);soundButton.id='meeting-sound-settings';tools.append(rosterButton,soundButton);toolbar.append(tools);
      document.getElementById('skill-voice-btn')?.classList.toggle('voice-muted',!!window.voiceChat?.muted);
      unsubscribe=window.MeetingRoster.subscribe(refreshTools);window.i18n?.onLocaleChange(refresh);refresh();
    },
    close,
    dispose(){if(stopped)return;stopped=true;close(false);unsubscribe?.();tools?.remove();window.MeetingAudioSettings?.stop();}
  };
})();
