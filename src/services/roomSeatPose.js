// Same XYZ Euler convention as Three.js; angles are radians.
function roomSeatPose(seat, object = {}) {
  object ||= {};
  const axes = ['x', 'y', 'z'];
  const read = (value, fallback) => {
    const number = value == null ? fallback : Number(value);
    if (!Number.isFinite(number)) throw new Error('INVALID_SEAT_TRANSFORM');
    return number;
  };
  const rotation = axes.map(a => read(object[`rotation_${a}`], 0));
  let [x, y, z] = axes.map(a => read(seat.local_position?.[a], 0) * (seat.coordinate_space === 'rigid' ? 1 : read(object[`scale_${a}`], 1)));
  const [rx, ry, rz] = rotation;
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  const position = Object.fromEntries(axes.map((a, i) => [a, [x, y, z][i] + read(object[`position_${a}`], 0)]));
  if (Object.values(position).some(n => !Number.isFinite(n) || Math.abs(n) > 10000)) throw new Error('INVALID_SEAT_TRANSFORM');
  const quaternion = angles => {
    const [a, b, c] = angles.map(n => n / 2);
    const [sx, sy, sz] = [a, b, c].map(Math.sin);
    const [cx, cy, cz] = [a, b, c].map(Math.cos);
    return { x: sx * cy * cz + cx * sy * sz, y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz + sx * sy * cz, w: cx * cy * cz - sx * sy * sz };
  };
  const a = quaternion(rotation);
  const b = quaternion(axes.map(axis => read(seat.local_rotation?.[axis], 0)));
  const orientation = {
    x: a.w*b.x + a.x*b.w + a.y*b.z - a.z*b.y,
    y: a.w*b.y - a.x*b.z + a.y*b.w + a.z*b.x,
    z: a.w*b.z + a.x*b.y - a.y*b.x + a.z*b.w,
    w: a.w*b.w - a.x*b.x - a.y*b.y - a.z*b.z
  };
  return { position, orientation };
}

module.exports = { roomSeatPose };
