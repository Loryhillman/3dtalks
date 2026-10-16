/** Current socket/session only. Metadata may precede the scene; files never do. */
(() => {
  if(location.pathname!=='/play')return;
  const P=RoomPresentationProtocol,t=key=>{
    const value=window.i18n?.t('roomPresentation.'+key);return value&&value!=='roomPresentation.'+key?value:window.i18n?.t('roomPresentation.commandFailed')||key;
  };
  let session=null,state=null,view=null,renderer=null,loadedKey=null,loading=null,draw=0,joined=false,closed=false,syncing=false;
  let pending=null,syncTimer,manage,refresh,status,controlsBar,panel,panelController,errorText='';
  const room=()=>window.ACTIVE_ROOM;
  const connected=()=>!closed&&joined&&window.WSClient?.isConnected();
  const key=()=>session&&state?.asset?session.token+':'+state.asset.id:null;
  const send=(type,payload)=>{if(!connected())return false;WSClient.ws.send(JSON.stringify({type,payload}));return true;};
  function closePanel(){panelController?.abort();panel?.close();}
  function controls(){
    if(manage){manage.style.display=session?.canControl?'':'none';manage.disabled=!connected()||syncing||!!pending;}
    if(refresh)refresh.disabled=!connected()||syncing;
    if(status)status.textContent=errorText||(!session?t('connecting'):state?.asset?state.asset.name+' · '+(state.pageIndex+1)+' / '+state.asset.pageCount:t('idle'));
    if(panel){
      panel.querySelector('[data-current]').textContent=state?.asset?state.asset.name+' · '+(state.pageIndex+1)+' / '+state.asset.pageCount:t('idle');
      for(const button of panel.querySelectorAll('[data-command]'))button.disabled=!connected()||!session?.canControl||syncing||!!pending||!view;
      const previous=panel.querySelector('[data-command="previous"]'),next=panel.querySelector('[data-command="next"]');
      previous.disabled ||= !state?.asset||state.pageIndex===0;next.disabled ||= !state?.asset||state.pageIndex>=state.asset.pageCount-1;
      panel.querySelector('[data-command="show"]').disabled ||= !panel.querySelector('select').options.length;
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
  function clearDocument(){++draw;loadedKey=null;loading=null;renderer?.clear();view?.reset();}
  function disconnect(){
    joined=false;session=state=null;syncing=false;clearTimeout(syncTimer);clearDocument();closePanel();
    window.RoomScreenPreview?.close();window.RoomMaterials?.close();
    if(pending){clearTimeout(pending.timer);pending.reject(Error(t('disconnected')));pending=null;}
    errorText='';controls();
  }
  function acceptState(value){
    if(!P.state(value)||!session||value.roomId!==room()?.id||value.epoch!==session.epoch)return;
    if(state&&BigInt(value.revision)<BigInt(state.revision))return;
    const duplicate=state?.revision===value.revision&&!syncing;
    state=value;syncing=false;clearTimeout(syncTimer);errorText='';controls();
    if(!duplicate)renderLatest();
  }
  function renderLatest(){
    if(!view||!renderer||!session||!state||closed)return;
    const currentView=view,currentRenderer=renderer,currentKey=key(),ticket=++draw;
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
      if(view===currentView&&renderer===currentRenderer&&ticket===draw&&key()===currentKey&&!closed){currentView.draw(renderer.canvas);errorText='';controls();}
    }).catch(error=>{
      if(ticket!==draw||view!==currentView||['AbortError','RenderingCancelledException'].includes(error.name))return;
      currentView.message(t('renderFailed'));report('renderFailed');
    });
  }
  function command(command){
    if(!connected()||!session?.canControl||!state||!view||pending||syncing)return Promise.reject(Error(t('disconnected')));
    const requestId=P.requestId();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(pending?.requestId!==requestId)return;pending=null;report('commandUnconfirmed');requestSnapshot();reject(Error(t('commandUnconfirmed')));},10000);
      pending={requestId,resolve,reject,timer};controls();
      send('ROOM_PRESENTATION_COMMAND',{requestId,expectedEpoch:state.epoch,expectedRevision:state.revision,command});
    });
  }
  function openPanel(trigger){
    if(!session?.canControl||!view)return;closePanel();
    const dialog=panel=document.createElement('dialog');dialog.className='room-presentation-dialog';dialog.setAttribute('aria-labelledby','presentation-heading');
    const heading=document.createElement('h2');heading.id='presentation-heading';heading.textContent=t('manage');
    const current=document.createElement('p');current.dataset.current='';current.setAttribute('role','status');
    const select=document.createElement('select');select.setAttribute('aria-label',t('material'));select.id='presentation-material';
    const label=document.createElement('label');label.textContent=t('material');label.append(select);
    const button=(text,fn,kind)=>{const b=document.createElement('button');b.type='button';b.textContent=t(text);if(kind)b.dataset.command=kind;
      b.onclick=()=>Promise.resolve().then(fn).catch(e=>{if(panel===dialog){report(e.code||'commandFailed');current.textContent=e.message;}});return b;};
    const close=button('close',()=>dialog.close());close.autofocus=true;
    const show=button('show',()=>command({type:'show',assetId:select.value}),'show');
    const previous=button('previous',()=>command({type:'page',pageIndex:state.pageIndex-1}),'previous');
    const next=button('next',()=>command({type:'page',pageIndex:state.pageIndex+1}),'next');
    const stop=button('stop',()=>command({type:'stop'}),'stop');
    const library=button('library',()=>{dialog.close();RoomMaterials.open(room(),trigger);});
    dialog.append(heading,close,current,label,show,previous,next,stop,library);
    panelController=new AbortController();const signal=panelController.signal;
    dialog.addEventListener('close',()=>{dialog.remove();if(panel===dialog){panel=null;panelController?.abort();panelController=null;if(trigger?.isConnected)trigger.focus();}},{once:true});
    for(const type of ['pointerdown','pointerup','click','keydown','keyup','wheel','touchstart','touchmove'])dialog.addEventListener(type,e=>e.stopPropagation());
    dialog.addEventListener('keydown',e=>{if(e.key==='Tab'){
      const nodes=[...dialog.querySelectorAll('button,select')].filter(n=>!n.disabled),first=nodes[0],last=nodes.at(-1);
      if(!nodes.includes(document.activeElement)||!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    }});
    document.body.append(dialog);dialog.showModal();controls();show.disabled=true;
    fetch('/api/my/rooms/'+room().id+'/materials',{headers:{Authorization:'Bearer '+localStorage.getItem('token')},signal,cache:'no-store'})
      .then(async response=>{if(!response.ok)throw Error(t('libraryFailed'));return response.json();}).then(data=>{
        if(panel!==dialog||signal.aborted)return;
        for(const asset of data.materials.filter(a=>a.state==='ready')){const option=document.createElement('option');option.value=asset.id;option.textContent=asset.name;select.append(option);}
        controls();show.disabled ||= !select.options.length;if(!select.options.length)current.textContent=t('empty');
      }).catch(e=>{if(e.name!=='AbortError'&&panel===dialog)current.textContent=t('libraryFailed');});
  }
  function attach(value){
    if(closed)return;detach();view=value;renderer=new RoomMediaRenderer(document.createElement('canvas'));
    const target=document.querySelector('#meeting-toolbar .meeting-actions');
    if(target){
      controlsBar=document.createElement('div');controlsBar.id='room-presentation-controls';
      manage=document.createElement('button');manage.type='button';manage.id='presentation-manage';manage.textContent=t('manage');manage.onclick=()=>openPanel(manage);
      refresh=document.createElement('button');refresh.type='button';refresh.id='presentation-refresh';refresh.textContent=t('refresh');refresh.onclick=()=>{errorText='';requestSnapshot();};
      status=document.createElement('span');status.id='presentation-status';status.setAttribute('role','status');status.style.cssText='max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      for(const element of [manage,refresh,status]){element.addEventListener('pointerdown',e=>e.stopPropagation());element.addEventListener('click',e=>e.stopPropagation());controlsBar.append(element);}
      target.append(controlsBar);
    }
    controls();if(session&&state)renderLatest();else requestSnapshot();
  }
  function detach(){closePanel();clearDocument();renderer=null;view=null;controlsBar?.remove();controlsBar=manage=refresh=status=null;}
  function message(type,payload){
    if(closed)return;
    if(type==='ROOM_PRESENTATION_SESSION'){
      if(!P.session(payload)||payload.roomId!==room()?.id)return;
      if(session?.token!==payload.token){state=null;clearDocument();}
      session=payload;controls();
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
    joined(){joined=true;if(!session)requestSnapshot();},
    stop(){disconnect();closed=true;detach();}
  };
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')requestSnapshot();});
})();
