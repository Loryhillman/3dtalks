(() => {
  let room, seats = [], selected = -1, loaded = false, dirty = false, formDirty = false;
  let worldRotation = {x:0,y:0,z:0}, listSignature = '';
  const $ = id => document.getElementById(id);
  const tr = (key, fallback) => { const v = window.i18n?.t('roomSeatsEditor.' + key); return v && v !== 'roomSeatsEditor.' + key ? v : fallback; };
  const object = id => window.RoomEditorObjects?.get(id);
  const pose = seat => RoomSeatCoordinates.world(seat, object(seat.object_id));
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, {detail}));
  function changed() { dirty = true; emit('room-seat-dirty'); }
  async function api(path, body) {
    return window.roomEditorApi(path, {method:body ? 'POST' : 'GET',body:body ? JSON.stringify(body) : undefined});
  }
  function render() {
    const poses = seats.map(pose), overlap = new Set();
    for (let i=0;i<seats.length;i++) for(let j=0;j<i;j++) {
      if(seats[i].enabled && seats[j].enabled && Math.hypot(...['x','y','z'].map(a=>poses[i].position[a]-poses[j].position[a]))<.2) {overlap.add(i);overlap.add(j);}
    }
    const signature=JSON.stringify(seats.map((s,i)=>[s.label,s.object_id,object(s.object_id)?.name,overlap.has(i)]));
    if(signature!==listSignature){
    listSignature=signature;$('seat-list').replaceChildren();
    seats.forEach((seat,index) => {
      const button=document.createElement('button'); button.type='button';
      button.dataset.label=seat.label;button.setAttribute('aria-label',seat.label);
      button.className='item'+(index===selected?' selected':'');button.textContent=(overlap.has(index)?'⚠ ':'')+seat.label;
      button.addEventListener('click',()=>choose(index));
      button.addEventListener('dblclick',()=>{choose(index);emit('room-seat-focus',index);});
      const parent=object(seat.object_id);
      button.title=parent ? parent.name : tr('unattached','Без привязки к предмету');
      if(parent){const sub=document.createElement('small');sub.textContent=' · '+parent.name;button.append(sub);}
      $('seat-list').append(button);
    });
    }
    [...$('seat-list').children].forEach((button,index)=>button.classList.toggle('selected',index===selected));
    $('seat-overlap').textContent=overlap.size ? tr('overlap','Некоторые места совпадают или находятся слишком близко. Раздвиньте отмеченные места.') : '';
    emit('room-seat-preview',{seats,selected});
  }
  function fields(seat) {
    const p=pose(seat);worldRotation=p.rotation;
    $('seat-object').value=seat.object_id ?? '';$('seat-label').value=seat.label;
    for(const a of ['x','y','z']) $('seat-'+a).value=p.position[a];
    $('seat-yaw').value=p.rotation.y*180/Math.PI;
    $('seat-map-x').value=seat.map_x;$('seat-map-y').value=seat.map_y;
    $('seat-order').value=seat.sort_order;$('seat-enabled').checked=seat.enabled;
  }
  function nextSeat() {
    let n=1;while(seats.some(s=>s.label===String(n)))n++;
    return {object_id:null,coordinate_space:'rigid',label:String(n),sort_order:Math.max(0,...seats.map(s=>s.sort_order))+1,
      local_position:{x:0,y:1,z:0},local_rotation:{x:0,y:0,z:0},map_x:0,map_y:0,enabled:true};
  }
  function flush() {if(formDirty)applyForm();}
  function choose(index) {
    try{flush();}catch(e){$('seat-message').textContent=e.message;return;}
    selected=index;fields(seats[index]||nextSeat());render();
    emit('room-seat-selected',index);
  }
  function applyForm() {
    if(room?.status!=='draft')throw new Error(tr('readOnly','Комната недоступна для редактирования'));
    if(!$('seat-form').checkValidity())throw new Error(tr('invalid','Проверьте параметры места'));
    const object_id=$('seat-object').value===''?null:Number($('seat-object').value);
    const parent=object(object_id);
    if(object_id!==null && (!parent || parent.is_room_shell || parent.is_room_environment))throw new Error(tr('invalid','Проверьте параметры места'));
    const p={position:Object.fromEntries(['x','y','z'].map(a=>[a,Number($('seat-'+a).value)])),
      rotation:{...worldRotation,y:Number($('seat-yaw').value)*Math.PI/180}};
    const seat={...(seats[selected]||{}),object_id,label:$('seat-label').value.trim(),
      sort_order:Number($('seat-order').value),enabled:$('seat-enabled').checked,
      ...RoomSeatCoordinates.local(p,object(object_id)),map_x:Number($('seat-map-x').value),map_y:Number($('seat-map-y').value)};
    if(!seat.label || seats.some((s,i)=>i!==selected && s.label===seat.label))throw new Error(tr('duplicateLabel','Название места уже используется'));
    if(selected<0){if(seats.length>=100)throw new Error(tr('limit','Не более 100 мест'));seats.push(seat);selected=seats.length-1;}else seats[selected]=seat;
    formDirty=false;changed();render();$('seat-message').textContent=tr('unsaved','Изменения ещё не сохранены');
  }
  window.addEventListener('room-editor-loaded',async event=>{
    room=event.detail.room;
    $('seat-object').replaceChildren();
    const free=document.createElement('option');free.value='';free.textContent=tr('unattached','Без привязки к предмету');$('seat-object').append(free);
    for(const o of event.detail.objects){if(o.is_room_shell||o.is_room_environment)continue;const option=document.createElement('option');option.value=o.id;option.textContent=`${o.name||o.type} (#${o.id})`;$('seat-object').append(option);}
    $('seat-new').hidden=room.status!=='draft';$('seat-form').hidden=room.status!=='draft';$('seat-save').hidden=room.status!=='draft';$('seat-mode').disabled=room.status!=='draft';
    if(!loaded)$('seat-mode').checked=room.seating_mode==='seated';
    $('room-return-draft').hidden=room.status!=='closed'||room.allow_rejoin;
    try{
      if(!loaded||(!dirty&&!formDirty)){seats=(await api('/seats')).seats;loaded=true;}
      selected=-1;fields(nextSeat());render();
    }catch(e){$('seat-message').textContent=e.message;}
  });
  $('seat-form').addEventListener('submit',e=>{e.preventDefault();try{applyForm();}catch(error){$('seat-message').textContent=error.message;}});
  $('seat-form').addEventListener('input',()=>{formDirty=true;emit('room-seat-dirty');});
  // Attachment changes use the displayed world pose; reparenting never jumps.
  $('seat-object').addEventListener('change',()=>{formDirty=true;try{applyForm();}catch(e){$('seat-message').textContent=e.message;}});
  $('seat-new').addEventListener('click',()=>{
    try{flush();if(seats.length>=100)throw new Error(tr('limit','Не более 100 мест'));seats.push(nextSeat());changed();choose(seats.length-1);}
    catch(e){$('seat-message').textContent=e.message;}
  });
  $('seat-remove').addEventListener('click',()=>{if(selected<0)return;formDirty=false;seats.splice(selected,1);changed();choose(-1);});
  $('seat-focus').addEventListener('click',()=>{try{flush();if(selected>=0)emit('room-seat-focus',selected);}catch(e){$('seat-message').textContent=e.message;}});
  window.addEventListener('room-seat-picked',e=>choose(e.detail));
  window.addEventListener('room-seat-dragged',e=>{
    if(selected<0||room.status!=='draft')return;
    Object.assign(seats[selected],RoomSeatCoordinates.local(e.detail,object(seats[selected].object_id)));
    formDirty=false;fields(seats[selected]);changed();render();
  });
  async function save() {
    if(!loaded)throw new Error(tr('loading','Дождитесь загрузки мест'));flush();if(!dirty)return;
    $('seat-save').disabled=true;
    try{
      const data=await api('/seats',{revision:room.revision,seats,seating_mode:$('seat-mode').checked?'seated':'free'});
      Object.assign(room,data.room);seats=(await api('/seats')).seats;dirty=false;formDirty=false;choose(-1);
      $('seat-message').textContent=room.id.startsWith('template-')?tr('appliedDraft','Места применены. Сохраните черновик шаблона'):tr('saved','Места сохранены');
    }finally{$('seat-save').disabled=false;emit('room-seat-dirty');}
  }
  window.RoomSeatEditor={save,flush,isDirty:()=>dirty||formDirty,
    deselect:()=>{flush();selected=-1;fields(nextSeat());render();},
    attached:id=>seats.filter(s=>s.object_id===id),
    refresh:()=>{if(selected>=0&&!formDirty)fields(seats[selected]);render();}};
  $('seat-save').addEventListener('click',()=>save().catch(e=>{$('seat-message').textContent=e.message;}));
  $('room-return-draft').addEventListener('click',async()=>{try{await api('/edit',{revision:room.revision});location.reload();}catch(e){$('seat-message').textContent=e.message;}});
  $('seat-mode').addEventListener('change',changed);
  window.addEventListener('beforeunload',e=>{if(dirty||formDirty){e.preventDefault();e.returnValue='';}});
})();
