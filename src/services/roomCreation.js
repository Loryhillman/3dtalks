const { validLayout, transform } = require('./roomTemplateLayout');

async function populateRoom(client, room, template, { adminId = null, userId = null }) {
    for (const item of template.layout) {
      const type = item.type === 'room_shell' ? 'geometry_building' : item.type || 'geometry_building';
      if (type === 'seat') {
        for (const seat of item.seats || []) await require('./roomSeatLayout').insertSeat(client, room.id, { ...seat, id: undefined, object_id: null, coordinate_space: 'rigid' });
        continue;
      }
      let modelPath = item.model_path;
      if (type === 'geometry_building') {
        const geometry = await client.query(`
        INSERT INTO geometry_buildings (user_id, name, template_id, geometry_data, owner_user_id, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id
      `, [adminId, item.name, 'room_' + item.kind,
          JSON.stringify(item.type === 'room_shell' ? {envelope:item.envelope,components:require('../../public/js/roomEnvelope').components(item.envelope)} : { components: item.components }), userId]);
        modelPath = 'geometry_building:' + geometry.rows[0].id;
      }
      const { position, rotation, scale } = transform(item);
      const object = await client.query(`
        INSERT INTO world_objects
          (room_id, type, name, model_path, position_x, position_y, position_z,
           rotation_y, has_collision, rotation_x, rotation_z, scale_x, scale_y, scale_z,
           model_type, created_at, updated_at)
        VALUES ($1, $9, $2, $3, $4, $5, $6, $7, $8, $10, $11, $12, $13, $14, $15, NOW(), NOW()) RETURNING id
      `, [room.id, item.name, modelPath, position.x, position.y, position.z,
          rotation.y, item.collision, type, rotation.x, rotation.z, scale.x, scale.y, scale.z,
          type === 'uploaded_model' ? 'gltf' : null]);
      for (const seat of item.seats || []) {
        const record = { ...seat, id: undefined, object_id: object.rows[0].id, coordinate_space: 'rigid',
          local_position: Object.fromEntries(['x','y','z'].map(a => [a, seat.local_position[a] * (seat.coordinate_space === 'rigid' ? 1 : scale[a])])) };
        if (!require('../services/roomSeatLayout').validSeatLayout([record])) throw new Error('Invalid template seat');
        await require('../services/roomSeatLayout').insertSeat(client, room.id, record);
      }
    }
}

module.exports = { validLayout, populateRoom };
