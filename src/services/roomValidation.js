const fs = require('node:fs').promises;
const path = require('node:path');
const { listRoomObjects } = require('./roomObjects');

const publicDir = path.resolve(__dirname, '../../public');

async function validateRoom(roomId, dbPool, stat = fs.stat) {
  const objects = await listRoomObjects(roomId, dbPool);
  const errors = [];
  const envelopeObject=objects.find(o=>o.room_envelope);
  let shell;
  if(envelopeObject){
    shell={envelope:envelopeObject.room_envelope,position:{},rotation:{},scale:{x:1,y:1,z:1}};
    for(const a of ['x','y','z']){shell.position[a]=Number(envelopeObject['position_'+a]||0);shell.rotation[a]=Number(envelopeObject['rotation_'+a]||0);}
    for(const o of objects)if(!o.is_room_shell&&!require('../../public/js/roomEnvelope').contains({x:Number(o.position_x),y:Number(o.position_y),z:Number(o.position_z)},shell))errors.push('Предмет за пределами помещения: '+o.name);
  }
  if (!objects.length) errors.push('В комнате нет предметов');
  if (!objects.some(object => object.type === 'geometry_building' &&
      object.geometry_data?.components?.length > 0)) {
    errors.push('Отсутствует геометрия помещения');
  }
  for (const object of objects) {
    if (!['position_x', 'position_y', 'position_z', 'scale_x', 'scale_y', 'scale_z']
      .every(key => Number.isFinite(Number(object[key])))) {
      errors.push(`Неверные координаты предмета ${object.id}`);
    }
    if (object.type === 'geometry_building' &&
        !object.geometry_data?.components?.length) {
      errors.push(`Не найдена геометрия предмета ${object.id}`);
    }
    if (object.type === 'uploaded_model') {
      const modelPath = object.model_path;
      if (typeof modelPath !== 'string' || !modelPath.startsWith('/models/uploaded/')) {
        errors.push(`Неверный путь модели ${object.id}`);
        continue;
      }
      const absolute = path.resolve(publicDir, '.' + modelPath);
      if (!absolute.startsWith(path.join(publicDir, 'models', 'uploaded') + path.sep)) {
        errors.push(`Неверный путь модели ${object.id}`);
        continue;
      }
      try {
        const file = await stat(absolute);
        if (!file.isFile() || file.size === 0) errors.push(`Модель ${object.id} пуста`);
      } catch (_) {
        errors.push(`Не найден файл модели ${object.id}`);
      }
    }
  }
  const room = (await dbPool.query('SELECT seating_mode FROM rooms WHERE id=$1', [roomId])).rows[0];
  if (room?.seating_mode === 'seated') {
    const seats = (await dbPool.query('SELECT * FROM room_seats WHERE room_id=$1 AND enabled', [roomId])).rows;
    if (!seats.length) errors.push('Нет доступных посадочных мест');
    if (!require('./roomSeatLayout').validSeatLayout(seats)) errors.push('Некорректная схема посадочных мест');
    const poses = [];
    for (const seat of seats) {
      try {
        const object = seat.object_id === null ? {} : objects.find(o => o.id === seat.object_id);
        if (!object) throw new Error('Missing object');
        const { position } = require('./roomSeatPose').roomSeatPose(seat, object);
        if (poses.some(p => Math.hypot(p.x-position.x, p.y-position.y, p.z-position.z) < .2)) {
          errors.push(`Совпадают посадочные места: ${seat.label}`);
        }
        if(shell&&!require('../../public/js/roomEnvelope').contains(position,shell))errors.push('Посадка за пределами помещения: '+seat.label);
        poses.push(position);
      } catch (_) { errors.push(`Неверная посадочная точка: ${seat.label}`); }
    }
  }
  return { ok: errors.length === 0, errors, objectCount: objects.length };
}

module.exports = { validateRoom };
