const { getPrefab } = require('./worldPrefabs');

// Version 1 is captured once in the database. Later prefab code changes do
// not mutate a previously stored room template.
const placements = [
  ['room', 'Помещение', 0, 0, 0, 0],
  ['table', 'Стол', 0, 0, 0, 0],
  ['chair', 'Стул 1', -2, 0, -2, 0],
  ['chair', 'Стул 2', 0, 0, -2, 0],
  ['chair', 'Стул 3', 2, 0, -2, 0],
  ['chair', 'Стул 4', -2, 0, 2, Math.PI],
  ['chair', 'Стул 5', 0, 0, 2, Math.PI],
  ['chair', 'Стул 6', 2, 0, 2, Math.PI]
];

async function ensureRoomTemplates(pool) {
  const layout = placements.map(([kind, name, x, y, z, rotation_y]) => {
    const prefab = getPrefab(kind);
    if (!prefab) throw new Error(`Missing room prefab: ${kind}`);
    return {
      kind, name, position: { x, y, z }, rotation_y,
      components: prefab.components, collision: prefab.collision
    };
  });
  await pool.query(`
    INSERT INTO room_templates (template_key, version, name, layout)
    VALUES ('meeting-six', 1, 'Переговорная на шесть мест', $1::jsonb)
    ON CONFLICT (template_key, version) DO NOTHING
  `, [JSON.stringify(layout)]);
  let seatNumber = 0;
  const seatedLayout = layout.map(item => item.kind !== 'chair' ? item : {
    ...item, seats: [{ label: String(++seatNumber), sort_order: seatNumber, enabled: true,
      local_position: { x: 0, y: 1, z: 0 }, local_rotation: { x: 0, y: 0, z: 0 },
      map_x: item.position.x, map_y: item.position.z }]
  });
  await pool.query(`
    INSERT INTO room_templates (template_key, version, name, layout)
    VALUES ('meeting-six', 2, 'Переговорная на шесть мест', $1::jsonb)
    ON CONFLICT (template_key, version) DO NOTHING
  `, [JSON.stringify(seatedLayout)]);
  // Enclosed meeting hall; older saved layouts remain unchanged.
  const panel = (width, height, depth, x, y, z) => ({ type: 'box', width, height, depth,
    position: { x, y, z }, color: '#d7d3ca' });
  const hall = seatedLayout.map(item => item.kind !== 'room' ? item : { ...item, components: [
    panel(24, .2, 20, 0, -.1, 0),
    panel(24, 8, .2, 0, 4, -10), panel(24, 8, .2, 0, 4, 10),
    panel(.2, 8, 20, -12, 4, 0), panel(.2, 8, 20, 12, 4, 0),
    panel(24, .2, 20, 0, 8.1, 0)
  ] });
  await pool.query(`
    INSERT INTO room_templates (template_key, version, name, layout)
    VALUES ('meeting-six', 3, 'Переговорная на шесть мест', $1::jsonb)
    ON CONFLICT (template_key, version) DO NOTHING
  `, [JSON.stringify(hall)]);
}

module.exports = { ensureRoomTemplates };
