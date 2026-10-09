async function listRoomObjects(roomId, dbPool) {
  const pool = dbPool || require('../database/db').pool;
  const objects = (await pool.query(`
    SELECT * FROM world_objects WHERE room_id = $1
    ORDER BY created_at DESC, id DESC
  `, [roomId])).rows;
  for (const object of objects) if (object.room_environment != null) object.is_room_environment = true;
  const ids = [...new Set(objects.filter(o => o.type === 'geometry_building')
    .map(o => /^geometry_building:(\d+)$/.exec(o.model_path || '')?.[1] || o.building_id)
    .map(Number).filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) return objects;
  const geometries = (await pool.query(
    'SELECT id, geometry_data, template_id FROM geometry_buildings WHERE id = ANY($1::int[])',
    [ids]
  )).rows;
  const byId = new Map(geometries.map(g => [Number(g.id), g]));
  for (const object of objects) {
    const id = Number(/^geometry_building:(\d+)$/.exec(object.model_path || '')?.[1] || object.building_id);
    if (object.type === 'geometry_building' && byId.has(id)) {
      const definition=byId.get(id);
      object.geometry_data = definition.geometry_data;
      if(definition.template_id==='room_room' || definition.geometry_data?.envelope){
        const E=require('../../public/js/roomEnvelope');
        const legacy={kind:'room',components:definition.geometry_data.components,
          scale:{x:Number(object.scale_x??1),y:Number(object.scale_y??1),z:Number(object.scale_z??1)}};
        object.room_envelope=definition.geometry_data.envelope || E.fromLegacy(legacy)?.envelope || null;
        object.is_room_shell=true;
      }
    }
  }
  return objects;
}

module.exports = { listRoomObjects };
