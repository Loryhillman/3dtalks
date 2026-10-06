const MAIN_ROOM_ID = '00000000-0000-0000-0000-000000000001';

// Legacy /api/world routes are always the main world once rooms are enabled.
// Keep the old SQL unchanged when the feature is off, so a failed additive
// migration cannot break an installation that has not enabled rooms.
function legacyRoomFilter(prefix = 'WHERE', optional = true) {
  if (optional && process.env.ROOMS_ENABLED !== 'true') return '';
  return `${prefix ? prefix + ' ' : ''}room_id = '${MAIN_ROOM_ID}'`;
}

// Agents and legacy world routes belong to the main world. Older agent entries
// have no roomId, so treat them as main-world entries during migration.
function isMainRoomPlayer(player) {
  return !!player && (process.env.ROOMS_ENABLED !== 'true' ||
    !player.roomId || player.roomId === MAIN_ROOM_ID);
}

module.exports = { MAIN_ROOM_ID, legacyRoomFilter, isMainRoomPlayer };
