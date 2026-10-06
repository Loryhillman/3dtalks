const { randomUUID } = require('node:crypto');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const vector = value => value && ['x', 'y', 'z'].every(axis =>
  typeof value[axis] === 'number' && Number.isFinite(value[axis]) && Math.abs(value[axis]) <= 10000);
function validSeatLayout(seats) {
  return Array.isArray(seats) && seats.length <= 100 &&
    new Set(seats.map(s => typeof s?.label === 'string' ? s.label.trim() : null)).size === seats.length &&
    new Set(seats.filter(s => s?.id).map(s => s.id)).size === seats.filter(s => s?.id).length &&
    seats.every(s => s && (!s.id || UUID.test(s.id)) && (s.object_id === null || (Number.isSafeInteger(s.object_id) && s.object_id > 0)) &&
      (s.coordinate_space === undefined || ['rigid', 'legacy'].includes(s.coordinate_space)) &&
      typeof s.label === 'string' && s.label.trim().length > 0 && s.label.trim().length <= 40 &&
      Number.isInteger(s.sort_order) && Math.abs(s.sort_order) <= 10000 && typeof s.enabled === 'boolean' &&
      vector(s.local_position) && vector(s.local_rotation) &&
      [s.map_x, s.map_y].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000));
}
async function insertSeat(client, roomId, seat) {
  await client.query(`INSERT INTO room_seats
    (id, room_id, object_id, label, sort_order, local_position, local_rotation, map_x, map_y, enabled, coordinate_space)
    VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11)`,
  [seat.id || randomUUID(), roomId, seat.object_id, seat.label.trim(), seat.sort_order,
    JSON.stringify(seat.local_position), JSON.stringify(seat.local_rotation), seat.map_x, seat.map_y, seat.enabled, seat.coordinate_space || 'legacy']);
}
module.exports = { validSeatLayout, insertSeat };
