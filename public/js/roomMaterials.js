/* Owner-only library. Local preview never changes a room's shared screen. */
(() => {
  let current;
  const t=key=>window.i18n.t('roomMaterials.'+key);
  function requestId(){
    // getRandomValues remains available during HTTP/IP development too.
    const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
    const h=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  const button=(label,handler)=>{const b=document.createElement('button');b.type='button';b.className='ui-button';b.textContent=t(label);b.onclick=handler;return b;};
  function close(){current?.dialog.close();}
  async function open(room,trigger=document.activeElement){
    close();
    const token=localStorage.getItem('token');
    const controller=new AbortController();
    const dialog=document.createElement('dialog');dialog.className='ui-dialog room-materials';dialog.id='materials-dialog';
    dialog.setAttribute('aria-labelledby','materials-title');
    const title=document.createElement('h2');title.id='materials-title';title.textContent=t('title')+' — '+room.name;
    const hint=document.createElement('p');hint.textContent=t('hint');
    const status=document.createElement('p');status.setAttribute('role','status');
    const quota=document.createElement('p'),list=document.createElement('div');list.id='materials-list';
    const input=document.createElement('input');input.type='file';input.accept='.pdf,.png,.jpg,.jpeg,.webp';input.id='material-file';
    const label=document.createElement('label');label.textContent=t('upload');label.append(input);
    let transfer;
    const stop=button('cancelUpload',async()=>{transfer?.abort();await cancelUpload();});stop.hidden=true;
    const canvas=document.createElement('canvas');canvas.style.cssText='display:block;max-width:100%;max-height:60dvh;width:auto;height:auto;margin:12px auto';canvas.width=canvas.height=0;
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label',t('preview'));
    const renderer=new RoomMediaRenderer(canvas),pager=document.createElement('div');pager.className='material-pages';let page=0,selected,uploadId,busy=false,previewEpoch=0;
    const back=button('previous',()=>renderPage(page-1)),next=button('next',()=>renderPage(page+1)),count=document.createElement('span');pager.append(back,count,next);pager.hidden=true;
    const exit=button('close',()=>dialog.close());exit.autofocus=true;
    dialog.append(title,exit,hint,label,stop,quota,status,list,pager,canvas);document.body.append(dialog);
    const session=current={dialog};
    const headers=()=>({Authorization:'Bearer '+token});
    const url='/api/my/rooms/'+encodeURIComponent(room.id)+'/materials';
    async function request(suffix,options={}){
      if(localStorage.getItem('token')!==token)throw Error('SESSION_CHANGED');
      const res=await fetch(url+suffix,{...options,headers:{...headers(),...options.headers},cache:'no-store',signal:options.signal||controller.signal});
      const data=await res.json().catch(()=>({}));if(!res.ok)throw Object.assign(new Error(data.code||'FAILED'),{code:data.code});return data;
    }
    const report=e=>{if(!['AbortError','RenderingCancelledException'].includes(e.name)&&dialog.open)status.textContent=t(e.code||e.message)===('roomMaterials.'+(e.code||e.message))?t('failed'):t(e.code||e.message);};
    const act=async fn=>{if(busy)return;busy=true;input.disabled=true;dialog.setAttribute('aria-busy','true');try{await fn();}catch(e){report(e);}finally{busy=false;input.disabled=false;stop.hidden=true;dialog.setAttribute('aria-busy','false');}};
    function syncPager(){count.textContent=` ${page+1} / ${renderer.pageCount} `;back.disabled=page<=0;next.disabled=page>=renderer.pageCount-1;pager.hidden=renderer.pageCount<2;}
    async function renderPage(index){
      if(busy||index<0||index>=renderer.pageCount)return;
      await act(async()=>{await renderer.page(index);page=index;syncPager();});
    }
    async function preview(asset){
      const epoch=++previewEpoch;selected=asset;pager.hidden=true;status.textContent=t('loading');
      try{await renderer.load({url:url+'/'+asset.id+'/content',kind:asset.kind,headers:headers()});
        if(epoch!==previewEpoch||!dialog.open)return;page=0;syncPager();status.textContent=t('localPreview');
      }catch(e){if(epoch===previewEpoch&&e.name!=='RenderingCancelledException')report(e);}
    }
    async function refresh(){
      const data=await request('');if(!dialog.open)return;
      quota.textContent=t('quota')+': '+(data.quota.bytes/1024**2).toFixed(1)+' / '+(data.quota.byteLimit/1024**2)+' MiB · '+data.quota.count+' / '+data.quota.countLimit;
      list.replaceChildren();
      for(const asset of data.materials){
        const row=document.createElement('div');row.setAttribute('role','group');row.setAttribute('aria-label',asset.name);row.style.cssText='display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0';
        const name=document.createElement('span');name.textContent=asset.name+' · '+t(asset.state);row.append(name);
        if(asset.state==='ready')row.append(button('preview',()=>preview(asset)));
        if(['ready','failed','cancelled'].includes(asset.state))row.append(button('remove',()=>act(async()=>{
          if(!confirm(t('confirmRemove')))return;
          if(selected?.id===asset.id){++previewEpoch;selected=null;await renderer.clear();pager.hidden=true;}
          await request('/'+asset.id,{method:'DELETE'});await refresh();
        })));
        if(['reserved','uploading','checking'].includes(asset.state))row.append(button('cancelUpload',()=>act(async()=>{await request('/uploads/'+asset.id,{method:'DELETE'});await refresh();})));
        list.append(row);
      }
      if(!data.materials.length)list.textContent=t('empty');
    }
    async function cancelUpload(){
      if(!uploadId)return;
      await fetch(url+'/uploads/'+uploadId,{method:'DELETE',headers:headers(),keepalive:true}).catch(()=>{});uploadId=null;
    }
    const reload=button('refresh',()=>act(refresh));dialog.insertBefore(reload,quota);
    input.onchange=()=>act(async()=>{
      const file=input.files[0];if(!file)return;
      const kind=/\.pdf$/i.test(file.name)?'pdf':'image',limit=(kind==='pdf'?20:8)*1024**2;
      if(!file.size||file.size>limit)throw Object.assign(new Error('FILE_TOO_LARGE'),{code:'FILE_TOO_LARGE'});
      const data=await request('/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:requestId(),kind,name:file.name.slice(0,120),bytes:file.size})});
      transfer=new AbortController();
      uploadId=data.upload.id;stop.hidden=false;status.textContent=t('uploading');
      const body=new FormData();body.append('file',file);
      try{await request('/uploads/'+uploadId+'/file',{method:'POST',body,signal:transfer.signal});uploadId=null;status.textContent=t('ready');}
      catch(e){await cancelUpload();throw e;}
      finally{input.value='';await refresh();}
    });
    dialog.addEventListener('keydown',e=>{
      e.stopPropagation();
      if(e.key==='Tab'){
        const nodes=[...dialog.querySelectorAll('button,input')].filter(n=>!n.disabled&&n.getClientRects().length);
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
      ++previewEpoch;controller.abort();transfer?.abort();cancelUpload();renderer.clear();dialog.remove();
      window.removeEventListener('storage',storage);window.removeEventListener('pagehide',pagehide);
      clearInterval(sessionCheck);
      if(current===session)current=null;if(trigger?.isConnected)trigger.focus();
    },{once:true});
    dialog.showModal();try{await refresh();}catch(e){report(e);}
  }
  window.RoomMaterials={open,close};
})();
