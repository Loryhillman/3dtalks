/** Rendering helpers shared by the editor and seated camera. Never traverse GLB meshes for bounds. */
(() => {
  const transform = object => Object.fromEntries(['position','rotation','scale'].map(prefix =>
    [prefix, Object.fromEntries(['x','y','z'].map(axis => [axis, Number(object[prefix+'_'+axis] ?? (prefix === 'scale' ? 1 : 0))]))]));
  function bounds(object) {
    const t = transform(object);
    if (!RoomEnvironment.valid(object.room_environment, t)) return null;
    const b = RoomEnvironment.worldBounds(object.room_environment, t);
    return new THREE.Box3(new THREE.Vector3(b.min.x,b.min.y,b.min.z),new THREE.Vector3(b.max.x,b.max.y,b.max.z));
  }
  function helper(object) {
    if (!bounds(object)) return null;
    const b = object.room_environment.bounds;
    const group = new THREE.Group(); group.userData.roomEnvironmentBounds = true;
    const line = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(b.min.x,b.min.y,b.min.z),new THREE.Vector3(b.max.x,b.max.y,b.max.z)),0xffcc66);
    line.material.depthTest = false; line.material.transparent = true; line.material.opacity = .75; line.renderOrder = 1000;
    group.add(line);
    const t=transform(object);
    for (const prefix of ['position','rotation','scale']) group[prefix].set(...['x','y','z'].map(axis => t[prefix][axis]));
    return group;
  }
  function fit(camera, controls, box) {
    if (!box || box.isEmpty()) return false;
    const centre = box.getCenter(new THREE.Vector3()), radius = Math.max(.5,box.getSize(new THREE.Vector3()).length()/2);
    if (![centre.x,centre.y,centre.z,radius].every(Number.isFinite)) return false;
    const vertical = THREE.MathUtils.degToRad(camera.fov)/2;
    const halfFov = Math.min(vertical,Math.atan(Math.tan(vertical)*camera.aspect));
    const distance = radius/Math.sin(halfFov)*1.15;
    camera.near = Math.max(.01,Math.min(.1,radius/1000)); camera.far = Math.max(1000,distance+radius*4);
    camera.position.copy(centre).addScaledVector(new THREE.Vector3(1,.65,1).normalize(),distance);
    camera.updateProjectionMatrix();
    controls.target.copy(centre); controls.maxDistance = Math.max(100,distance*4); controls.update();
    return true;
  }
  function constrain(target, desired, object) {
    const t = transform(object);
    if (!RoomEnvironment.valid(object.room_environment,t)) return desired;
    const b = object.room_environment.bounds, margin = .15/t.scale.x;
    const box = new THREE.Box3(new THREE.Vector3(b.min.x+margin,b.min.y+margin,b.min.z+margin),new THREE.Vector3(b.max.x-margin,b.max.y-margin,b.max.z-margin));
    const inverse=new THREE.Matrix4().compose(new THREE.Vector3(t.position.x,t.position.y,t.position.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),t.rotation.y),new THREE.Vector3(t.scale.x,t.scale.y,t.scale.z)).invert();
    const local = value => value.clone().applyMatrix4(inverse);
    const from = local(target), to = local(desired);
    if (!box.containsPoint(from) || box.containsPoint(to)) return desired;
    const point = new THREE.Ray(from,to.clone().sub(from).normalize()).intersectBox(box,new THREE.Vector3());
    if (!point) return desired;
    const world = RoomEnvironment.toWorld(point,t);
    return new THREE.Vector3(world.x,world.y,world.z);
  }
  window.RoomEnvironmentView = { transform, bounds, helper, fit, constrain };
})();
