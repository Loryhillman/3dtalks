(() => {
  const $=id=>document.getElementById(id),copy=v=>JSON.parse(JSON.stringify(v));
  const tr=(key,fallback)=>{const v=window.i18n?.t('roomEnvelope.'+key);return v&&v!=='roomEnvelope.'+key?v:fallback;};
  const names={north:'Стена 1',south:'Стена 2',west:'Стена 3',east:'Стена 4',floor:'Пол',ceiling:'Потолок'};
  let envelope,object,room,objects=[],seats=[],selected='north',dirty=false,uploading=null;
  const emit=(name,detail)=>window.dispatchEvent(new CustomEvent(name,{detail}));
  function modes(){
    const mode=$('surface-mode').value;
    $('surface-color-label').hidden=mode!=='color';$('surface-image-controls').hidden=mode==='color';
    $('surface-fit-label').hidden=mode!=='image';$('surface-tiles').hidden=mode!=='texture';
  }
  function fields(){
    if(!envelope)return;
    for(const k of ['width','length','height'])$('envelope-'+k).value=envelope[k];
    const s=envelope.surfaces[selected];$('room-surface-title').textContent=tr(selected,names[selected]);
    $('surface-mode').value=s.mode;$('surface-color').value=s.color;$('surface-fit').value=s.fit;
    $('surface-tile-width').value=s.tileWidth;$('surface-tile-height').value=s.tileHeight;
    $('surface-preview').hidden=!s.image;if(s.image)$('surface-preview').src=s.image;else $('surface-preview').removeAttribute('src');
    $('surface-upload').value='';modes();
    for(const b of $('room-surface-list').children)b.classList.toggle('selected',b.dataset.surface===selected);
  }
  function read(){
    if(!envelope||!$('room-envelope-form').checkValidity())throw new Error(tr('invalid','Проверьте размеры и оформление поверхности'));
    const next=copy(envelope);
    for(const k of ['width','length','height'])next[k]=Number($('envelope-'+k).value);
    Object.assign(next.surfaces[selected],{mode:$('surface-mode').value,color:$('surface-color').value,fit:$('surface-fit').value,
      tileWidth:Number($('surface-tile-width').value),tileHeight:Number($('surface-tile-height').value)});
    if(!RoomEnvelope.valid(next))throw new Error(tr('needImage','Выберите изображение для поверхности'));
    envelope=next;return next;
  }
  function warn(){
    if(!envelope||!object)return;
    const shell={envelope,position:{},rotation:{},scale:{x:1,y:1,z:1}};
    for(const a of ['x','y','z']){shell.position[a]=Number(object['position_'+a]||0);shell.rotation[a]=Number(object['rotation_'+a]||0);}
    const outside=objects.filter(o=>!o.is_room_shell&&!RoomEnvelope.contains({x:Number(o.position_x),y:Number(o.position_y),z:Number(o.position_z)},shell));
    const outsideSeats=seats.filter(s=>s.enabled&&!RoomEnvelope.contains(RoomSeatCoordinates.world(s,window.RoomEditorObjects?.get(s.object_id)).position,shell));
    $('room-envelope-warning').textContent=outside.length||outsideSeats.length?tr('outside','За границами помещения остались предметы. Переместите их перед публикацией.')+' '+[...outside.map(o=>o.name),...outsideSeats.map(s=>s.label)].join(', '):'';
  }
  function preview(){emit('room-envelope-preview',{id:object.id,envelope});warn();}
  function select(key){
    if(!envelope||!RoomEnvelope.surfaces.includes(key))return;
    try{if(dirty)read();selected=key;fields();emit('room-envelope-selected',key);}
    catch(e){$('room-envelope-message').textContent=e.message;}
  }
  window.addEventListener('room-editor-loaded',event=>{
    room=event.detail.room;objects=event.detail.objects;object=objects.find(o=>o.is_room_shell);envelope=object?.room_envelope?copy(object.room_envelope):null;dirty=false;
    $('room-surface-list').replaceChildren();$('room-envelope-form').hidden=!envelope;
    $('room-shell-hint').hidden=objects.some(o=>o.is_room_environment);
    $('room-envelope-message').textContent=envelope||objects.some(o=>o.is_room_environment)?'':tr('unsupported','Это помещение не распознано как прямоугольное. Его геометрия сохранена без изменений.');
    if(!envelope)return;
    for(const key of RoomEnvelope.surfaces){const b=document.createElement('button');b.type='button';b.className='item';b.dataset.surface=key;b.textContent=tr(key,names[key]);b.onclick=()=>select(key);$('room-surface-list').append(b);}
    $('room-envelope-form').querySelectorAll('input,select,button').forEach(c=>c.disabled=room.status!=='draft');fields();warn();
  });
  window.addEventListener('room-seat-preview',event=>{seats=event.detail.seats;warn();});
  window.addEventListener('room-surface-picked',event=>select(event.detail));
  window.addEventListener('room-surface-error',()=>{$('room-envelope-message').textContent=tr('loadError','Изображение поверхности не загрузилось. Проверьте файл или загрузите его заново.');});
  $('room-envelope-form').addEventListener('input',event=>{
    if(event.target.id==='surface-upload')return;dirty=true;modes();emit('room-template-changed');
    try{read();preview();$('room-envelope-message').textContent='';}catch(e){$('room-envelope-message').textContent=e.message;}
  });
  $('surface-upload-button').addEventListener('click',()=>$('surface-upload').click());
  $('surface-upload').addEventListener('change',()=>{
    const file=$('surface-upload').files[0];if(!file||uploading)return;const key=selected;
    $('surface-upload').disabled=true;$('surface-upload-button').disabled=true;$('room-envelope-message').textContent=tr('uploading','Загружаем изображение…');
    uploading=(async()=>{
      const data=new FormData();data.append('image',file);
      const response=await fetch('/api/admin/rooms/surface-images',{method:'POST',headers:{Authorization:'Bearer '+localStorage.getItem('adminToken')},body:data});
      const result=await response.json();if(!response.ok||!result.success)throw new Error(result.error||'HTTP '+response.status);
      envelope.surfaces[key].image=result.image.path;dirty=true;
      if(selected===key){read();fields();}preview();emit('room-template-changed');$('room-envelope-message').textContent=tr('uploaded','Изображение загружено. Сохраните изменения.');
    })().catch(e=>{$('room-envelope-message').textContent=e.message;throw e;})
      .finally(()=>{uploading=null;$('surface-upload').disabled=room?.status!=='draft';$('surface-upload-button').disabled=room?.status!=='draft';});
    uploading.catch(()=>{});
  });
  async function flush(){
    if(uploading)await uploading;if(!dirty)return;
    const value=read();
    const data=await window.roomEditorApi('/envelope',{method:'PATCH',body:JSON.stringify({revision:room.revision,envelope:value})});
    if(data.room)Object.assign(room,data.room);dirty=false;emit('room-template-changed');
    $('room-envelope-message').textContent=room.id.startsWith('template-')?tr('applied','Помещение применено. Сохраните черновик шаблона.'):tr('saved','Помещение сохранено');
  }
  $('room-envelope-form').addEventListener('submit',event=>{event.preventDefault();flush().catch(e=>{$('room-envelope-message').textContent=e.message;});});
  window.RoomEnvelopeEditor={flush,isDirty:()=>dirty||!!uploading};
  window.addEventListener('beforeunload',event=>{if(dirty||uploading){event.preventDefault();event.returnValue='';}});
})();
