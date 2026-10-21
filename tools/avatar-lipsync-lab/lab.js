// Isolated asset inspection. No account, room, audio capture or network speech.
(() => {
  const $ = id => document.getElementById(id);
  let disposed = false, ready = false, group, manifest, initialRootPosition;
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
      const amount = Number($('amount').value), shape = $('shape').value;
      for (const item of targets) item.mesh.morphTargetInfluences[item.index] = item.name === shape ? amount : 0;
      $('amount-value').value = Math.round(amount * 100) + '%';
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
      shapes: [...new Set(targets.map(item => item.name))], manifest }),
    model: () => group?.userData.accountAvatarRoot,
    render, stop
  };
  window.addEventListener('resize', render);
  window.addEventListener('pagehide', stop);
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  for (const id of ['view', 'shape']) $(id).addEventListener('change', render);
  $('amount').addEventListener('input', render);
  $('neutral').onclick = () => { $('amount').value = '0'; render(); };

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
    $('status').textContent = 'Готово: модель прошла штатную проверку импорта';
    $('details').textContent = (manifest.bytes / 1048576).toFixed(1) + ' МиБ · ' + manifest.triangles.toLocaleString('ru-RU') + ' треугольников. Это ещё не облегчённая модель для шести участников.';
    render();
  }
  initialize().catch(error => {
    if (!disposed) { $('status').textContent = 'Ошибка: ' + error.message; stop(); }
  });
})();
