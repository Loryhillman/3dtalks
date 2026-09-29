// Dimensions are world units; each prefab has its origin at floor level.
const box = (width, height, depth, x, y, z, color) =>
  ({ type: 'box', width, height, depth, position: { x, y, z }, color });
function getPrefab(kind) {
  const wood = '#956338';
  const leg = (x, z, height) => box(.24, height, .24, x, height / 2, z, wood);
  switch (kind) {
    case 'room': return { collision: true, components: [
      box(20, .1, 16, 0, -.05, 0, '#c8c5bd'),
      box(20, 6, .2, 0, 3, -8, '#e8e4db'),
      box(.2, 6, 16, -10, 3, 0, '#e8e4db'),
      box(.2, 6, 16, 10, 3, 0, '#e8e4db'),
      box(8, 6, .2, -6, 3, 8, '#e8e4db'),
      box(8, 6, .2, 6, 3, 8, '#e8e4db'),
      box(4, 1.2, .2, 0, 5.4, 8, '#e8e4db')
    ] };
    case 'table': return { collision: true, components: [
      box(4.8, .24, 2.4, 0, 1.48, 0, wood),
      ...[-2.1, 2.1].flatMap(x => [-.9, .9].map(z => leg(x, z, 1.36)))
    ] };
    case 'chair': return { collision: true, components: [
      box(1, .16, 1, 0, .92, 0, wood),
      box(1, 1, .16, 0, 1.5, -.42, wood),
      ...[-.36, .36].flatMap(x => [-.36, .36].map(z => leg(x, z, .84)))
    ] };
    default: return null;
  }
}
// Both records commit together so a failed placement leaves no orphan definition.
async function createPrefab(pool, kind, name, position, actorId) {
  const prefab = getPrefab(kind);
  if (!prefab) throw new Error('Unknown prefab');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const geometry = await client.query(
      `INSERT INTO geometry_buildings (user_id, name, template_id, geometry_data, created_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
      [actorId, name, 'room_' + kind, JSON.stringify({ components: prefab.components })]);
    const result = await client.query(
      `INSERT INTO world_objects (type, name, model_path, position_x, position_y, position_z,
       rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, world_id, has_collision, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, 1, 1, 1, 1, $7, NOW(), NOW()) RETURNING *`,
      ['geometry_building', name, 'geometry_building:' + geometry.rows[0].id,
       position.x, position.y, position.z, prefab.collision]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
module.exports = { getPrefab, createPrefab };
