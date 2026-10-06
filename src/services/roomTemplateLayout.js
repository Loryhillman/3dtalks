const RoomEnvelope = require('../../public/js/roomEnvelope');
const { validSeatLayout } = require('./roomSeatLayout');
const vector = (v, scale = false) => v && ['x', 'y', 'z'].every(a =>
  typeof v[a] === 'number' && Number.isFinite(v[a]) &&
  (scale ? v[a] >= .01 && v[a] <= 100 : Math.abs(v[a]) <= 10000));
const modelPath = p => typeof p === 'string' && /^\/models\/uploaded\/[a-zA-Z0-9_-]+\.glb$/.test(p);
function validComponent(c) {
  if (!c || !['box','sphere','cylinder','cone'].includes(c.type)) return false;
  for (const key of ['width','height','depth','radius','radiusTop','radiusBottom']) {
    if (c[key] !== undefined && (typeof c[key] !== 'number' || !Number.isFinite(c[key]) ||
        c[key] < (key === 'radiusTop' || key === 'radiusBottom' ? 0 : .001) || c[key] > 10000)) return false;
  }
  for (const key of ['widthSegments','heightSegments','radialSegments']) {
    if (c[key] !== undefined && (!Number.isInteger(c[key]) || c[key] < 3 || c[key] > 64)) return false;
  }
  for (const key of ['position','rotation','scale']) if (c[key] !== undefined && !vector(c[key], key === 'scale')) return false;
  return true;
}
function transform(item) {
  return { position: item.position, rotation: item.rotation || { x: 0, y: item.rotation_y || 0, z: 0 },
    scale: item.scale || { x: 1, y: 1, z: 1 } };
}
function validLayout(layout) {
  if (!Array.isArray(layout) || !layout.length || layout.length > 100) return false;
  const seats = [];
  for (let i = 0; i < layout.length; i++) {
    const item = layout[i];
    if (!item || typeof item.kind !== 'string' || !/^[a-z_]{1,40}$/.test(item.kind) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120 ||
        typeof item.collision !== 'boolean') return false;
    const t = transform(item);
    if (!vector(t.position) || !vector(t.rotation) || !vector(t.scale, true)) return false;
    if (item.rotation !== undefined && !vector(item.rotation) ||
        item.scale !== undefined && !vector(item.scale, true) ||
        item.rotation_y !== undefined && (typeof item.rotation_y !== 'number' || !Number.isFinite(item.rotation_y))) return false;
    if (item.type === 'room_shell') {
      if (item.kind !== 'room' || !item.collision || !RoomEnvelope.valid(item.envelope) || ['x','y','z'].some(a => t.scale[a] !== 1)) return false;
    } else if (item.type === 'seat') {
      if (item.kind !== 'seat' || item.collision || ['x','y','z'].some(a => t.position[a] !== 0 || t.rotation[a] !== 0 || t.scale[a] !== 1)) return false;
    } else if (item.type === 'uploaded_model') {
      if (!Number.isSafeInteger(item.model_id) || item.model_id < 1 || !modelPath(item.model_path)) return false;
    } else if ((item.type && item.type !== 'geometry_building') ||
        !Array.isArray(item.components) || !item.components.length || item.components.length > 100 ||
        item.components.some(c => !validComponent(c))) return false;
    if (item.seats !== undefined && !Array.isArray(item.seats)) return false;
    for (const seat of item.seats || []) seats.push({ ...seat, id: undefined, object_id: i + 1 });
  }
  if (layout.filter(i=>i.kind==='room').length>1) return false;
  return validSeatLayout(seats);
}
module.exports = { validLayout, transform, modelPath, vector };
