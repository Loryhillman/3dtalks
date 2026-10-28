/** Current socket/session only. Metadata may precede the scene; files never do. */
(() => {
  if(location.pathname!=='/play')return;
  const P=RoomPresentationProtocol,t=key=>{
    const value=window.i18n?.t('roomPresentation.'+key);return value&&value!=='roomPresentation.'+key?value:window.i18n?.t('roomPresentation.commandFailed')||key;
  };
  let session=null,state=null,view=null,renderer=null,loadedKey=null,loading=null,draw=0,joined=false,closed=false,syncing=false;
  let videoPlayer=null,clock=null,hasV2=false,negotiating=false,features={videoUpload:false,videoPlayback:false},videoKey=null;
  const videoActive=()=>state?.asset?.kind==='video';
  const timeMs=()=>videoActive()?RoomVideoTimeline.position(state.playback,state.asset.durationMs,clock?.now()??Date.now()):0;
  let previewFrame=null;
  let pending=null,syncTimer,capTimer,manage,refresh,status,controlsBar,panel,panelController,errorText='';
  const room=()=>window.ACTIVE_ROOM;
  const setText=(node,value)=>{if(node.textContent!==value)node.textContent=value;};
  const connected=()=>!closed&&joined&&window.WSClient?.isConnected();
  const key=()=>session&&state?.asset?session.token+':'+state.asset.id:null;
  const send=(type,payload)=>{if(!connected())return false;WSClient.ws.send(JSON.stringify({type,payload}));return true;};
  function closePanel(){panelController?.abort();panel?.close();}
  function updatePanelPreview(){
    if(!panel)return;
    const frame=panel.querySelector('.presentation-slide-preview'),canvas=frame.querySelector('canvas'),message=frame.querySelector('p');
    const slides=!!state?.asset&&!videoActive();panel.dataset.slidePreview=String(slides);frame.hidden=!slides;
    const ready=slides&&previewFrame?.key===key()&&previewFrame.pageIndex===state.pageIndex;
    canvas.hidden=!ready;message.hidden=!!ready;
    if(!ready){canvas.width=canvas.height=0;delete canvas.presentationFrame;message.textContent=errorText||t('loading');return;}
    if(canvas.presentationFrame!==previewFrame){
      canvas.width=previewFrame.canvas.width;canvas.height=previewFrame.canvas.height;
      canvas.getContext('2d').drawImage(previewFrame.canvas,0,0);canvas.presentationFrame=previewFrame;
    }
    canvas.setAttribute('aria-label',state.asset.name+' · '+t('slide')+' '+(state.pageIndex+1)+' / '+state.asset.pageCount);
  }
  function controls(){
    if(manage){manage.style.display=session?.canControl?'':'none';manage.disabled=!connected()||syncing||!!pending;}
    if(refresh)refresh.disabled=!connected()||syncing;
    if(status)setText(status,errorText||(!session?t('connecting'):state?.asset?state.asset.name+(videoActive()?' · '+'MP4':' · '+(state.pageIndex+1)+' / '+state.asset.pageCount):t('idle')));
    if(panel){
      updatePanelPreview();
      setText(panel.querySelector('[data-current]'),state?.asset?state.asset.name:t('idle'));
      setText(panel.querySelector('[data-page]'),state?.asset?(videoActive()?'MP4':t('slide')+' '+(state.pageIndex+1)+' / '+state.asset.pageCount):'');
      const feedback=panel.querySelector('[data-feedback]');setText(feedback,errorText||(pending?t('pending'):syncing?t('syncing'):''));feedback.hidden=!feedback.textContent;feedback.classList.toggle('is-error',!!errorText);
      panel.querySelector('[data-commands]').setAttribute('aria-busy',String(!!pending));
      panel.querySelector('select').disabled=panel.dataset.libraryState!=='ready'||!!pending||syncing;
      for(const button of panel.querySelectorAll('[data-command]'))button.disabled=!connected()||!session?.canControl||syncing||!!pending||!view||!state;
      const previous=panel.querySelector('[data-command="previous"]'),next=panel.querySelector('[data-command="next"]');
      previous.closest('.presentation-paging').hidden=videoActive();
      panel.querySelector('.presentation-shortcuts').hidden=videoActive();
      const videoControls=panel.querySelector('.presentation-video-commands');
      if(videoControls){videoControls.hidden=!videoActive();const play=videoControls.querySelector('button');play.textContent=window.i18n.t('roomVideo.'+(state?.playback?.status==='playing'&&timeMs()<state.asset.durationMs?'pause':'play'));
        const seek=videoControls.querySelector('input');seek.disabled=!!pending||syncing||!connected();if(videoActive()){const format=ms=>Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0');const position=format(timeMs())+' / '+format(state.asset.durationMs);setText(videoControls.querySelector('output'),position);seek.setAttribute('aria-valuetext',position);seek.max=state.asset.durationMs;if(document.activeElement!==seek)seek.value=Math.round(timeMs());}}
      previous.disabled ||= !state?.asset||state.pageIndex===0;next.disabled ||= !state?.asset||state.pageIndex>=state.asset.pageCount-1;
      panel.querySelector('[data-command="show"]').disabled ||= panel.dataset.libraryState!=='ready'||!panel.querySelector('select').options.length;
      panel.querySelector('[data-command="stop"]').disabled ||= !state?.asset;
    }
  }
  function report(code){errorText=t(code);controls();}
  function requestSnapshot(){
    if(!connected()||!view||syncing)return;
    syncing=true;controls();
    send('ROOM_PRESENTATION_GET_STATE',{requestId:P.requestId()});
    clearTimeout(syncTimer);syncTimer=setTimeout(()=>{syncing=false;report('syncFailed');},10000);
  }
  function clearDocument(){previewFrame=null;videoPlayer?.dispose();videoPlayer=null;videoKey=null;window.RoomScreenPreview?.refreshVideoControls?.();++draw;loadedKey=null;loading=null;renderer?.clear();view?.reset();}
  function disconnect(){
    joined=false;session=state=null;hasV2=negotiating=false;clearTimeout(capTimer);clock?.close();clock=null;features={videoUpload:false,videoPlayback:false};syncing=false;clearTimeout(syncTimer);clearDocument();closePanel();
    window.RoomScreenPreview?.close();window.RoomMaterials?.close();
    if(pending){clearTimeout(pending.timer);pending.reject(Object.assign(Error(t('disconnected')),{code:'disconnected'}));pending=null;}
    errorText='';controls();
  }
  function acceptState(value){
    if(!(value?.protocolVersion===2?window.RoomPresentationProtocolV2?.state(value):P.state(value))||!session||value.roomId!==room()?.id||value.epoch!==session.epoch)return;
    if(state&&BigInt(value.revision)<BigInt(state.revision))return;
    const duplicate=state?.revision===value.revision&&state?.protocolVersion===value.protocolVersion&&state?.asset?.id===value.asset?.id&&!syncing;
    if(previewFrame&&(previewFrame.key!==key()||previewFrame.pageIndex!==value.pageIndex||state?.asset?.id!==value.asset?.id))previewFrame=null;
    state=value;syncing=false;clearTimeout(syncTimer);errorText='';controls();
    if(!duplicate)renderLatest();
  }
  function renderLatest(){
    if(!view||!renderer||!session||!state||closed)return;
    const currentView=view,currentRenderer=renderer,currentKey=key(),ticket=++draw;
    if(state.asset?.kind==='video'){
      renderer.clear();loading=null;loadedKey=null;
      if(!features.videoPlayback||!window.RoomVideoPlayback){view.message(window.i18n.t('roomVideo.unavailable'));return;}
      if(videoKey===currentKey&&videoPlayer){videoPlayer.update(state);return;}
      videoPlayer?.dispose();videoKey=currentKey;
      const player=videoPlayer=new RoomVideoPlayback({view,clock:()=>clock?.now()??Date.now(),status:()=>controls()});
      player.mount(controlsBar);window.RoomScreenPreview?.refreshVideoControls?.();player.update(state);view.message(t('loading'));
      player.load({grantUrl:'/api/rooms/'+encodeURIComponent(room().slug)+'/presentation/materials/'+state.asset.id+'/video/grant',headers:{Authorization:'Bearer '+localStorage.getItem('token'),'X-Room-Session':session.token}}).catch(e=>{if(videoPlayer===player&&e.name!=='AbortError')report('renderFailed');});
      return;
    }
    if(videoPlayer){videoPlayer.dispose();videoPlayer=null;videoKey=null;window.RoomScreenPreview?.refreshVideoControls?.();}
    if(!state.asset){loadedKey=null;loading=null;renderer.clear();view.reset();return;}
    if(currentKey!==loadedKey){
      if(loading?.key===currentKey)return;
      view.message(t('loading'));loadedKey=null;
      const task=loading={key:currentKey};
      task.promise=renderer.load({url:'/api/rooms/'+encodeURIComponent(room().slug)+'/presentation/materials/'+state.asset.id+'/content',
        kind:state.asset.kind,headers:{Authorization:'Bearer '+localStorage.getItem('token'),'X-Room-Session':session.token}});
      task.promise.then(()=>{
        if(view!==currentView||loading!==task||key()!==currentKey||closed)return;
        loading=null;loadedKey=currentKey;renderLatest();
      }).catch(error=>{
        if(view!==currentView||loading!==task||key()!==currentKey||closed)return;
        loading=null;if(error.name==='AbortError')return;
        currentView.message(t('renderFailed'));report('renderFailed');
      });return;
    }
    const render=state.asset.kind==='pdf'?renderer.page(state.pageIndex):Promise.resolve(renderer.canvas);
    render.then(()=>{
      if(view===currentView&&renderer===currentRenderer&&ticket===draw&&key()===currentKey&&!closed){currentView.draw(renderer.canvas);previewFrame={key:currentKey,pageIndex:state.pageIndex,canvas:renderer.canvas};errorText='';controls();}
    }).catch(error=>{
      if(ticket!==draw||view!==currentView||['AbortError','RenderingCancelledException'].includes(error.name))return;
      currentView.message(t('renderFailed'));report('renderFailed');
    });
  }
  function command(command){
    if(!connected()||!session?.canControl||!state||!view||pending||syncing)return Promise.reject(Object.assign(Error(t('disconnected')),{code:'disconnected'}));
    errorText='';const requestId=P.requestId();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(pending?.requestId!==requestId)return;pending=null;report('commandUnconfirmed');requestSnapshot();reject(Object.assign(Error(t('commandUnconfirmed')),{code:'commandUnconfirmed'}));},10000);
      pending={requestId,resolve,reject,timer};controls();
      send('ROOM_PRESENTATION_COMMAND',{...(hasV2?{protocolVersion:2}:{}),requestId,expectedEpoch:state.epoch,expectedRevision:state.revision,command});
    });
  }
  function openPanel(trigger){
    if(!session?.canControl||!view)return;closePanel();
    const dialog=panel=document.createElement('dialog');dialog.className='meeting-ui room-presentation-dialog';dialog.setAttribute('aria-labelledby','presentation-heading');
    const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text)n.textContent=text;return n;};
    const header=node('div','presentation-header'),titles=node('div');
    const heading=node('h2','',t('title'));heading.id='presentation-heading';titles.append(heading,node('p','presentation-room',room().name||''));
    const current=node('p','presentation-current');current.dataset.current='';
    const currentPage=node('span','presentation-page');currentPage.dataset.page='';
    const feedback=node('p','presentation-feedback');feedback.dataset.feedback='';feedback.setAttribute('role','status');feedback.hidden=true;
    const select=document.createElement('select');select.setAttribute('aria-label',t('material'));select.id='presentation-material';
    const label=node('label','presentation-field',t('material')),selectedName=node('span','presentation-selected');selectedName.id='presentation-selected';label.append(select,selectedName);select.onchange=()=>{selectedName.textContent=select.selectedOptions[0]?.textContent||'';};
    const button=(text,fn,kind,variant='')=>{const b=node('button','ui-button'+(variant?' ui-button--'+variant:''),t(text));b.type='button';if(kind)b.dataset.command=kind;
      b.onclick=()=>Promise.resolve().then(fn).catch(e=>{if(panel===dialog)report(e.code||'commandFailed');});return b;};
    const close=button('close',()=>dialog.close(),null,'ghost');close.autofocus=true;close.classList.add('presentation-close');close.setAttribute('aria-label',t('close'));close.textContent='';
    const icon=node('img');icon.src='/icons/lucide/x.svg';icon.alt='';icon.width=icon.height=20;close.append(icon);header.append(titles,close);
    const show=button('show',()=>command({type:'show',assetId:select.value}),'show','primary');
    const previous=button('previous',()=>command({type:'page',pageIndex:state.pageIndex-1}),'previous');
    const next=button('next',()=>command({type:'page',pageIndex:state.pageIndex+1}),'next');
    previous.setAttribute('aria-keyshortcuts','ArrowLeft PageUp');next.setAttribute('aria-keyshortcuts','ArrowRight PageDown');
    const stop=button('stop',()=>command({type:'stop'}),'stop','destructive');
    const library=button('library',()=>{dialog.close();RoomMaterials.open(room(),trigger);},null,'ghost');
    const body=node('div','presentation-body'),now=node('div','presentation-now');now.setAttribute('role','status');now.setAttribute('aria-atomic','true');now.append(node('h3','',t('nowShowing')),current,currentPage);
    const libraryState=node('p','presentation-library-state');libraryState.setAttribute('role','status');libraryState.id='presentation-library-state';select.setAttribute('aria-describedby',libraryState.id+' '+selectedName.id);
    const retry=button('retryLibrary',()=>loadMaterials());retry.hidden=true;retry.dataset.libraryRetry='';
    const stage=node('div','presentation-stage'),options=node('div','presentation-options');
    const preview=node('div','presentation-slide-preview'),previewCanvas=node('canvas'),previewMessage=node('p','presentation-hint');preview.hidden=true;previewCanvas.hidden=true;previewCanvas.setAttribute('role','img');preview.append(previewCanvas,previewMessage);
    const commands=node('div','presentation-commands');commands.dataset.commands='';
    const paging=node('div','presentation-paging');paging.append(previous,next);
    const shortcutHint=node('p','presentation-hint presentation-shortcuts',t('keyboardHint'));shortcutHint.id='presentation-shortcuts';
    paging.setAttribute('aria-describedby',shortcutHint.id);const videoCommands=node('div','presentation-video-commands');videoCommands.hidden=true;
    const play=button('show',()=>command({type:state.playback.status==='playing'&&timeMs()<state.asset.durationMs?'pause':'play'}),'video-play');
    const seek=node('input');seek.type='range';seek.min='0';seek.step='100';seek.setAttribute('aria-label',window.i18n.t('roomVideo.seek'));seek.onchange=()=>command({type:'seek',positionMs:Number(seek.value)}).catch(e=>report(e.code||'commandFailed'));
    const videoTime=node('output');videoTime.setAttribute('aria-label',window.i18n.t('roomVideo.time'));videoTime.setAttribute('aria-live','off');videoCommands.append(play,seek,videoTime);commands.append(show,videoCommands,stop);
    stage.append(now,preview,paging,shortcutHint);
    options.append(node('p','presentation-hint',t('sharedHint')),label,libraryState,retry,commands,feedback,library);
    body.append(stage,options);
    dialog.append(header,body);
    panelController=new AbortController();const signal=panelController.signal;
    dialog.addEventListener('close',()=>{previewCanvas.width=previewCanvas.height=0;delete previewCanvas.presentationFrame;dialog.remove();if(panel===dialog){panel=null;panelController?.abort();panelController=null;const focus=trigger?.isConnected&&!trigger.disabled&&trigger.getClientRects().length?trigger:document.querySelector('#meeting-screen-preview, #meeting-toolbar button:not(:disabled)');focus?.focus();}},{once:true});
    for(const type of ['pointerdown','pointerup','click','keydown','keyup','wheel','touchstart','touchmove'])dialog.addEventListener(type,e=>e.stopPropagation());
    dialog.addEventListener('keydown',e=>{
      const direction=['ArrowLeft','PageUp'].includes(e.key)?previous:['ArrowRight','PageDown'].includes(e.key)?next:null;
      if(!direction||!dialog.open||signal.aborted||!dialog.contains(document.activeElement)||e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||e.isComposing||e.keyCode===229)return;
      const editing=n=>n?.isContentEditable||n?.closest?.('input,textarea,select,[role="textbox"],[role="slider"],[role="listbox"]');
      if(editing(e.target)||editing(document.activeElement))return;
      if(!connected()||!session?.canControl)return;
      e.preventDefault();
      if(!e.repeat&&!direction.disabled)direction.click();
    });
    dialog.addEventListener('keydown',e=>{if(e.key==='Tab'){
      const nodes=[...dialog.querySelectorAll('button,select,input')].filter(n=>!n.disabled&&n.getClientRects().length),first=nodes[0],last=nodes.at(-1);
      if(!nodes.includes(document.activeElement)||!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    }});
    async function loadMaterials(){
      if(signal.aborted||panel!==dialog||dialog.dataset.libraryState==='loading')return;
      dialog.dataset.libraryState='loading';libraryState.textContent=t('libraryLoading');retry.hidden=true;select.replaceChildren();selectedName.textContent='';controls();
      try{
        const response=await fetch('/api/my/rooms/'+room().id+'/materials'+(hasV2&&features.videoUpload?'?protocolVersion=2':''),{headers:{Authorization:'Bearer '+localStorage.getItem('token')},signal,cache:'no-store'});
        if(!response.ok){if([401,403].includes(response.status))dialog.close();throw Error('libraryFailed');}
        const data=await response.json();if(panel!==dialog||signal.aborted||!dialog.open)return;
        for(const asset of data.materials.filter(a=>a.state==='ready')){const option=document.createElement('option');option.value=asset.id;option.textContent=asset.name;select.append(option);}
        if(state?.asset&&[...select.options].some(o=>o.value===state.asset.id))select.value=state.asset.id;
        selectedName.textContent=select.selectedOptions[0]?.textContent||'';dialog.dataset.libraryState=select.options.length?'ready':'empty';libraryState.textContent=select.options.length?'':t('empty');
      }catch(e){
        if(e.name==='AbortError'||panel!==dialog||signal.aborted||!dialog.open)return;
        dialog.dataset.libraryState='error';libraryState.textContent=t('libraryFailed');retry.hidden=false;
      }finally{if(panel===dialog&&!signal.aborted)controls();}
    }
    document.body.append(dialog);dialog.showModal();loadMaterials();
  }

  function attach(value){
    if(closed)return;detach();view=value;renderer=new RoomMediaRenderer(document.createElement('canvas'));
    const target=document.querySelector('#meeting-toolbar .meeting-actions');
    if(target){
      controlsBar=document.createElement('div');controlsBar.id='room-presentation-controls';
      manage=document.createElement('button');manage.type='button';manage.id='presentation-manage';manage.className='ui-button';manage.dataset.i18n='roomPresentation.manage';manage.textContent=t('manage');manage.onclick=()=>openPanel(manage);
      refresh=document.createElement('button');refresh.type='button';refresh.id='presentation-refresh';refresh.className='ui-button ui-button--ghost';refresh.dataset.i18n='roomPresentation.refresh';refresh.textContent=t('refresh');refresh.onclick=()=>{errorText='';requestSnapshot();};
      status=document.createElement('span');status.id='presentation-status';status.setAttribute('role','status');
      for(const element of [manage,refresh,status]){element.addEventListener('pointerdown',e=>e.stopPropagation());element.addEventListener('click',e=>e.stopPropagation());controlsBar.append(element);}
      target.append(controlsBar);
    }
    controls();if(session&&state)renderLatest();else requestSnapshot();
  }
  function detach(){closePanel();clearDocument();renderer=null;view=null;controlsBar?.remove();controlsBar=manage=refresh=status=null;}
  function message(type,payload){
    if(closed)return;
    if(type==='ROOM_PRESENTATION_AVAILABLE'){
      if(window.RoomPresentationProtocolV2?.capabilities(payload)&&window.RoomVideoPlayback&&!hasV2&&!negotiating){negotiating=true;clearTimeout(capTimer);capTimer=setTimeout(()=>{negotiating=false;},5000);send('ROOM_PRESENTATION_CAPABILITIES',{protocolVersion:2});}
    }else if(type==='ROOM_PRESENTATION_CAPABILITIES_RESULT'){
      if(!window.RoomPresentationProtocolV2?.capabilitiesResult(payload))return;
      features=payload.features;hasV2=true;negotiating=false;clearTimeout(capTimer);clock?.close();clock=null;if(features.videoPlayback){clock=new RoomVideoClock(send);clock.start();}controls();
    }else if(type==='ROOM_PRESENTATION_CLOCK_RESULT'){clock?.message(payload);
    }else if(type==='ROOM_PRESENTATION_SESSION'){
      if(!P.session(payload)||payload.roomId!==room()?.id)return;
      if(session?.token!==payload.token){state=null;clearDocument();}
      session=payload;if(!session.canControl)closePanel();controls();
    }else if(type==='ROOM_PRESENTATION_STATE')acceptState(payload);
    else if(type==='ROOM_PRESENTATION_RESULT'){
      if(payload.requestId===pending?.requestId){
        const completed=pending;pending=null;clearTimeout(completed.timer);if(payload.state)acceptState(payload.state);
        if(payload.success)completed.resolve();else{completed.reject(Object.assign(Error(t(payload.code||'commandFailed')),{code:payload.code}));requestSnapshot();}
        controls();
      }else if(!payload.success&&view){syncing=false;clearTimeout(syncTimer);report(payload.code||'commandFailed');}
    }
  }
  window.RoomPresentation={attach,detach,message,disconnected:disconnect,
    borrowVideoControls(source,dialog){
      if(source!==view?.canvas||!videoPlayer?.box)return;
      const player=videoPlayer,box=player.box,parent=box.parentElement;
      dialog.insertBefore(box,dialog.lastElementChild);
      return ()=>{if(videoPlayer===player&&parent?.isConnected&&!closed)parent.append(box);};
    },
    joined(){joined=true;if(!session)requestSnapshot();},
    stop(){disconnect();closed=true;detach();}
  };
  window.i18n?.onLocaleChange(()=>controls());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')requestSnapshot();});
})();
