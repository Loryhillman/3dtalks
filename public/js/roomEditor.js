(() => {
  const id = new URLSearchParams(location.search).get('room');
  const templateKey = new URLSearchParams(location.search).get('template');
  const template = templateKey ? new RoomTemplateSession(templateKey) : null;
  let busy = false, preview = false, objectDirty = false, manipulating = false;
  const message = document.getElementById('message');
  const viewport = document.getElementById('viewport');
  const objects = new Map();
  let seatPreview = [], selectedSeat = -1, selectionMode = 'objects';
  const seatLabels = new RoomSeatLabels(index => {if(selectionMode==='seats')window.dispatchEvent(new CustomEvent('room-seat-picked',{detail:Number(index)}));}, 5);
  const seatMarkers = new Map();
  window.RoomEditorObjects = { get(id) {
    const entry = objects.get(id); if (!entry) return null;
    const value = {...entry.data};
    for (const prefix of ['position','rotation','scale']) for (const a of ['x','y','z']) value[prefix+'_'+a] = entry.group[prefix][a];
    return value;
  }};
  function renderSeatPreview() {
    for (const [index, marker] of seatMarkers) if (index >= seatPreview.length) {
      if (transform.object === marker) transform.detach();
      scene.remove(marker); marker.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});seatMarkers.delete(index);
    }
    seatPreview.forEach((seat,index) => {
      let marker = seatMarkers.get(index);
      if (!marker) {
        marker = new THREE.Group();marker.userData.seatIndex=index;
        marker.add(new THREE.Mesh(new THREE.SphereGeometry(.12,12,8),new THREE.MeshBasicMaterial({color:0xffcc33,depthTest:false})));
        marker.add(new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),.6,0xffcc33));
        marker.renderOrder=1000;scene.add(marker);seatMarkers.set(index,marker);
      }
      const pose = RoomSeatCoordinates.world(seat,window.RoomEditorObjects.get(seat.object_id));
      marker.position.set(pose.position.x,pose.position.y,pose.position.z);
      marker.rotation.set(pose.rotation.x,pose.rotation.y,pose.rotation.z);
      marker.children[0].material.color.set(index===selectedSeat?0x44ff99:seat.enabled?0xffcc33:0x888888);
      marker.visible=!preview;
    });
    if (selectedSeat < 0 && transform.object?.userData.seatIndex !== undefined) transform.detach();
  }
  window.addEventListener('room-seat-preview',event=>{seatPreview=event.detail.seats;selectedSeat=event.detail.selected;renderSeatPreview();});
  window.addEventListener('room-seat-selected',event=>{
    if (busy || preview) return;
    action(async()=>{
      await applyCurrent(); selected=null; objectDirty=false;showPanel('seats');transform.detach();
      selectedSeat=event.detail;
      if (selectedSeat>=0 && room.status==='draft') {transform.setMode('translate');transform.attach(seatMarkers.get(selectedSeat));}
    });
  });
  window.addEventListener('room-seat-focus',event=>{
    const marker=seatMarkers.get(event.detail);if(!marker)return;
    orbit.target.copy(marker.position);camera.position.copy(marker.position).add(new THREE.Vector3(2,2,3));orbit.update();
    if(room.status==='draft'&&!preview){transform.setMode('translate');transform.attach(marker);}
  });
  let room;
  let selected;
  let generation = 0;
  const tr = (key, fallback) => {
    const value = window.i18n?.t('roomEditor.' + key);
    return value && value !== 'roomEditor.' + key ? value : fallback;
  };

  if (!localStorage.getItem('adminToken')) {
    location.replace('/admin_login.html');
    return;
  }
  if (!(template ? /^[a-z][a-z0-9-]{1,79}$/.test(templateKey) : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || ''))) {
    message.textContent = tr('missingId', 'Не указан ID комнаты');
    return;
  }
  if (!window.THREE || !THREE.OrbitControls || !THREE.TransformControls) {
    message.textContent = tr('load3dError', 'Не удалось загрузить 3D-редактор');
    return;
  }

  async function api(path, options = {}) {
    if (template) return template.api(path, options);
    const url = path === '/models' ? '/api/admin/rooms/models' : `/api/admin/rooms/${id}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${localStorage.getItem('adminToken')}`,
        'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
    if (room && data.room) Object.assign(room,data.room);
    return data;
  }
  window.roomEditorApi = api;
  function addModelOption(model) {
    for (const id of ['model-id', 'replace-model']) {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = `${model.name} (#${model.id})`;
      document.getElementById(id).append(option);
    }
  }
  document.getElementById('model-upload-file').addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file || busy || room?.status !== 'draft') return;
    action(async () => {
      message.textContent = tr('modelUploading', 'Загружаем модель…');
      try {
        const model = await RoomModelUpload.upload(file);
        addModelOption(model);
        document.getElementById('model-id').value = model.id;
        document.getElementById('model-name').value = model.name;
        message.textContent = tr('modelUploaded', 'Модель загружена. Нажмите «Добавить в центр», чтобы разместить её.');
      } finally { event.target.value = ''; }
    });
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#202630');
  const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1000);
  camera.position.set(7, 5, 7);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  viewport.append(renderer.domElement);
  const orbit = new THREE.OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 2, 0);
  orbit.enableDamping = true;
  orbit.update();
  const transform = new THREE.TransformControls(camera, renderer.domElement);
  transform.addEventListener('dragging-changed', event => {
    orbit.enabled = !event.value;
    manipulating = true;
    if (!event.value) setTimeout(() => { manipulating = false; }, 0);
  });
  transform.addEventListener('objectChange', () => {
    if (transform.object?.userData.seatIndex !== undefined) {
      const g=transform.object;
      window.dispatchEvent(new CustomEvent('room-seat-dragged',{detail:{position:{x:g.position.x,y:g.position.y,z:g.position.z},rotation:{x:g.rotation.x,y:g.rotation.y,z:g.rotation.z}}}));
    } else {syncPositionFields();objectDirty=true;window.RoomSeatEditor?.refresh();}
    updateTemplateStatus();
  });
  scene.add(transform.getHelper ? transform.getHelper() : transform);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x748090, 2));
  const grid = new THREE.GridHelper(40, 40, 0x64748b, 0x394657);
  grid.position.y = -0.01;
  scene.add(grid);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const loader = new THREE.GLTFLoader();
  const draco = new THREE.DRACOLoader().setDecoderPath('/js/libs/draco/');
  loader.setDRACOLoader(draco);
  const decoderReady = import('/js/libs/meshopt/meshopt_decoder.module.js')
    .then(m => loader.setMeshoptDecoder(m.MeshoptDecoder));

  function resize() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(viewport);
  resize();
  function frame() {
    requestAnimationFrame(frame);
    orbit.update();
    renderer.render(scene, camera);
    seatLabels.update(camera,renderer.domElement,seatPreview.map((seat,index)=>({id:index,label:seat.label,
      position:RoomSeatCoordinates.world(seat,window.RoomEditorObjects.get(seat.object_id)).position,
      selected:index===selectedSeat,color:seat.enabled?'#8a6200':'#555b66'})),!preview,selectionMode==='seats');
  }
  frame();

  function syncPositionFields() {
    if (!selected) return;
    const group = objects.get(selected.id)?.group;
    if (!group) return;
    for (const [axis, input] of [['x', 'pos-x'], ['y', 'pos-y'], ['z', 'pos-z']]) {
      document.getElementById(input).value = String(group.position[axis]);
      document.getElementById('rot-'+axis).value = String(group.rotation[axis] * 180 / Math.PI);
      document.getElementById('scale-'+axis).value = String(group.scale[axis]);
    }
  }

  function currentBody() {
    if (!document.getElementById('edit-form').reportValidity()) throw new Error(tr('invalidTransform', 'Проверьте координаты и размеры'));
    const body = { has_collision: document.getElementById('object-collision').checked };
    if (template) body.name = document.getElementById('object-name').value.trim();
    for (const a of ['x','y','z']) {
      body['position_'+a] = Number(document.getElementById('pos-'+a).value);
      body['rotation_'+a] = Number(document.getElementById('rot-'+a).value) * Math.PI / 180;
      body['scale_'+a] = Number(document.getElementById('scale-'+a).value);
    }
    return body;
  }
  async function applyCurrent() {
    if (!selected || !objectDirty) return;
    const data = await api(`/objects/${selected.id}`, { method: 'PATCH', body: JSON.stringify(currentBody()) });
    Object.assign(selected, data.object || {});
    objectDirty = false;
  }
  function updateTemplateStatus() {
    if (!template?.draft) return;
    const dirty = template.dirty || objectDirty || window.RoomSeatEditor?.isDirty() || window.RoomEnvelopeEditor?.isDirty();
    document.getElementById('template-status').textContent =
      `${tr('publishedVersion', 'Опубликованная версия')}: ${template.draft.base_version}. ` +
      (dirty ? tr('unsavedDraft', 'Есть несохранённые изменения') : tr('draftSaved', 'Черновик сохранён'));
  }
  async function action(fn) {
    if (busy) return;
    busy = true; document.body.classList.add('saving');
    try { await fn(); } catch (error) { message.textContent = error.message; }
    finally { busy = false; document.body.classList.remove('saving'); updateTemplateStatus(); }
  }

  async function choose(object) {
    if (busy || preview || selected?.id === object.id) return;
    if(object.is_room_shell){showPanel('room');return;}
    try { window.RoomSeatEditor?.deselect(); } catch(error) {message.textContent=error.message;return;}
    if (objectDirty) {
      if (template) { try { await applyCurrent(); } catch (error) { message.textContent = error.message; return; } }
      else if (!confirm(tr('discardTransform', 'Отменить несохранённые изменения предмета?'))) return;
    }
    objectDirty = false;
    showPanel('objects');
    selected = object;
    const group = objects.get(object.id)?.group;
    if (!group) return;
    transform.detach();
    if (room.status === 'draft') transform.attach(group);
    document.getElementById('edit-form').hidden = room.status !== 'draft';
    document.getElementById('selected-name').textContent = `${object.name} (#${object.id})`;
    document.getElementById('object-name').value = object.name || '';
    document.getElementById('object-collision').checked = object.has_collision === true;
    syncPositionFields();
    document.querySelectorAll('.item').forEach(button =>
      button.classList.toggle('selected', Number(button.dataset.id) === object.id));
  }

  renderer.domElement.addEventListener('pointerup', event => {
    if (busy || preview || manipulating || !orbit.enabled || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const seatHits=raycaster.intersectObjects([...seatMarkers.values()],true);
    if(seatHits.length){let node=seatHits[0].object;while(node&&node.userData.seatIndex===undefined)node=node.parent;
      if(node && selectionMode==='seats'){window.dispatchEvent(new CustomEvent('room-seat-picked',{detail:node.userData.seatIndex}));return;}}
    if(selectionMode==='seats')return;
    const hits = raycaster.intersectObjects([...objects.values()].map(entry => entry.group), true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && node.userData.roomObjectId == null) node = node.parent;
      if (node) {
        const object = objects.get(node.userData.roomObjectId)?.data;
        if(object?.is_room_shell){
          if(selectionMode==='room') {showPanel('room');if(hit.object.userData.roomSurface)window.dispatchEvent(new CustomEvent('room-surface-picked',{detail:hit.object.userData.roomSurface}));return;}
          continue;
        }
        if(selectionMode!=='room'&&object)choose(object);
        if(selectionMode!=='room')return;
      }
    }
  });

  function visualFor(object, token) {
    const group = new THREE.Group();
    group.userData.roomObjectId = object.id;
    group.position.set(object.position_x || 0, object.position_y || 0, object.position_z || 0);
    group.rotation.set(object.rotation_x || 0, object.rotation_y || 0, object.rotation_z || 0);
    group.scale.set(object.scale_x ?? 1, object.scale_y ?? 1, object.scale_z ?? 1);
    if (object.type === 'geometry_building' && object.geometry_data?.components?.length) {
      group.add(GeometryRenderer.renderFromComponents(object.geometry_data.components, THREE));
    } else if (object.type === 'uploaded_model' && object.model_path?.toLowerCase().endsWith('.glb')) {
      const placeholder = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x5b9dca, wireframe: true }));
      group.add(placeholder);
      decoderReady.then(() => loader.load(object.model_path, gltf => {
        if (token !== generation) return;
        group.remove(placeholder);
        group.add(gltf.scene);
      }, undefined, () => { message.textContent = `${tr('modelLoadError', 'Не загрузилась модель')}: ${object.model_path}`; }))
        .catch(error => { message.textContent = error.message; });
    } else {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x5b9dca, wireframe: true })));
    }
    scene.add(group);
    objects.set(object.id, { data: object, group });
  }

  async function loadObjects() {
    await window.RoomEnvelopeEditor?.flush();
    const data = await api('/objects');
    generation++;
    transform.detach();
    selected = null;
    objectDirty = false;
    document.getElementById('edit-form').hidden = true;
    for (const entry of objects.values()) {
      scene.remove(entry.group);
      entry.group.traverse(node => { node.geometry?.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of materials) if (m) { for (const value of Object.values(m)) if (value?.isTexture) value.dispose(); m.dispose(); }
      });
    }
    objects.clear();
    const list = document.getElementById('object-list');
    list.replaceChildren();
    for (const object of data.objects) {
      visualFor(object, generation);
      if(object.is_room_shell)continue;
      const button = document.createElement('button');
      button.className = 'item';
      button.dataset.id = object.id;
      button.textContent = `${object.name || object.type} (#${object.id})`;
      button.dataset.search = button.textContent.toLocaleLowerCase();
      button.addEventListener('click', () => choose(object));
      button.addEventListener('dblclick', async () => {await choose(object);focusObject(object.id);});
      list.append(button);
    }
    renderSeatPreview();filterElements();
    window.dispatchEvent(new CustomEvent('room-editor-loaded', { detail: { room, objects: data.objects } }));
  }

  async function init() {
    try {
      await window.i18n?.init();
      if (template) await template.init();
      document.documentElement.lang = window.i18n?.currentLocale || 'ru-RU';
      document.querySelectorAll('[data-i18n]').forEach(element => {
        const value = window.i18n?.t(element.dataset.i18n);
        if (value && value !== element.dataset.i18n) element.textContent = value;
      });
      room = (await api('')).room;
      document.getElementById('room-title').textContent = room.name;
      document.getElementById('room-status').textContent =
        room.status === 'draft' ? tr('draft', 'Черновик — изменения доступны') :
          tr('readOnly', 'Комната открыта только для просмотра');
      document.getElementById('add-form').hidden = room.status !== 'draft';
      document.getElementById('model-upload-panel').hidden = room.status !== 'draft';
      document.getElementById('template-panel').hidden = !template;
      document.getElementById('template-object-actions').hidden = room.status !== 'draft';
      document.getElementById('replace-model-label').hidden = !template;
      document.getElementById('replace-object').hidden = !template;
      document.getElementById('object-name-label').hidden = !template;
      if (template) document.getElementById('template-name').value = template.draft.name;
      for (const model of (await api('/models')).models) {
        addModelOption(model);
      }
      await loadObjects();
      updateTemplateStatus();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  document.getElementById('move-mode').addEventListener('click', () => transform.setMode('translate'));
  function focusObject(id) {
    const group=objects.get(id)?.group;if(!group)return;
    const box=new THREE.Box3().setFromObject(group),target=box.getCenter(new THREE.Vector3());
    const radius=Math.max(1,Math.min(20,box.getSize(new THREE.Vector3()).length()*.6));
    orbit.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(radius,radius*.7,radius));orbit.update();
  }
  function filterElements() {
    const query=document.getElementById('element-search').value.trim().toLocaleLowerCase();
    for(const button of document.querySelectorAll('#object-list .item,#seat-list .item'))button.hidden=!button.textContent.toLocaleLowerCase().includes(query);
  }
  document.getElementById('element-search').addEventListener('input',filterElements);
  window.addEventListener('room-seat-preview',filterElements);
  function showPanel(panel) {
    selectionMode=panel;
    document.getElementById('room-panel').hidden=panel!=='room';
    document.getElementById('room-properties').hidden=panel!=='room';
    document.getElementById('show-room').setAttribute('aria-pressed',String(panel==='room'));
    document.getElementById('objects-panel').hidden=panel!=='objects';
    document.getElementById('seat-panel').hidden=panel!=='seats';
    document.getElementById('object-properties').hidden=panel!=='objects';
    document.getElementById('seat-properties').hidden=panel!=='seats';
    document.getElementById('show-objects').setAttribute('aria-pressed',String(panel==='objects'));
    document.getElementById('show-seats').setAttribute('aria-pressed',String(panel==='seats'));
    transform.detach();
    if(!preview && room?.status==='draft') {
      if(panel==='objects' && selected)transform.attach(objects.get(selected.id).group);
      if(panel==='seats' && selectedSeat>=0){transform.setMode('translate');transform.attach(seatMarkers.get(selectedSeat));}
    }
  }
  document.getElementById('show-room').addEventListener('click',()=>showPanel('room'));
  window.addEventListener('room-envelope-selected',()=>showPanel('room'));
  window.addEventListener('room-envelope-preview',event=>{
    const entry=objects.get(event.detail.id);if(!entry)return;
    for(const child of [...entry.group.children]){entry.group.remove(child);child.traverse(n=>{n.geometry?.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])if(m){m.map?.dispose();m.dispose();}});}
    entry.group.scale.set(1,1,1);entry.group.add(GeometryRenderer.renderFromComponents(RoomEnvelope.components(event.detail.envelope),THREE));
    entry.data.room_envelope=event.detail.envelope;
    renderSeatPreview();
  });
  document.getElementById('show-objects').addEventListener('click',()=>showPanel('objects'));
  document.getElementById('show-seats').addEventListener('click',()=>showPanel('seats'));
  document.getElementById('rotate-mode').addEventListener('click', () => transform.setMode('rotate'));
  document.getElementById('scale-mode').addEventListener('click', () => {if(transform.object?.userData.seatIndex===undefined)transform.setMode('scale');});
  document.getElementById('preview-mode').addEventListener('click', () => {
    preview = !preview; grid.visible = !preview;
    transform.detach();
    if (!preview && selected && room.status === 'draft') transform.attach(objects.get(selected.id).group);
    renderSeatPreview();
    document.getElementById('preview-mode').textContent = preview ? tr('backToEditing', 'Вернуться к редактированию') : tr('preview', 'Предпросмотр');
  });
  document.getElementById('edit-form').addEventListener('input', () => {
    if (!selected) return;
    objectDirty = true;
    const group = objects.get(selected.id).group;
    for (const a of ['x','y','z']) {
      for (const [field,prefix,multiplier] of [['position','pos',1],['rotation','rot',Math.PI/180],['scale','scale',1]]) {
        const input = document.getElementById(prefix+'-'+a);
        if (input.value !== '' && input.validity.valid && Number.isFinite(Number(input.value))) group[field][a] = Number(input.value)*multiplier;
      }
    }
    window.RoomSeatEditor?.refresh();
    updateTemplateStatus();
  });
  document.getElementById('add-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      if (template) { await applyCurrent(); await window.RoomSeatEditor?.save(); }
      await api('/objects', { method: 'POST', body: JSON.stringify({
        model_id: Number(document.getElementById('model-id').value),
        name: document.getElementById('model-name').value,
        position_x: 0, position_y: 0, position_z: 0,
        rotation_x: 0, rotation_y: 0, rotation_z: 0,
        scale_x: 1, scale_y: 1, scale_z: 1, has_collision: true
      }) });
      document.getElementById('model-name').value = '';
      await loadObjects();
      message.textContent = tr('added', 'Предмет добавлен');
    } catch (error) { message.textContent = error.message; }
  });
  document.getElementById('edit-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!selected) return;
    try {
      objectDirty = true;
      await applyCurrent();
      await loadObjects();
      message.textContent = template ? tr('appliedDraft', 'Изменения применены. Сохраните черновик') : tr('saved', 'Положение сохранено');
    } catch (error) { message.textContent = error.message; }
  });
  document.getElementById('delete-object').addEventListener('click', async () => {
    if (!selected || !confirm(tr('confirmDelete', 'Удалить этот предмет?'))) return;
    try {
      await applyCurrent();
      await window.RoomSeatEditor?.save();
      const attached=window.RoomSeatEditor?.attached(selected.id)||[];
      let seats='delete';
      if(attached.length){
        seats=prompt(tr('deleteSeatsChoice','У предмета есть места. Введите 1 — оставить места отдельно, 2 — удалить вместе с предметом.'),'1');
        if(seats!=='1'&&seats!=='2')return;
        seats=seats==='1'?'keep':'delete';
      }
      await api(`/objects/${selected.id}`, { method: 'DELETE', body:JSON.stringify({seats}) });
      await loadObjects();
      message.textContent = tr('deleted', 'Предмет удалён');
    } catch (error) { message.textContent = error.message; }
  });
  document.getElementById('template-name').addEventListener('input', event => {
    if (template) { template.draft.name = event.target.value; template.changed(); }
  });
  window.addEventListener('room-template-changed', updateTemplateStatus);
  window.addEventListener('room-seat-dirty', updateTemplateStatus);
  async function prepareTemplate() { await window.RoomEnvelopeEditor?.flush(); window.RoomSeatEditor?.flush(); await applyCurrent(); await window.RoomSeatEditor?.save(); }
  document.getElementById('template-save').addEventListener('click', () => action(async () => {
    await prepareTemplate(); await template.save(); message.textContent = tr('draftSaved', 'Черновик сохранён');
  }));
  document.getElementById('template-publish').addEventListener('click', () => {
    if (!confirm(tr('confirmPublish', 'Опубликовать обстановку для новых комнат?'))) return;
    action(async () => { await prepareTemplate(); const version = await template.publish();
      message.textContent = `${tr('publishedVersion', 'Опубликованная версия')}: ${version}`;
    });
  });
  document.getElementById('replace-object').addEventListener('click', () => action(async () => {
    if (!selected) return;
    await prepareTemplate();
    await api(`/objects/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ model_id: Number(document.getElementById('replace-model').value) }) });
    await loadObjects(); message.textContent = tr('modelReplaced', 'Модель заменена. Проверьте размер и положение посадки');
  }));
  document.getElementById('copy-object').addEventListener('click', () => action(async () => {
    if (!selected) return;
    await prepareTemplate(); await api(`/objects/${selected.id}/copy`, { method: 'POST' }); await loadObjects();
  }));
  window.addEventListener('beforeunload', event => {
    if (objectDirty || template?.dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  init();
})();
