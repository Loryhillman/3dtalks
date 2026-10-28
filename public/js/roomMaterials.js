/* Owner-only library. Local preview never changes a room's shared screen. */
(() => {
  let current;
  const t=key=>window.i18n.t('roomMaterials.'+key);
  function requestId(){
    // getRandomValues remains available during HTTP/IP development too.
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  const node=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text)n.textContent=text;return n;};
  const button=(label,handler,variant='')=>{const b=node('button','ui-button'+(variant?' ui-button--'+variant:''),t(label));b.type='button';b.onclick=handler;return b;};
  function close(){current?.dialog.close();}
  async function open(room,trigger=document.activeElement){
    close();
    const token=localStorage.getItem('token');
    const controller=new AbortController();
    const dialog=node('dialog','meeting-ui room-materials');dialog.id='materials-dialog';
    dialog.setAttribute('aria-labelledby','materials-title');
    const header=node('div','material-header'),heading=node('div');
    const title=node('h2','',t('title'));title.id='materials-title';
    heading.append(title,node('p','material-room',room.name));
    const exit=button('close',()=>dialog.close(),'ghost');exit.classList.add('material-close');exit.autofocus=true;
    exit.setAttribute('aria-label',t('close'));exit.textContent='';
    const closeIcon=node('img');closeIcon.src='/icons/lucide/x.svg';closeIcon.alt='';closeIcon.width=closeIcon.height=20;exit.append(closeIcon);
    header.append(heading,exit);
    const body=node('div','material-body'),library=node('div','material-library');
    const status=node('p','material-status');status.setAttribute('role','status');status.hidden=true;
    function setStatus(text='',error=false){status.textContent=text;status.hidden=!text;status.classList.toggle('is-error',error);}
    const input=node('input','material-file-input');input.type='file';input.accept='.pdf,.png,.jpg,.jpeg,.webp';input.id='material-file';
    input.setAttribute('aria-describedby','material-formats');input.setAttribute('aria-label',t('upload'));
    const label=node('label','material-upload');
    const formats=node('span','material-upload-format',t('formats'));formats.id='material-formats';
    label.append(node('span','material-upload-action','＋ '+t('upload')),formats,input);
    let transfer,videoUpload=false,pptxImport=false,previewVideo=null;
    const stop=button('cancelUpload',async()=>{transfer?.abort();await cancelUpload();});stop.hidden=true;
    const quota=node('div','material-quota');quota.hidden=true;
    const quotaValues=node('span','material-quota-values'),meter=node('meter');meter.min=0;meter.max=1;meter.value=0;meter.setAttribute('aria-label',t('storage'));
    quota.append(node('span','',t('quota')),quotaValues,meter);
    const listSection=node('div'),listHeading=node('div','material-section-heading'),list=node('div','material-list');list.id='materials-list';
    list.setAttribute('aria-busy','true');list.append(node('p','material-empty',t('loading')));
    const reload=button('refresh',()=>act(refresh),'ghost');reload.dataset.materialAction='';
    listHeading.append(node('h3','',t('files')),reload);listSection.append(listHeading,list);
    library.append(label,stop,quota,listSection);
    const previewPanel=node('div','material-preview');
    const previewName=node('p','material-preview-name',t('privateLibrary'));
    const frame=node('div','material-preview-frame'),placeholder=node('p','material-empty',t('choosePreview'));
    const canvas=node('canvas');canvas.width=canvas.height=0;canvas.hidden=true;
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t('preview'));frame.append(placeholder,canvas);
    const renderer=new RoomMediaRenderer(canvas),pager=node('div','material-pages');let page=0,selected,uploadId,busy=false,actionTrigger,previewEpoch=0,previewLoading=false;
    const back=button('previous',()=>renderPage(page-1)),next=button('next',()=>renderPage(page+1)),count=node('span','material-page-count');
    back.setAttribute('aria-label',t('previous'));next.setAttribute('aria-label',t('next'));back.textContent='←';next.textContent='→';
    pager.append(back,count,next);pager.hidden=true;
    previewPanel.append(node('h3','',t('preview')),previewName,frame,pager,node('p','material-private-hint',t('localPreview')));
    body.append(library,previewPanel);
    const confirmation=node('div','material-confirm');confirmation.hidden=true;
    const confirmTitle=node('h3','',t('remove'));confirmTitle.id='material-confirm-title';
    const confirmName=node('p','material-confirm-name'),confirmText=node('p');confirmText.id='material-confirm-description';
    const confirmActions=node('div','material-confirm-actions');let confirmResolve=null,confirmTrigger,restoreConfirmFocus=false;
    const settleConfirm=accepted=>{if(!confirmResolve)return;const resolve=confirmResolve;confirmResolve=null;confirmation.hidden=true;body.hidden=false;dialog.classList.remove('is-confirming');dialog.setAttribute('aria-busy',String(accepted));dialog.setAttribute('aria-labelledby','materials-title');dialog.removeAttribute('aria-describedby');restoreConfirmFocus=true;resolve(accepted);};
    const cancelRemove=button('cancel',()=>settleConfirm(false)),acceptRemove=button('remove',()=>settleConfirm(true),'danger');
    confirmActions.append(cancelRemove,acceptRemove);confirmation.append(confirmTitle,confirmName,confirmText,confirmActions);
    function askRemove(asset,showing=false){
      if(!dialog.open||controller.signal.aborted)return Promise.resolve(false);
      setStatus();confirmTrigger=actionTrigger;confirmName.textContent=asset.name;confirmText.textContent=t(showing?'confirmStopRemove':'confirmRemove');acceptRemove.textContent=t(showing?'stopAndRemove':'remove');
      body.hidden=true;confirmation.hidden=false;dialog.classList.add('is-confirming');dialog.setAttribute('aria-busy','false');dialog.setAttribute('aria-labelledby','material-confirm-title');dialog.setAttribute('aria-describedby',confirmText.id);
      const result=new Promise(resolve=>{confirmResolve=resolve;});cancelRemove.focus();return result;
    }
    dialog.addEventListener('cancel',event=>{if(confirmResolve){event.preventDefault();settleConfirm(false);}});
    dialog.append(header,status,body,confirmation);document.body.append(dialog);
    const session=current={dialog};
    const headers=()=>({Authorization:'Bearer '+token});
    const url='/api/my/rooms/'+encodeURIComponent(room.id)+'/materials';
    async function request(suffix,options={}){
      if(localStorage.getItem('token')!==token){dialog.close();throw Error('SESSION_CHANGED');}
      const res=await fetch(url+suffix,{...options,headers:{...headers(),...options.headers},cache:'no-store',signal:options.signal||controller.signal});
      const data=await res.json().catch(()=>({}));if([401,403].includes(res.status))dialog.close();if(!res.ok)throw Object.assign(new Error(data.code||'FAILED'),{code:data.code,state:data.state});return data;
    }
    const report=e=>{if(!['AbortError','RenderingCancelledException'].includes(e.name)&&dialog.open)setStatus(t(e.code||e.message)===('roomMaterials.'+(e.code||e.message))?t('failed'):t(e.code||e.message),true);};
    function syncControls(){
      input.disabled=busy;for(const b of dialog.querySelectorAll('[data-material-action]'))b.disabled=busy;
      syncPager();
    }
    const act=async fn=>{if(busy||!dialog.open)return;actionTrigger=document.activeElement;busy=true;syncControls();dialog.setAttribute('aria-busy','true');try{await fn();}catch(e){report(e);}finally{busy=false;syncControls();stop.hidden=true;dialog.setAttribute('aria-busy','false');if(restoreConfirmFocus&&dialog.open){restoreConfirmFocus=false;(confirmTrigger?.isConnected&&!confirmTrigger.disabled?confirmTrigger:reload).focus();}}};
    function syncPager(){count.textContent=`${page+1} / ${renderer.pageCount}`;back.disabled=busy||previewLoading||page<=0;next.disabled=busy||previewLoading||page>=renderer.pageCount-1;pager.hidden=renderer.pageCount<2||previewLoading||canvas.hidden;}
    async function resetPreview(){previewVideo?.dispose();previewVideo=null;++previewEpoch;selected=null;previewLoading=false;const clearing=renderer.clear();canvas.hidden=true;placeholder.hidden=false;placeholder.textContent=t('choosePreview');previewName.textContent=t('privateLibrary');pager.hidden=true;await clearing;}
    async function renderPage(index){
      if(busy||index<0||index>=renderer.pageCount)return;
      await act(async()=>{await renderer.page(index);page=index;syncPager();});
    }
    async function preview(asset,{completedUpload=false}={}){
      if(busy&&!completedUpload)return;
      previewVideo?.dispose();previewVideo=null;
      const epoch=++previewEpoch;selected=asset;previewLoading=true;canvas.hidden=true;pager.hidden=true;
      previewName.textContent=asset.name;canvas.setAttribute('aria-label',t('preview')+' — '+asset.name);placeholder.hidden=false;placeholder.textContent=t('loading');setStatus();
      for(const row of list.querySelectorAll('.material-row'))row.classList.toggle('is-selected',row.dataset.assetId===asset.id);
      try{
        if(asset.kind==='video'){
          await renderer.clear();if(epoch!==previewEpoch||!dialog.open)return;
          const player=previewVideo=new RoomVideoPlayback({status:key=>{if(key==='failed'&&epoch===previewEpoch)placeholder.textContent=t('previewFailed');}});
          player.video.controls=true;player.video.className='material-video';player.video.setAttribute('aria-label',t('preview')+' — '+asset.name);frame.append(player.video);
          player.video.addEventListener('loadedmetadata',()=>{if(epoch===previewEpoch&&dialog.open){previewLoading=false;placeholder.hidden=true;}},{once:true,signal:controller.signal});
          await player.load({grantUrl:url+'/'+asset.id+'/video/grant',headers:headers()});return;
        }
        await renderer.load({url:url+'/'+asset.id+'/content',kind:asset.kind,headers:headers()});
        if(epoch!==previewEpoch||!dialog.open)return;page=0;previewLoading=false;canvas.hidden=false;placeholder.hidden=true;syncPager();
      }catch(e){if(epoch===previewEpoch&&dialog.open){previewLoading=false;placeholder.textContent=t('previewFailed');if(e.name!=='RenderingCancelledException')report(e);}}
    }
    async function refresh(){
      const data=await request(videoUpload?'?protocolVersion=2':'');if(!dialog.open)return;
      setStatus();list.setAttribute('aria-busy','false');quota.hidden=false;
      quotaValues.textContent=(data.quota.bytes/1024**2).toFixed(1)+' / '+(data.quota.byteLimit/1024**2)+' MiB · '+t('files')+': '+data.quota.count+' / '+data.quota.countLimit;
      meter.max=data.quota.byteLimit;meter.value=data.quota.bytes;
      if(selected&&!data.materials.some(asset=>asset.id===selected.id&&asset.state==='ready'))await resetPreview();
      list.replaceChildren();
      for(const asset of data.materials){
        const row=node('div','material-row');row.dataset.assetId=asset.id;row.classList.toggle('is-selected',selected?.id===asset.id);row.setAttribute('role','group');row.setAttribute('aria-label',asset.name);
        const kind=node('span','material-kind',asset.sourceFormat==='pptx'?'PPTX → PDF':asset.kind==='pdf'?'PDF':asset.kind==='video'?'MP4':'IMG');kind.setAttribute('aria-hidden','true');
        const details=node('span','material-details');details.append(node('span','material-name',asset.name),node('span','material-state material-state--'+asset.state,t(asset.state)+(asset.sourceFormat==='pptx'&&asset.state==='ready'?' · '+t('convertedPdf'):'')));
        const actions=node('span','material-actions');
        if(asset.state==='ready')actions.append(button('preview',()=>preview(asset)));
        if(['ready','failed','cancelled'].includes(asset.state))actions.append(button('remove',()=>act(async()=>{
          if(!await askRemove(asset))return;
          setStatus(t('removing'));
          if(selected?.id===asset.id)await resetPreview();
          try{await request('/'+asset.id,{method:'DELETE'});}
          catch(e){
            if(e.code!=='MATERIAL_IN_USE'||!e.state)throw e;
            if(!await askRemove(asset,true)){setStatus();return;}
            setStatus(t('removing'));
            await request('/'+asset.id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({
              stopShowing:true,requestId:requestId(),expectedEpoch:e.state.epoch,expectedRevision:e.state.revision})});
          }
          await refresh();setStatus(t('removed'));
        }),'destructive'));
        if(['reserved','uploading','checking'].includes(asset.state))actions.append(button('cancelUpload',()=>act(async()=>{await request('/uploads/'+asset.id,{method:'DELETE'});await refresh();})));
        for(const action of actions.children)action.dataset.materialAction='';
        row.append(kind,details,actions);list.append(row);
      }
      if(!data.materials.length)list.append(node('p','material-empty',t('empty')));
    }
    async function cancelUpload(){
      if(!uploadId)return;
      const id=uploadId;uploadId=null;
      await fetch(url+'/uploads/'+id,{method:'DELETE',headers:headers(),keepalive:true}).catch(()=>{});
    }
    input.onchange=()=>act(async()=>{
      const file=input.files[0];if(!file)return;input.value='';
      const imported=/\.pptx$/i.test(file.name),kind=imported||/\.pdf$/i.test(file.name)?'pdf':/\.mp4$/i.test(file.name)?'video':'image',limit=imported?RoomMediaContract.importLimits.pptx.bytes:kind==='video'?RoomMediaContract.importLimits.video.bytes:(kind==='pdf'?20:8)*1024**2;
      if(imported&&!pptxImport)throw Object.assign(Error('PPTX_UNAVAILABLE'),{code:'PPTX_UNAVAILABLE'});
      if(kind==='video'&&!videoUpload)throw Object.assign(Error('VIDEO_UNAVAILABLE'),{code:'VIDEO_UNAVAILABLE'});
      if(!file.size||file.size>limit)throw Object.assign(new Error('FILE_TOO_LARGE'),{code:'FILE_TOO_LARGE'});
      const data=await request('/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:requestId(),kind,...(imported?{sourceFormat:'pptx'}:{}),name:file.name.slice(0,120),bytes:file.size})});
      transfer=new AbortController();
      uploadId=data.upload.id;stop.hidden=false;setStatus(t(imported?'convertingPptx':'uploading')+' '+file.name);
      const body=new FormData();body.append('file',file);
      try{const result=await request('/uploads/'+uploadId+'/file',{method:'POST',body,signal:transfer.signal});uploadId=null;if(imported&&dialog.open)await preview(result.material,{completedUpload:true});}
      catch(e){await cancelUpload();throw e;}
      finally{input.value='';if(dialog.open)await refresh();}
    });
    for(const type of ['pointerdown','pointerup','click','keyup','wheel','touchstart','touchmove'])dialog.addEventListener(type,e=>e.stopPropagation());
    dialog.addEventListener('keydown',e=>{
      e.stopPropagation();
      if(e.key==='Tab'){
        if(document.activeElement?.tagName==='VIDEO')return;
        const nodes=[...dialog.querySelectorAll('button,input,video')].filter(n=>!n.disabled&&n.getClientRects().length);
        const first=nodes[0],last=nodes.at(-1);
        if(!nodes.includes(document.activeElement)){e.preventDefault();first?.focus();}
        else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    });
    const storage=e=>{if(e.key===null||e.key==='token'&&e.newValue!==token)dialog.close();};window.addEventListener('storage',storage);
    const sessionCheck=setInterval(()=>{if(localStorage.getItem('token')!==token)dialog.close();},800);
    const pagehide=()=>dialog.close();window.addEventListener('pagehide',pagehide);
    dialog.addEventListener('close',()=>{
      previewVideo?.dispose();previewVideo=null;settleConfirm(false);++previewEpoch;controller.abort();transfer?.abort();cancelUpload();renderer.clear();dialog.remove();
      window.removeEventListener('storage',storage);window.removeEventListener('pagehide',pagehide);
      clearInterval(sessionCheck);
      if(current===session)current=null;if(trigger?.isConnected)trigger.focus();
    },{once:true});
    dialog.showModal();await act(async()=>{try{
      try{const caps=await request('/capabilities');videoUpload=caps.features?.videoUpload===true&&!!window.RoomVideoPlayback;
        if(videoUpload){input.accept+=',.mp4';formats.textContent=t('formatsVideo');}
        pptxImport=caps.features?.pptxImport===true;if(pptxImport){input.accept+=',.pptx';formats.textContent+=' · '+t('formatsPptx');const hint=node('p','material-private-hint',t('pptxNotice'));hint.id='material-pptx-notice';input.setAttribute('aria-describedby','material-formats material-pptx-notice');label.after(hint);}}catch(e){if(!dialog.open)return;}
      await refresh();}catch(e){if(!list.querySelector('.material-row'))list.replaceChildren(node('p','material-empty',t('failed')));throw e;}finally{list.setAttribute('aria-busy','false');}});
  }
  window.RoomMaterials={open,close};
})();
