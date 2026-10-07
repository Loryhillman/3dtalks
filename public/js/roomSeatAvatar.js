(() => {
  const aliases = window.AvatarRig?.aliases || {};
  function rig(group) {
    const data = group.userData, model = data.glbModel;
    if (data.roomSeatRig && data.roomSeatRig.model === model) return data.roomSeatRig;
    const found = {}, named = new Map();
    model?.traverse(node => {
      if (node.isBone) named.set(window.AvatarRig.normalize(node.name), node);
    });
    for (const [key, names] of Object.entries(aliases)) {
      const mapped = data.boneMap?.[key];
      found[key] = mapped ? model?.getObjectByName(mapped) : null;
      if (!found[key]?.isBone) found[key] = names.map(name => named.get(name)).find(Boolean);
    }
    const descendant = (child, parent) => {
      for (let node = child?.parent; node; node = node.parent) if (node === parent) return true;
      if (data.accountAvatarConfig?.mode === 'full' && data.nameSprite && state.found.head) {
        const headPosition = group.worldToLocal(state.found.head.getWorldPosition(new THREE.Vector3()));
        data.nameSprite.position.y = headPosition.y + .65;
      }
      return false;
    };
    const supported = ['left', 'right'].every(side => found.hips && found[side+'Foot'] &&
      descendant(found[side+'UpLeg'], found.hips) && descendant(found[side+'Leg'], found[side+'UpLeg']) &&
      descendant(found[side+'Foot'], found[side+'Leg']));
    if (supported) {
      data.glbMixer?.stopAllAction(); data.sharedMixer?.stopAllAction();
      model.traverse(node => { if (node.isSkinnedMesh) node.skeleton.pose(); });
    }
    const bones = Object.values(found).filter(Boolean);
    const rest = bones.map(bone => ({ bone, quaternion: bone.quaternion.clone() }));
    const state = { model, found, rest, supported };
    data.roomSeatRig = state;
    return state;
  }
  function aim(bone, child, direction) {
    bone.updateWorldMatrix(true, true);
    const from = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()));
    if (from.lengthSq() < 1e-8) return;
    const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), direction);
    const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    bone.quaternion.copy(parent.multiply(world));
    bone.updateWorldMatrix(false, true);
  }
  window.RoomSeatAvatar = {
    apply(group, look = { yaw: 0, pitch: 0 }) {
      const data = group.userData, state = rig(group);
      if (data.weaponGroup) data.weaponGroup.visible = false;
      if (state.model) state.model.visible = !!state.supported;
      for (const part of data.seatFallbackParts || []) part.visible = !state.supported;
      if (!state.supported) {
        group.position.y += .3;
        if (data.leftLeg && data.rightLeg) {
          data.leftLeg.rotation.x = data.rightLeg.rotation.x = -Math.PI/2;
          data.leftKnee.rotation.x = data.rightKnee.rotation.x = Math.PI/2;
        }
        if (data.seatHead) data.seatHead.rotation.set(look.pitch, look.yaw, 0);
        return !!state.model; // GLB replaced by the seated built-in avatar.
      }
      for (const { bone, quaternion } of state.rest) bone.quaternion.copy(quaternion);
      const orientation = group.getWorldQuaternion(new THREE.Quaternion());
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(orientation);
      for (const side of ['left', 'right']) {
        aim(state.found[side+'UpLeg'], state.found[side+'Leg'], forward);
        aim(state.found[side+'Leg'], state.found[side+'Foot'], down);
        if (state.found[side+'Arm'] && state.found[side+'ForeArm'] && state.found[side+'Hand']) {
          aim(state.found[side+'Arm'], state.found[side+'ForeArm'], down.clone().addScaledVector(forward, .3).normalize());
          aim(state.found[side+'ForeArm'], state.found[side+'Hand'], forward);
        }
      }
      // Align actual hips to the seat, preserving the model's existing scale.
      group.updateWorldMatrix(true, true);
      const hips = state.found.hips.getWorldPosition(new THREE.Vector3());
      const target = group.getWorldPosition(new THREE.Vector3());
      const parent = state.model.parent;
      state.model.position.add(parent.worldToLocal(target).sub(parent.worldToLocal(hips)));
      if (state.found.head) state.found.head.quaternion.multiply(
        new THREE.Quaternion().setFromEuler(new THREE.Euler(look.pitch, look.yaw, 0)));
      return false;
    }
  };
})();
