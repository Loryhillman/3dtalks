// Isolated asset/audio inspection. No account, room or network speech.
(() => {
  const $ = id => document.getElementById(id);
  let disposed = false, ready = false, group, manifest, initialRootPosition, audio;
  const rest = [], targets = [], scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8edf2');
  const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
  const renderer = new THREE.WebGLRenderer({ canvas: $('viewport'), antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x778899, 2.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.5); key.position.set(2, 4, 4); scene.add(key);
  const chair = new THREE.Group();
  const chairMaterial = new THREE.MeshStandardMaterial({ color: '#42606f', roughness: .9 });
  for (const [size, position] of [
    [[.85, .12, .8], [0, -.08, 0]], [[.85, 1.05, .12], [0, .42, -.38]],
    [[.08, 1.2, .08], [-.32, -.7, -.27]], [[.08, 1.2, .08], [.32, -.7, -.27]],
    [[.08, 1.2, .08], [-.32, -.7, .27]], [[.08, 1.2, .08], [.32, -.7, .27]]
  ]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), chairMaterial);
    mesh.position.set(...position); chair.add(mesh);
  }
  chair.visible = false; scene.add(chair);

  function mouth(amount, shape) {
    for (const item of targets) item.mesh.morphTargetInfluences[item.index] = item.name === shape ? amount : 0;
    $('amount').value = String(amount);
    $('amount-value').value = Math.round(amount * 100) + '%';
  }
  function refreshAudio(state) {
    if (disposed) return;
    const busy = ['loading', 'starting', 'playing', 'requesting', 'recording', 'preparing'].includes(state.phase);
    for (const id of ['shape', 'amount', 'neutral']) $(id).disabled = busy;
    if (state.phase === 'starting') $('shape').value = 'viseme_aa';
    $('audio-play').disabled = !ready || !state.duration || busy;
    $('audio-stop').disabled = !busy;
    $('audio-record').disabled = !ready || ['preparing', 'starting'].includes(state.phase);
    $('audio-record').textContent = state.phase === 'requesting' ? 'Отменить запрос микрофона' :
      state.phase === 'recording' ? 'Завершить запись' : 'Записать с микрофона';
    $('audio-progress').max = state.phase === 'recording' ? 30 : state.duration || 1;
    $('audio-progress').value = state.elapsed;
    $('audio-time').value = state.phase === 'recording' ? state.elapsed.toFixed(1) + ' / 30 с' :
      state.duration ? state.elapsed.toFixed(1) + ' / ' + state.duration.toFixed(1) + ' с' : '';
    const text = state.phase === 'requesting' ? 'Разрешите доступ к микрофону в браузере.' :
      state.phase === 'recording' ? 'Идёт запись. Говорите, затем завершите её.' :
      state.phase === 'preparing' ? 'Подготовка вашей записи…' : state.phase === 'error' ? state.error : state.phase === 'loading' ? 'Чтение локальной записи…' :
      state.phase === 'starting' ? 'Запуск аудио…' : state.phase === 'playing' ? 'Воспроизведение: ' + state.name :
      state.duration ? 'Готово: ' + state.name + '. Нажмите «Воспроизвести».' : 'Нажмите «Записать с микрофона».';
    if ($('audio-status').textContent !== text) $('audio-status').textContent = text;
  }
  audio = window.AvatarLabAudio.create({ onState: refreshAudio, onMouth: amount => {
    if (disposed || !ready) return;
    mouth(amount, 'viseme_aa'); renderer.render(scene, camera);
  } });

  function render() {
    if (disposed) return;
    const canvas = renderer.domElement, width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    if (ready) {
      for (const item of rest) item.bone.quaternion.copy(item.quaternion);
      const root = group.userData.accountAvatarRoot;
      root.position.copy(initialRootPosition); group.position.set(0, 0, 0);
      const seated = $('view').value === 'seat'; chair.visible = seated;
      if (seated) window.RoomSeatAvatar.apply(group);
      const state = audio.getState(), automatic = ['starting', 'playing'].includes(state.phase);
      mouth(automatic ? state.amount : Number($('amount').value), automatic ? 'viseme_aa' : $('shape').value);
      scene.updateMatrixWorld(true);
      const head = root.getObjectByName(manifest.boneMap.head);
      if ($('view').value === 'head' && head) {
        const target = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, .08, 0));
        camera.position.copy(target).add(new THREE.Vector3(0, .02, .9)); camera.lookAt(target);
      } else {
        const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        const distance = Math.max(size.y, size.x / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) + size.z;
        camera.position.copy(center).add(new THREE.Vector3(seated ? .6 : 0, .08, distance)); camera.lookAt(center);
      }
    }
    renderer.render(scene, camera);
  }
  function stop() {
    if (disposed) return;
    disposed = true;
    audio.dispose();
    window.removeEventListener('resize', render);
    if (group) {
      ++group.userData.accountAvatarTicket;
      group.userData.accountAvatarRoot?.removeFromParent();
      window.UserAvatarRenderer.dispose(group.userData.accountAvatarRoot);
      window.UserAvatarRenderer.dispose(group); group.removeFromParent();
    }
    window.UserAvatarRenderer.dispose(chair); renderer.dispose();
  }
  window.AvatarLab = {
    getState: () => ({ ready, disposed, seated: $('view').value === 'seat', supported: group?.userData.roomSeatRig?.supported,
      shapes: [...new Set(targets.map(item => item.name))], manifest, audio: audio.getState() }),
    model: () => group?.userData.accountAvatarRoot,
    render, stop
  };
  window.addEventListener('resize', render);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  for (const id of ['view', 'shape']) $(id).addEventListener('change', render);
  $('amount').addEventListener('input', render);
  $('neutral').onclick = () => { $('amount').value = '0'; render(); };
  $('audio-file').onchange = () => audio.loadFile($('audio-file').files[0]);
  $('audio-demo').onclick = () => audio.loadDemo();
  $('audio-play').onclick = () => audio.play();
  $('audio-stop').onclick = () => audio.stop();
  $('audio-record').onclick = () => {
    const phase = audio.getState().phase;
    if (phase === 'requesting') audio.stop();
    else if (phase === 'recording') audio.finishRecording();
    else audio.record();
  };

  async function initialize() {
    const response = await fetch('/manifest.json');
    if (!response.ok) throw Error('Не удалось прочитать профиль модели');
    manifest = await response.json();
    if (disposed) return;
    group = window.AvatarBase.create().characterGroup; scene.add(group);
    await window.UserAvatarRenderer.apply(group, { mode: 'full', asset: { path: '/model.glb', boneMap: manifest.boneMap } });
    if (disposed) return;
    if (group.userData.accountAvatarError || !group.userData.accountAvatarRoot?.children.length) throw Error('Модель не загрузилась');
    const root = group.userData.accountAvatarRoot;
    initialRootPosition = root.position.clone();
    root.traverse(node => {
      if (node.isBone) rest.push({ bone: node, quaternion: node.quaternion.clone() });
      for (const [name, index] of Object.entries(node.morphTargetDictionary || {})) targets.push({ mesh: node, name, index });
    });
    if (!targets.some(item => item.name === 'viseme_aa')) throw Error('У модели нет формы А');
    ready = true; $('controls').disabled = false;
    $('audio-controls').disabled = false; $('audio-demo').hidden = !manifest.hasDemo;
    refreshAudio(audio.getState());
    $('status').textContent = 'Готово: модель прошла штатную проверку импорта';
    $('details').textContent = (manifest.bytes / 1048576).toFixed(1) + ' МиБ · ' + manifest.triangles.toLocaleString('ru-RU') + ' треугольников. Это ещё не облегчённая модель для шести участников.';
    render();
  }
  initialize().catch(error => {
    if (!disposed) { $('status').textContent = 'Ошибка: ' + error.message; stop(); }
  });
})();
