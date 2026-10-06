// Seat offsets use translation and rotation only. Furniture scale never changes a seat.
(() => {
  const axes = ['x','y','z'];
  const quaternion = v => new THREE.Quaternion().setFromEuler(new THREE.Euler(v?.x || 0, v?.y || 0, v?.z || 0, 'XYZ'));
  const vector = v => new THREE.Vector3(v?.x || 0, v?.y || 0, v?.z || 0);
  const plain = v => Object.fromEntries(axes.map(a => [a, v[a]]));
  function transform(object) {
    return { position: vector(Object.fromEntries(axes.map(a => [a, Number(object?.['position_'+a] || 0)]))),
      rotation: quaternion(Object.fromEntries(axes.map(a => [a, Number(object?.['rotation_'+a] || 0)]))) };
  }
  function world(seat, object) {
    const t = transform(object), p = vector(seat.local_position);
    if (seat.coordinate_space !== 'rigid') for (const a of axes) p[a] *= Number(object?.['scale_'+a] ?? 1);
    p.applyQuaternion(t.rotation).add(t.position);
    const q = t.rotation.multiply(quaternion(seat.local_rotation));
    return { position: plain(p), rotation: plain(new THREE.Euler().setFromQuaternion(q, 'XYZ')) };
  }
  function local(pose, object) {
    const t = transform(object), inverse = t.rotation.invert();
    return { coordinate_space: 'rigid', local_position: plain(vector(pose.position).sub(t.position).applyQuaternion(inverse)),
      local_rotation: plain(new THREE.Euler().setFromQuaternion(inverse.multiply(quaternion(pose.rotation)), 'XYZ')) };
  }
  window.RoomSeatCoordinates = { world, local };
})();
