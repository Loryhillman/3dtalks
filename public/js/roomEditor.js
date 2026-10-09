(() => {
  const id = new URLSearchParams(location.search).get('room');
  const templateKey = new URLSearchParams(location.search).get('template');
  const template = templateKey ? new RoomTemplateSession(templateKey) : null;
  let busy = false, preview = false, objectDirty = false, manipulating = false;
  const message = document.getElementById('message');
  const viewport = document.getElementById('viewport');
  const objects = new Map();
  let environmentHelper, environmentSignature, framedEnvironment, frameId, environmentProposal, seatAvatar;
  let placementIssues=[];
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
    const seat=seatPreview[selectedSeat];
    const show=!!seat&&selectionMode==='seats'&&document.getElementById('seat-avatar-preview').checked;
    if(show){
      if(!seatAvatar){seatAvatar=AvatarBase.create().characterGroup;seatAvatar.userData.editorSeatAvatar=true;scene.add(seatAvatar);}
      const pose=RoomSeatCoordinates.world(seat,window.RoomEditorObjects.get(seat.object_id));
      seatAvatar.position.set(pose.position.x,pose.position.y,pose.position.z);
      seatAvatar.rotation.set(pose.rotation.x,pose.rotation.y,pose.rotation.z);
      RoomSeatAvatar.apply(seatAvatar); // Reset to the seat before the procedural hip offset.
    }
    if(seatAvatar)seatAvatar.visible=show;
    updatePlacementCheck();
  }
  document.getElementById('seat-avatar-preview').addEventListener('change',renderSeatPreview);

  function updatePlacementCheck(){
    const rows=[...objects.values()].map(entry=>window.RoomEditorObjects.get(entry.data.id));
    if(environmentProposal){
      const i=rows.findIndex(o=>o.is_room_shell||o.is_room_environment);
      const row={...environmentProposal.data,id:i<0?'proposal':rows[i].id,is_room_environment:true};
      if(i<0)rows.push(row);else rows[i]=row;
    }
    placementIssues=RoomPlacementCheck.check(rows,seatPreview,(seat,object)=>RoomSeatCoordinates.world(seat,object));
    const tr=key=>window.i18n.t('roomPlacement.'+key);
    document.getElementById('placement-summary').textContent=placementIssues.length?tr('review'):tr('valid');
    const list=document.getElementById('placement-issues');list.replaceChildren();
    for(const issue of placementIssues.slice(0,20)){
      const li=document.createElement('li');li.dataset.type=issue.type;
      li.textContent=tr(issue.type)+(issue.label!=null?': '+issue.label:issue.name!=null?': '+issue.name:'');list.append(li);
    }
    if(placementIssues.length>20){const li=document.createElement('li');li.textContent=tr('more')+': '+(placementIssues.length-20);list.append(li);}
    const badSeats=new Set(placementIssues.filter(i=>i.index!=null).map(i=>i.index));
    for(const [index,marker]of seatMarkers)marker.children[0].material.color.set(badSeats.has(index)?0xff6655:index===selectedSeat?0x44ff99:seatPreview[index]?.enabled?0xffcc33:0x888888);
    const badObjects=new Set(placementIssues.filter(i=>i.id!=null).map(i=>String(i.id)));
    for(const button of document.querySelectorAll('#object-list .item'))button.classList.toggle('placement-error',badObjects.has(button.dataset.id));
    [...document.getElementById('seat-list').children].forEach((button,index)=>button.classList.toggle('placement-error',badSeats.has(index)));
  }
  window.addEventListener('room-seat-preview',event=>{seatPreview=event.detail.seats;selectedSeat=event.detail.selected;renderSeatPreview();updateSelection();});
  window.addEventListener('room-seat-selected',event=>{
    if (busy || preview) return;
    action(async()=>{
      await applyCurrent(); selected=null; objectDirty=false;
      document.getElementById('edit-form').hidden=true;
      updateSelection();showPanel('seats');transform.detach();
      selectedSeat=event.detail;
      updateSelection();
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
        if (template) template.models.push(model);
        addModelOption(model);
        document.getElementById('model-id').value = model.id;
        document.getElementById('model-name').value = model.name;
        message.textContent = tr('modelUploaded', 'Модель загружена. Нажмите «Добавить предмет», чтобы разместить её.');
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
  const selectionBox = new THREE.BoxHelper(new THREE.Group(), 0xffcc66);
  selectionBox.visible = false; scene.add(selectionBox);
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
    .then(m => loader.setMeshoptDecoder(m.MeshoptDecoder))
    .catch(error => { console.warn('[RoomEditor] Meshopt decoder unavailable:',error); });

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
    frameId = requestAnimationFrame(frame);
    orbit.update();
    if (selectionBox.visible) selectionBox.update();
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
    updateSelection();
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
    const controls = [...document.querySelectorAll('button')];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    document.body.setAttribute('aria-busy', 'true');
    const panels = [...document.querySelectorAll('aside,main,#editor-header')];
    const inert = panels.map(panel => panel.inert);
    panels.forEach(panel => { panel.inert = true; });
    try { await fn(); } catch (error) { message.textContent = error.message; }
    finally {
      controls.forEach((control, index) => { if (control.isConnected) control.disabled = disabled[index]; });
      panels.forEach((panel, index) => { panel.inert = inert[index]; });
      busy = false; document.body.classList.remove('saving'); document.body.setAttribute('aria-busy', 'false');
      updateTemplateStatus(); updateSelection();
    }
  }

  function updateSelection() {
    const group = objects.get(selected?.id)?.group;
    selectionBox.visible = !!group && !preview && selectionMode === 'objects';
    if (group) selectionBox.setFromObject(group);
    document.querySelectorAll('#object-list .item').forEach(button =>
      button.classList.toggle('selected', Number(button.dataset.id) === selected?.id));
    if (selected) {
      const label = `${selected.name} (#${selected.id})`;
      document.getElementById('selected-name').textContent = label;
      const button = document.querySelector(`#object-list [data-id="${selected.id}"]`);
      if (button) button.textContent = label;
    }
    document.getElementById('deselect').disabled = !selected && selectedSeat < 0;
    document.getElementById('placement-beside').disabled = !selected;
    if (!selected) document.getElementById('add-placement').value = 'center';
    document.getElementById('selection-empty').hidden = !!selected;
  }
  function selectObject(object) {
    selected = object || null;
    transform.detach();
    document.getElementById('edit-form').hidden = !selected || room.status !== 'draft';
    if (selected) {
      if (!preview && selectionMode === 'objects' && room.status === 'draft') transform.attach(objects.get(selected.id).group);
      document.getElementById('selected-name').textContent = `${selected.name} (#${selected.id})`;
      document.getElementById('object-name').value = selected.name || '';
      document.getElementById('object-collision').checked = selected.has_collision === true;
      syncPositionFields();
    }
    updateSelection();
  }
  async function clearSelection() {
    await applyCurrent();
    window.RoomSeatEditor?.deselect();
    selectedSeat = -1; selectObject(null); renderSeatPreview();
  }
  async function choose(object) {
    if (busy || preview || selected?.id === object.id) return;
    return action(async () => {
      await applyCurrent();
      window.RoomSeatEditor?.deselect();
      if (object.is_room_shell || object.is_room_environment) { selectObject(null); showPanel('room'); return; }
      showPanel('objects'); selectObject(objects.get(object.id)?.data);
    });
  }
  document.getElementById('deselect').addEventListener('click', () => action(clearSelection));
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || busy || manipulating || preview || event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault(); action(clearSelection);
  });
  let pointerDown;
  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button === 0) pointerDown = { x: event.clientX, y: event.clientY, id: event.pointerId, moved: false };
  });
  renderer.domElement.addEventListener('pointermove', event => {
    if (pointerDown && Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 5) pointerDown.moved = true;
  });
  renderer.domElement.addEventListener('pointercancel', () => { pointerDown = null; });
  renderer.domElement.addEventListener('pointerup', event => {
    const down = pointerDown; pointerDown = null;
    if (!down || down.id !== event.pointerId || down.moved || Math.hypot(event.clientX-down.x,event.clientY-down.y)>5 || busy || preview || manipulating || !orbit.enabled || event.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const seatHits=raycaster.intersectObjects([...seatMarkers.values()],true);
    if(seatHits.length){let node=seatHits[0].object;while(node&&node.userData.seatIndex===undefined)node=node.parent;
      if(node && selectionMode==='seats'){window.dispatchEvent(new CustomEvent('room-seat-picked',{detail:node.userData.seatIndex}));return;}}
    if(selectionMode==='seats'){action(clearSelection);return;}
    const hits = raycaster.intersectObjects([...objects.values()].map(entry => entry.group), true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && node.userData.roomObjectId == null) node = node.parent;
      if (node) {
        const object = objects.get(node.userData.roomObjectId)?.data;
        if(object?.is_room_environment){if(selectionMode==='room'){showPanel('room');return;}continue;}
        if(object?.is_room_shell){
          if(selectionMode==='room') {showPanel('room');if(hit.object.userData.roomSurface)window.dispatchEvent(new CustomEvent('room-surface-picked',{detail:hit.object.userData.roomSurface}));return;}
          continue;
        }
        if(selectionMode!=='room'&&object)choose(object);
        if(selectionMode!=='room')return;
      }
    }
    if (selectionMode !== 'room') action(clearSelection);
  });

  function visualFor(object) {
    const group = new THREE.Group();
    group.userData.roomObjectId = object.id;
    group.position.set(object.position_x || 0, object.position_y || 0, object.position_z || 0);
    group.rotation.set(object.rotation_x || 0, object.rotation_y || 0, object.rotation_z || 0);
    group.scale.set(object.scale_x ?? 1, object.scale_y ?? 1, object.scale_z ?? 1);
    const entry = { data: object, group, state: 'ready' };
    scene.add(group); objects.set(object.id,entry);
    if (object.type === 'geometry_building' && object.geometry_data?.components?.length) {
      group.add(GeometryRenderer.renderFromComponents(object.geometry_data.components, THREE));
    } else if (object.type === 'uploaded_model' && object.model_path?.toLowerCase().endsWith('.glb')) {
      if (!object.is_room_environment) {
        entry.placeholder = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),new THREE.MeshStandardMaterial({color:0x5b9dca,wireframe:true}));
        group.add(entry.placeholder);
      }
      loadModel(entry);
    } else {
      group.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0x5b9dca, wireframe: true })));
    }
  }

  async function loadModel(entry) {
    entry.controller?.abort();
    if (message.textContent === entry.errorMessage) message.textContent = '';
    const controller = new AbortController(); entry.controller = controller; entry.state = 'loading'; entry.error = '';
    syncEnvironmentView();
    let root;
    try {
      if (!entry.data.is_room_environment) await decoderReady;
      const response = await fetch(entry.data.model_path,{signal:controller.signal});
      if (!response.ok) throw new Error('HTTP '+response.status);
      const buffer = await response.arrayBuffer();
      if (controller.signal.aborted || objects.get(entry.data.id) !== entry) return;
      const directory = new URL('.',new URL(entry.data.model_path,document.baseURI)).href;
      root = (await loader.parseAsync(buffer,directory)).scene;
      if (controller.signal.aborted || objects.get(entry.data.id) !== entry) { disposeGroup(root); return; }
      if (!root) throw new Error('GLB scene missing');
      if (entry.placeholder) {entry.group.remove(entry.placeholder);disposeGroup(entry.placeholder);entry.placeholder=null;}
      entry.group.add(root);entry.state='ready';syncEnvironmentView();
    } catch (error) {
      if (controller.signal.aborted || objects.get(entry.data.id) !== entry) return;
      entry.state='error';entry.error=error.message;
      entry.errorMessage=tr('modelLoadError','Не загрузилась модель')+': '+entry.data.name+' ('+error.message+')';
      message.textContent=entry.errorMessage;
      syncEnvironmentView();
    }
  }

  function removeVisual(entry) {
    entry.controller?.abort();scene.remove(entry.group);disposeGroup(entry.group);
  }

  function syncEnvironmentView() {
    if(environmentProposal?.helper)environmentProposal.helper.visible=!preview&&document.getElementById('environment-bounds').checked;
    const entry=[...objects.values()].find(e=>e.data.is_room_environment);
    document.getElementById('room-environment-preview').hidden=!entry;
    if (!entry) {
      if(environmentHelper){scene.remove(environmentHelper);disposeGroup(environmentHelper);environmentHelper=null;}
      environmentSignature=null;framedEnvironment=null;return;
    }
    const object=entry.data, box=RoomEnvironmentView.bounds(object);
    const signature=JSON.stringify([object.room_environment,...['position','rotation','scale'].flatMap(p=>['x','y','z'].map(a=>object[p+'_'+a]))]);
    if(signature!==environmentSignature){
      if(environmentHelper){scene.remove(environmentHelper);disposeGroup(environmentHelper);}
      environmentHelper=RoomEnvironmentView.helper(object);environmentSignature=signature;if(environmentHelper)scene.add(environmentHelper);
    }
    if(environmentHelper)environmentHelper.visible=!environmentProposal&&!preview&&document.getElementById('environment-bounds').checked;
    entry.group.visible=!environmentProposal;
    document.getElementById('environment-name').textContent=object.name;
    const b=object.room_environment?.bounds,s=Number(object.scale_x);
    const size=box&&new THREE.Vector3((b.max.x-b.min.x)*s,(b.max.y-b.min.y)*s,(b.max.z-b.min.z)*s);
    document.getElementById('environment-size').textContent=size ? [size.x,size.y,size.z].map(n=>Number(n.toFixed(2))).join(' × ')+' '+tr('metres','м') : tr('environmentInvalid','Некорректные границы помещения');
    document.getElementById('environment-load-status').textContent=entry.state==='ready'?tr('environmentReady','Помещение загружено'):entry.state==='error'?tr('environmentFailed','Не удалось загрузить помещение')+' ('+entry.error+')':tr('environmentLoading','Загрузка помещения…');
    document.getElementById('environment-retry').hidden=entry.state!=='error';
    const key=object.id+':'+object.model_path;
    if(box && framedEnvironment!==key){framedEnvironment=key;RoomEnvironmentView.fit(camera,orbit,box);}
  }
  document.getElementById('environment-bounds').addEventListener('change',syncEnvironmentView);
  document.getElementById('environment-retry').addEventListener('click',()=>{
    if(busy)return;const entry=[...objects.values()].find(e=>e.data.is_room_environment);if(entry?.state==='error')loadModel(entry);
  });

  function disposeGroup(group) {
    if(!group)return;
    const geometries=new Set(),materials=new Set(),textures=new Set();
    group.traverse(node => { if(node.geometry)geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) {
        materials.add(material);for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for(const value of textures)value.dispose();for(const value of materials)value.dispose();for(const value of geometries)value.dispose();
  }
  const visualSignature = object => JSON.stringify([object.type, object.model_path, object.geometry_data]);
  async function loadObjects(selectId = selected?.id) {
    await window.RoomEnvelopeEditor?.flush();
    const data = await api('/objects');
    const ids = new Set(data.objects.map(object => object.id));
    for (const [key, entry] of objects) if (!ids.has(key)) {
      if (transform.object === entry.group) transform.detach();
      removeVisual(entry); objects.delete(key);
    }
    for (const object of data.objects) {
      const entry = objects.get(object.id);
      if (entry && visualSignature(entry.data) === visualSignature(object)) {
        Object.assign(entry.data, object);
        for (const prefix of ['position','rotation','scale']) entry.group[prefix].set(...['x','y','z'].map(a => object[prefix+'_'+a] ?? (prefix==='scale'?1:0)));
      } else {
        if (entry) { transform.detach(); removeVisual(entry); objects.delete(object.id); }
        visualFor(object);
      }
    }
    objectDirty = false;
    const list = document.getElementById('object-list');
    list.replaceChildren();
    for (const object of data.objects) {
      if(object.is_room_shell||object.is_room_environment)continue;
      const button = document.createElement('button');
      button.className = 'item';
      button.dataset.id = object.id;
      button.textContent = `${object.name || object.type} (#${object.id})`;
      button.dataset.search = button.textContent.toLocaleLowerCase();
      button.addEventListener('click', () => choose(object));
      button.addEventListener('dblclick', async () => {await choose(object);focusObject(object.id);});
      list.append(button);
    }
    const selection=objects.get(selectId)?.data;
    selectObject(selection?.is_room_environment||selection?.is_room_shell?null:selection);
    syncEnvironmentView();
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
      updateTemplateStatus(); updateSelection();
    } catch (error) {
      message.textContent = error.message;
    }
  }

  document.getElementById('move-mode').addEventListener('click', () => transform.setMode('translate'));
  document.getElementById('focus-room').addEventListener('click',()=>{
    if(environmentProposal){RoomEnvironmentView.fit(camera,orbit,RoomEnvironmentView.bounds(environmentProposal.data));return;}
    const entry=[...objects.values()].find(e=>e.data.is_room_environment||e.data.is_room_shell);if(!entry)return;
    const box=entry.data.is_room_environment?RoomEnvironmentView.bounds(entry.data):new THREE.Box3().setFromObject(entry.group);
    RoomEnvironmentView.fit(camera,orbit,box);
  });
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
    transform.detach(); updateSelection();renderSeatPreview();
    if(!preview && room?.status==='draft') {
      if(panel==='objects' && selected)transform.attach(objects.get(selected.id).group);
      if(panel==='seats' && selectedSeat>=0){transform.setMode('translate');transform.attach(seatMarkers.get(selectedSeat));}
    }
  }
  const switchPanel = panel => action(async () => { await applyCurrent(); window.RoomSeatEditor?.flush(); showPanel(panel); });
  document.getElementById('show-room').addEventListener('click',()=>switchPanel('room'));
  window.addEventListener('room-envelope-selected',()=>showPanel('room'));
  window.addEventListener('room-envelope-preview',event=>{
    const entry=objects.get(event.detail.id);if(!entry)return;
    for(const child of [...entry.group.children]){entry.group.remove(child);child.traverse(n=>{n.geometry?.dispose();for(const m of Array.isArray(n.material)?n.material:[n.material])if(m){m.map?.dispose();m.dispose();}});}
    entry.group.scale.set(1,1,1);entry.group.add(GeometryRenderer.renderFromComponents(RoomEnvelope.components(event.detail.envelope),THREE));
    entry.data.room_envelope=event.detail.envelope;
    renderSeatPreview();
  });
  document.getElementById('show-objects').addEventListener('click',()=>switchPanel('objects'));
  document.getElementById('show-seats').addEventListener('click',()=>switchPanel('seats'));
  document.getElementById('rotate-mode').addEventListener('click', () => transform.setMode('rotate'));
  document.getElementById('scale-mode').addEventListener('click', () => {if(transform.object?.userData.seatIndex===undefined)transform.setMode('scale');});
  document.getElementById('preview-mode').addEventListener('click', () => action(async () => {
    await applyCurrent(); window.RoomSeatEditor?.flush();
    preview = !preview; grid.visible = !preview;
    syncEnvironmentView();
    updatePlacementCheck();
    transform.detach();
    showPanel(selectionMode);
    renderSeatPreview();
    document.getElementById('preview-mode').textContent = preview ? tr('backToEditing', 'Вернуться к редактированию') : tr('preview', 'Предпросмотр');
  }));
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
  function placement() {
    if (document.getElementById('add-placement').value !== 'beside' || !selected) return { x: 0, y: 0, z: 0 };
    const group = objects.get(selected.id).group;
    const bounds = new THREE.Box3().setFromObject(group);
    return { x: Math.max(bounds.max.x, group.position.x) + .5, y: group.position.y, z: group.position.z };
  }
  document.getElementById('add-form').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
      await applyCurrent(); await window.RoomSeatEditor?.save();
      const position = placement();
      const data = await api('/objects', { method: 'POST', body: JSON.stringify({
        model_id: Number(document.getElementById('model-id').value),
        name: document.getElementById('model-name').value,
        position_x: position.x, position_y: position.y, position_z: position.z,
        rotation_x: 0, rotation_y: 0, rotation_z: 0,
        scale_x: 1, scale_y: 1, scale_z: 1, has_collision: true
      }) });
      document.getElementById('model-name').value = '';
      document.getElementById('element-search').value = '';
      showPanel('objects');
      await loadObjects(data.object.id);
      message.textContent = tr('added', 'Предмет добавлен');
    });
  });
  document.getElementById('edit-form').addEventListener('submit', event => {
    event.preventDefault();
    action(async () => {
      if (!selected) return;
      objectDirty = true; await applyCurrent(); await window.RoomSeatEditor?.save();
      await loadObjects();
      message.textContent = template ? tr('appliedDraft', 'Изменения применены. Сохраните черновик') : tr('saved', 'Положение сохранено');
    });
  });
  document.getElementById('delete-object').addEventListener('click', () => action(async () => {
    if (!selected || !confirm(tr('confirmDelete', 'Удалить этот предмет?'))) return;
    await applyCurrent(); await window.RoomSeatEditor?.save();
    const attached=window.RoomSeatEditor?.attached(selected.id)||[];
    let seats='delete';
    if(attached.length){
      seats=prompt(tr('deleteSeatsChoice','У предмета есть места. Введите 1 — оставить места отдельно, 2 — удалить вместе с предметом.'),'1');
      if(seats!=='1'&&seats!=='2')return;
      seats=seats==='1'?'keep':'delete';
    }
    await api(`/objects/${selected.id}`, { method: 'DELETE', body:JSON.stringify({seats}) });
    await loadObjects(null);
    message.textContent = tr('deleted', 'Предмет удалён');
  }));
  document.getElementById('template-name').addEventListener('input', event => {
    if (template) { template.draft.name = event.target.value; template.changed(); }
  });
  window.addEventListener('room-template-changed', updateTemplateStatus);
  window.addEventListener('room-seat-dirty', updateTemplateStatus);
  async function prepareTemplate() { await window.RoomEnvelopeEditor?.flush(); window.RoomSeatEditor?.flush(); await applyCurrent(); await window.RoomSeatEditor?.save(); }
  function clearEnvironmentProposal(){
    if(environmentProposal){scene.remove(environmentProposal.group);disposeGroup(environmentProposal.group);
      if(environmentProposal.helper){scene.remove(environmentProposal.helper);disposeGroup(environmentProposal.helper);}environmentProposal=null;}
    for(const entry of objects.values())if(entry.data.is_room_environment||entry.data.is_room_shell)entry.group.visible=true;
    syncEnvironmentView();
    updatePlacementCheck();
  }
  window.RoomEditorEnvironment = {
    available:()=>!!template,
    get:()=>template?.draft.layout.find(i=>i.kind==='room'),
    models:()=>template?.models||[],
    previousShell:()=>template?.previousShell,
    clearPreview:clearEnvironmentProposal,
    preview(item,root){
      if(!RoomEnvironment.validTransform(item)){if(root)disposeGroup(root);return;}
      const fitNewModel=!!root;
      if(!root&&!environmentProposal){
        const current=[...objects.values()].find(e=>e.data.is_room_environment&&e.state==='ready');
        const source=current?.group.children[0];
        if(source){
          // A preview owns its copies. Disposing it must never invalidate the
          // applied model, including shared meshes, materials and textures.
          root=source.clone(true);
          const geometries=new Map(),materials=new Map(),textures=new Map();
          const materialCopy=m=>{
            if(!materials.has(m)){const copy=m.clone();
              for(const [key,value] of Object.entries(copy))if(value?.isTexture){if(!textures.has(value))textures.set(value,value.clone());copy[key]=textures.get(value);}
              materials.set(m,copy);
            }return materials.get(m);
          };
          root.traverse(n=>{
            if(n.geometry){if(!geometries.has(n.geometry))geometries.set(n.geometry,n.geometry.clone());n.geometry=geometries.get(n.geometry);}
            if(n.material)n.material=Array.isArray(n.material)?n.material.map(materialCopy):materialCopy(n.material);
          });
        }
      }
      const data={room_environment:item.environment};
      for(const p of ['position','rotation','scale'])for(const a of ['x','y','z'])data[p+'_'+a]=item[p][a];
      if(root){clearEnvironmentProposal();const group=new THREE.Group();group.userData.officeProposal=true;group.add(root);scene.add(group);environmentProposal={group,data};}
      if(!environmentProposal)return;
      environmentProposal.data=data;
      const group=environmentProposal.group;
      for(const p of ['position','rotation','scale'])group[p].set(...['x','y','z'].map(a=>item[p][a]));
      if(environmentProposal.helper){scene.remove(environmentProposal.helper);disposeGroup(environmentProposal.helper);}
      environmentProposal.helper=RoomEnvironmentView.helper(data);if(environmentProposal.helper){scene.add(environmentProposal.helper);environmentProposal.helper.visible=!preview&&document.getElementById('environment-bounds').checked;}
      for(const entry of objects.values())if(entry.data.is_room_environment||entry.data.is_room_shell)entry.group.visible=false;
      if(environmentHelper)environmentHelper.visible=false;
      if(fitNewModel)RoomEnvironmentView.fit(camera,orbit,RoomEnvironmentView.bounds(data));
      updatePlacementCheck();
    },
    register(model){if(!template)return;if(!template.models.some(m=>m.id===model.id)){template.models.push(model);addModelOption(model);}window.RoomEnvironmentEditor?.refreshModels();},
    async apply(item){
      if(!template || busy)return false;
      let applied=false;
      await action(async()=>{await prepareTemplate();await api('/environment',{method:'PATCH',body:JSON.stringify({item})});clearEnvironmentProposal();
        framedEnvironment=null;await loadObjects(null);message.textContent=window.i18n.t('roomEnvironmentEditor.applied');applied=true;});
      return applied;
    }
  };
  document.getElementById('template-save').addEventListener('click', () => action(async () => {
    if(window.RoomEnvironmentEditor?.isPending())throw new Error(window.i18n.t('roomEnvironmentEditor.pending'));
    await prepareTemplate(); await template.save(); message.textContent = tr('draftSaved', 'Черновик сохранён');
  }));
  document.getElementById('template-publish').addEventListener('click', () => {
    if (!confirm(tr('confirmPublish', 'Опубликовать обстановку для новых комнат?'))) return;
    action(async () => {
      if(window.RoomEnvironmentEditor?.isPending())throw new Error(window.i18n.t('roomEnvironmentEditor.pending'));
      await prepareTemplate();
      const environment=[...objects.values()].find(e=>e.data.is_room_environment);
      if(environment && environment.state!=='ready')throw new Error(tr('environmentWait','Дождитесь успешной загрузки помещения перед публикацией'));
      updatePlacementCheck();
      if(placementIssues.some(i=>i.severity==='error'))throw new Error(window.i18n.t('roomPlacement.blocked'));
      const version = await template.publish();
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
    await prepareTemplate(); const data = await api(`/objects/${selected.id}/copy`, { method: 'POST' });
    document.getElementById('element-search').value = '';
    await loadObjects(data.object?.id);
    message.textContent = tr('copiedObject', 'Копия создана и выбрана');
  }));
  window.addEventListener('beforeunload', event => {
    if (objectDirty || template?.dirty) { event.preventDefault(); event.returnValue = ''; }
  });
  window.addEventListener('pagehide',event=>{
    if(event.persisted)return;
    cancelAnimationFrame(frameId);for(const entry of objects.values())removeVisual(entry);objects.clear();
    if(environmentProposal){disposeGroup(environmentProposal.group);disposeGroup(environmentProposal.helper);}
    disposeGroup(seatAvatar);
    if(environmentHelper)disposeGroup(environmentHelper);orbit.dispose();transform.dispose();renderer.dispose();
  });
  init();
})();
