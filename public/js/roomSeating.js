(() => {
  const t = (key, fallback) => {
    const value = window.i18n?.t('roomSeating.' + key);
    return value && value !== 'roomSeating.' + key ? value : fallback;
  };
  let room, seat, seats = [], version = -1, pending, timeout, panel, overlay, notice, map, toolbar;
  const looks = new Map();
  const seatRows = new Map();
  let lastLookSent = 0;
  let sceneLoaded = false, pickerOpen = false, selectedId = null, labels, placesButton;
  let previewCamera = null, previewTarget = null, previewAngle = Math.PI / 4, savedMouse = null;
  const availablePosition = item => item?.position && ['x','y','z'].every(a => Number.isFinite(item.position[a]));
  function closePicker() {
    pickerOpen=false;panel.hidden=true;labels?.hide();previewCamera=null;previewTarget=null;
    placesButton?.setAttribute('aria-expanded','false');
    if(savedMouse && window.MOUSE){Object.assign(window.MOUSE,savedMouse);window.MOUSE.isDragging=false;}savedMouse=null;
  }
  function setView(item) {
    const positions=(item ? [item] : seats).filter(availablePosition).map(s=>s.position);
    if(!positions.length)return;
    const min={},max={};for(const a of ['x','y','z']){min[a]=Math.min(...positions.map(p=>p[a]));max[a]=Math.max(...positions.map(p=>p[a]));}
    previewTarget=new THREE.Vector3((min.x+max.x)/2,(min.y+max.y)/2+.45,(min.z+max.z)/2);
    const radius=item ? 2.8 : Math.max(4,Math.hypot(max.x-min.x,max.z-min.z)*.8);
    const desired=previewTarget.clone().add(new THREE.Vector3(Math.sin(previewAngle)*radius,Math.min(3.5,radius*.5),Math.cos(previewAngle)*radius));
    // Only the room shell bounds constrain this camera. Raycasting the entire
    // scene touches detailed/skinned GLBs and their BVHs before updating the UI.
    const world=window.gameWorld;
    if(world?.generatedBuildings){
      const direction=desired.clone().sub(previewTarget).normalize();
      let nearest=previewTarget.distanceTo(desired);
      const ray=new THREE.Ray(previewTarget,direction);
      for(const entry of world.generatedBuildings.values()){
        if(!entry.data?.is_room_shell || !entry.model)continue;
        entry.model.updateWorldMatrix(true,true);
        entry.model.traverse(mesh=>{
          if(!mesh.isMesh || !mesh.geometry)return;
          for(let node=mesh;node;node=node.parent)if(!node.visible)return;
          // Shell components are boxes. Intersect in local space to preserve
          // rotated/scaled room bounds without invoking model raycast hooks.
          if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
          if(!mesh.geometry.boundingBox || Math.abs(mesh.matrixWorld.determinant())<1e-12)return;
          const localRay=ray.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
          const point=localRay.intersectBox(mesh.geometry.boundingBox,new THREE.Vector3());
          if(!point)return;
          const distance=point.applyMatrix4(mesh.matrixWorld).distanceTo(previewTarget);
          if(distance>=.15 && distance<nearest)nearest=distance;
        });
      }
      if(nearest<previewTarget.distanceTo(desired))desired.copy(previewTarget).addScaledVector(direction,Math.max(.2,nearest-.2));
    }
    previewCamera=desired;
  }
  function selectForPreview(id) {
    selectedId=id;render();const item=seats.find(s=>s.id===id);if(availablePosition(item))setView(item);
  }
  function openPicker() {
    if(!sceneLoaded || !seat || !WSClient.connected)return;
    pickerOpen=true;panel.hidden=false;placesButton.setAttribute('aria-expanded','true');
    if(window.MOUSE){savedMouse={};for(const k of ['rotationX','rotationY','targetRotationX','targetRotationY'])savedMouse[k]=window.MOUSE[k];window.MOUSE.isDragging=false;}
    selectedId=seat.id;setView();render();
  }
  const mine = () => typeof GAME_STATE !== 'undefined' ? GAME_STATE.characterId : null;
  const button = (text, action, parent) => {
    const element = document.createElement('button'); element.type = 'button'; element.textContent = text;
    element.style.cssText = 'padding:10px;border:1px solid #aaa;border-radius:6px;background:#26354a;color:white;cursor:pointer';
    element.onclick = action; parent.append(element); return element;
  };
  function stopPending() { clearTimeout(timeout); pending = null; }
  function leaveLocal() {
    WSClient.roomEnded = true; WSClient.messageQueue.length = 0; WSClient.ws?.close(); location.assign(location.pathname === '/play' ? '/rooms' : '/');
  }
  function request(type, extra = {}) {
    if (pending || !WSClient.connected || WSClient.ws?.readyState !== WebSocket.OPEN) return;
    pending = crypto.randomUUID();
    WSClient.send({ type, payload: { requestId: pending, ...extra } });
    timeout = setTimeout(() => {
      stopPending(); notice.textContent = t('timeout', 'Ответ не получен. Обновите страницу для проверки места.'); render();
    }, 10000);
    render();
  }
  function apply(characterId, assigned) {
    const data = window.gameWorld?.players?.get(characterId);
    if (!data || !assigned?.position || !assigned.orientation) return;
    data.position = { ...assigned.position };
    data.group.position.set(assigned.position.x, assigned.position.y, assigned.position.z);
    data.group.quaternion.set(assigned.orientation.x, assigned.orientation.y, assigned.orientation.z, assigned.orientation.w);
    data.group.userData.roomSeat = assigned;
  }
  function render() {
    if (!map) return;
    if (!seats.length) {
      if(seatRows.size || !map.children.length){map.replaceChildren();seatRows.clear();
        const text=document.createElement('p');text.textContent=t('loadingSeats','Загружаем места…');map.append(text);}
      return;
    }
    if(!seatRows.size)map.replaceChildren();
    const keep=new Set();
    for (const item of seats) {
      keep.add(item.id);
      const own = item.character_id === mine();
      const status = own ? t('yours','Ваше место') : item.occupancy === 'held' ? t('held','Переподключается')
        : item.occupancy === 'free' ? t('free','Свободно') : t('occupied','Занято') + (item.character_name ? ': '+item.character_name : '');
      let entry=seatRows.get(item.id);
      if(!entry){
        const row=document.createElement('div');row.className='room-seat-row';row.dataset.seatId=item.id;
        const inspect=button('',()=>selectForPreview(item.id),row);inspect.className='room-seat-inspect';
        const take=button('',()=>request('ROOM_SEAT_SELECT',{seatId:item.id}),row);take.className='room-seat-take';
        entry={row,inspect,take};seatRows.set(item.id,entry);map.append(row);
      }
      const {row,inspect,take}=entry;
      row.classList.toggle('selected',item.id===selectedId);
      const caption=t('place','Место')+' '+item.label+': '+status;
      if(inspect.textContent!==caption)inspect.textContent=caption;
      inspect.setAttribute('aria-pressed',String(item.id===selectedId));
      inspect.disabled=!availablePosition(item);inspect.title=t('inspect','Показать место в комнате');
      take.hidden=item.id!==selectedId&&!own;
      const action=own?t('yours','Ваше место'):t('take','Занять');
      if(take.textContent!==action)take.textContent=action;
      take.disabled=!!pending||!WSClient.connected||item.occupancy!=='free'||own;
    }
    for(const [id,entry]of seatRows)if(!keep.has(id)){entry.row.remove();seatRows.delete(id);}
  }
  function build() {
    toolbar = document.createElement('div'); toolbar.style.cssText = 'position:fixed;top:85px;right:16px;z-index:12000;display:flex;gap:8px;flex-wrap:wrap;max-width:calc(100vw - 32px)';
    placesButton=button(t('places', 'Места'), () => pickerOpen ? closePicker() : openPicker(), toolbar);
    placesButton.dataset.i18n='roomSeating.places';
    placesButton.id='room-places-toggle';placesButton.setAttribute('aria-expanded','false');placesButton.setAttribute('aria-controls','room-seat-picker');
    button(t('leave', 'Выйти из комнаты'), () => WSClient.connected ? request('ROOM_LEAVE') : leaveLocal(), toolbar).dataset.i18n='roomSeating.leave';
    document.body.append(toolbar);
    const capacityBadge = document.createElement('span');
    const capacityLabel=document.createElement('span');capacityLabel.dataset.i18n='roomSeating.capacity';capacityLabel.textContent=t('capacity','Лимит участников');
    capacityBadge.append(capacityLabel, ': '+room.capacity);
    capacityBadge.style.cssText = 'background:#171e29;color:white;padding:8px;border-radius:6px';
    toolbar.append(capacityBadge);
    window.MeetingUI?.enter(room, toolbar);
    window.addEventListener?.('avatar-load-error', event => {
      if (event.detail.group !== window.player?.worldObject) return;
      let message = document.getElementById('room-avatar-error');
      if (!message) { message = document.createElement('p'); message.id = 'room-avatar-error'; message.setAttribute('role', 'alert'); message.style.cssText = 'margin:8px 0 0;font-size:12px;color:#ffd595'; toolbar.append(message); }
      message.textContent = window.i18n.t('avatar.roomLoadFailed');
    });
    const style=document.createElement('style');style.textContent=`
      #room-seat-picker{position:fixed;right:16px;top:145px;width:310px;max-height:calc(100dvh - 165px);overflow:auto;box-sizing:border-box;z-index:12001;padding:14px;background:#171e29ee;color:white;border:1px solid #65758a;border-radius:10px;font:14px system-ui}
      #room-seat-picker[hidden],#room-seat-picker [hidden],.room-seat-labels[hidden]{display:none!important}
      #room-seat-picker h2{margin:0 0 8px;font-size:18px}.room-seat-row{padding:6px;margin:6px 0;border:1px solid #536174;border-radius:7px}.room-seat-row.selected{border-color:#ffcc66;background:#394052}
      #room-seat-picker button:disabled{opacity:.5;cursor:default}.room-seat-inspect{width:100%;text-align:left}.room-seat-take{margin-top:6px;width:100%}.room-seat-view-buttons{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}
      @media(max-width:700px){#room-seat-picker{top:auto;bottom:10px;left:10px;right:10px;width:auto;max-height:38dvh}}
    `;document.head.append(style);
    panel=document.createElement('section');panel.id='room-seat-picker';panel.hidden=true;panel.setAttribute('aria-label',t('places','Места'));
    const heading=document.createElement('h2');heading.textContent=t('places','Места');panel.append(heading);
    const help=document.createElement('p');help.textContent=t('pickerHint','Выберите место в списке или по номеру в комнате. Осмотр не меняет вашу посадку.');panel.append(help);
    const views=document.createElement('div');views.className='room-seat-view-buttons';panel.append(views);
    button(t('overview','Обзор комнаты'),()=>{selectedId=null;setView();render();},views);
    button('↶',()=>{previewAngle-=Math.PI/4;setView(seats.find(s=>s.id===selectedId));},views).setAttribute('aria-label',t('viewLeft','Осмотреть слева'));
    button('↷',()=>{previewAngle+=Math.PI/4;setView(seats.find(s=>s.id===selectedId));},views).setAttribute('aria-label',t('viewRight','Осмотреть справа'));
    button(t('close','Закрыть'),()=>{closePicker();placesButton.focus();},views);
    notice=document.createElement('p');notice.setAttribute('role','status');panel.append(notice);
    map=document.createElement('div');map.id='room-seat-list';panel.append(map);document.body.append(panel);
    if(window.RoomSeatLabels)labels=new RoomSeatLabels(selectForPreview);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&pickerOpen){closePicker();placesButton.focus();}});
    overlay = document.createElement('div'); overlay.style.cssText = 'position:fixed;inset:0;z-index:30000;background:#171e29;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;color:white';
    const status = document.createElement('p'); status.dataset.status = ''; status.setAttribute('role','status'); overlay.append(status);
    button(t('retry', 'Повторить вход'), () => location.reload(), overlay);
    button(location.pathname === '/play' ? (window.i18n?.t('roomsLobby.back') || 'В мои комнаты') : t('back', 'На основную карту'), leaveLocal, overlay); document.body.append(overlay);
  }
  window.RoomSeating = {
    active: false,
    enter(value) { if (value.seating_mode !== 'seated') return; room = value; this.active = true; sceneLoaded = false; build(); this.blocked('waiting'); },
    sceneReady() { sceneLoaded = true; if (this.active && seat) overlay.style.display = 'none'; },
    sceneFailed() { if (!this.active) return; this.blocked('sceneError'); },
    blocked(reason) {
      if (!this.active) return;
      const text = { waiting: ['waiting','Назначаем место…'], full: ['full','Комната заполнена'], denied: ['denied','Вход в комнату недоступен'],
        replaced: ['replaced','Персонаж открыт в другой вкладке'], sceneError: ['sceneError','Не удалось загрузить помещение. Повторите вход.'], disconnected: ['disconnected','Соединение потеряно. Восстанавливаем вход…'] }[reason] || ['denied','Вход в комнату недоступен'];
      overlay.querySelector('[data-status]').textContent = t(...text); overlay.style.display = 'flex'; closePicker();
    },
    connecting() { if (!this.active) return; version = -1; stopPending(); this.blocked('waiting'); },
    disconnected() { if (!this.active) return; stopPending(); this.blocked(WSClient.sessionReplaced ? 'replaced' : 'disconnected'); },
    message(type, payload) {
      if (!this.active || !payload) return;
      if (type === 'ROOM_LEFT') return leaveLocal();
      if (type === 'ROOM_SEAT_EXPIRED') { WSClient.roomEnded = true; this.blocked('denied'); return; }
      if (type === 'ROOM_SEAT_ASSIGNED' && payload.roomId === room.id) {
        seat = payload.seat; if (sceneLoaded) overlay.style.display = 'none'; apply(mine(), seat);
      } else if (type === 'ROOM_SEATS_STATE' && payload.roomId === room.id && payload.version > version) {
        version = payload.version; seats = payload.seats; render();
      } else if (type === 'ROOM_SEAT_CHANGED' && payload.roomId === room.id) {
        if (payload.characterId === mine()) seat = payload.seat;
        apply(payload.characterId, payload.seat);
      } else if (type === 'ROOM_SEAT_RESULT' && payload.requestId === pending) {
        stopPending(); if(payload.success && pickerOpen)closePicker(); notice.textContent = payload.success ? t('moved','Место изменено') : t('failed','Не удалось сменить место. Текущее место сохранено.'); render();
      } else if (type === 'ROOM_LOOK' && payload.roomId === room.id) {
        looks.set(payload.characterId, payload.look);
      } else if (type === 'WORLD_STATE') {
        for (const p of payload.players || []) if (p.seat) apply(p.characterId, p.seat);
      } else if (type === 'PLAYER_JOINED' && payload.seat) apply(payload.characterId, payload.seat);
    },
    updateLocal(player, camera) {
      if (!seat) return;
      if (!pickerOpen && typeof MOUSE !== 'undefined' && MOUSE.isDragging) player.targetRotationY = MOUSE.targetRotationY;
      player.position.set(seat.position.x, seat.position.y, seat.position.z);
      apply(player.characterId, seat);
      if(pickerOpen && previewCamera && previewTarget){
        camera.position.copy(previewCamera);camera.lookAt(previewTarget);camera.updateMatrixWorld();return;
      }
      player.updateCamera(camera);
      if (camera.getWorldDirection) {
        const direction = camera.getWorldDirection(new THREE.Vector3());
        const q = seat.orientation;
        direction.applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w).invert());
        const look = { yaw: Math.max(-1.2, Math.min(1.2, Math.atan2(direction.x, direction.z))),
          pitch: Math.max(-.65, Math.min(.65, Math.atan2(-direction.y, Math.hypot(direction.x, direction.z)))) };
        looks.set(player.characterId, look);
        if (WSClient.connected && performance.now() - lastLookSent >= 100) {
          lastLookSent = performance.now(); WSClient.send({ type: 'ROOM_LOOK', payload: look });
        }
      }
    },
    renderPoses(world) {
      if (!this.active) return;
      labels?.update(world.camera,world.renderer?.domElement,seats.map(s=>({id:s.id,label:s.label,
        title:t('place','Место')+' '+s.label,position:s.position,selected:s.id===selectedId,
        color:s.character_id===mine()?'#2461a4':s.occupancy==='free'?'#247846':'#555b66'})),pickerOpen);
      for (const [id, data] of world.players) {
        const assigned = data.group?.userData.roomSeat;
        if (!assigned) continue;
        apply(id, assigned);
        const fallback = window.RoomSeatAvatar?.apply(data.group, looks.get(id));
        if (id === mine() && fallback && notice && !pending) {
          notice.textContent = t('fallback', 'Для этой модели используется упрощённый сидящий персонаж.');
        }
      }
    }
  };
})();
