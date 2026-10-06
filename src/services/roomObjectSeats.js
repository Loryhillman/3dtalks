const { randomUUID } = require('node:crypto');
const { roomSeatPose } = require('./roomSeatPose');
const { insertSeat } = require('./roomSeatLayout');
function detachedSeat(seat, object) {
  const {position,orientation:q}=roomSeatPose(seat,object);
  const m13=2*(q.x*q.z+q.y*q.w);
  const y=Math.asin(Math.max(-1,Math.min(1,m13)));
  const rotation=Math.abs(m13)<.9999999
    ? {x:Math.atan2(2*(q.x*q.w-q.y*q.z),1-2*(q.x*q.x+q.y*q.y)),y,z:Math.atan2(2*(q.z*q.w-q.x*q.y),1-2*(q.y*q.y+q.z*q.z))}
    : {x:Math.atan2(2*(q.y*q.z+q.x*q.w),1-2*(q.x*q.x+q.z*q.z)),y,z:0};
  return {...seat,object_id:null,coordinate_space:'rigid',local_position:position,local_rotation:rotation};
}
function createRoomObjectSeats(pool) {
  async function mutate(roomId,objectId,operation,policy) {
    const client=await pool.connect();
    const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(73421, 1)');
      const room=(await client.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[roomId])).rows[0];
      if(!room||room.status!=='draft')fail('ROOM_CHANGED_OR_ACTIVE');
      const object=(await client.query('SELECT * FROM world_objects WHERE room_id=$1 AND id=$2 FOR UPDATE',[roomId,objectId])).rows[0];
      if(!object)fail('ROOM_OBJECT_NOT_FOUND',404);
      if((await client.query("SELECT 1 FROM geometry_buildings WHERE $1='geometry_building:'||id::text AND template_id='room_room'",[object.model_path])).rows.length)fail('USE_ROOM_ENVELOPE_SETTINGS');
      const seats=(await client.query('SELECT * FROM room_seats WHERE room_id=$1 ORDER BY sort_order,id',[roomId])).rows;
      const attached=seats.filter(s=>s.object_id===objectId);
      if((await client.query('SELECT 1 FROM room_seat_claims WHERE room_id=$1 AND expires_at>clock_timestamp()',[roomId])).rows.length)fail('ROOM_HAS_PARTICIPANTS');
      let result;
      if(operation==='delete') {
        if(attached.length&&!['keep','delete'].includes(policy))fail('CHOOSE_ATTACHED_SEATS_ACTION',400);
        if(policy==='keep')for(const s of attached){
          const converted=detachedSeat(s,object);
          await client.query("UPDATE room_seats SET object_id=NULL,local_position=$2::jsonb,local_rotation=$3::jsonb,coordinate_space='rigid',revision=revision+1 WHERE id=$1",
            [s.id,JSON.stringify(converted.local_position),JSON.stringify(converted.local_rotation)]);
        }
        await client.query('DELETE FROM world_objects WHERE room_id=$1 AND id=$2',[roomId,objectId]);result={id:objectId};
      }else{
        if(seats.length+attached.length>100)fail('SEAT_LIMIT');
        if(Number(object.position_x)+1.5>10000)fail('INVALID_OBJECT',400);
        const row=(await client.query(`INSERT INTO world_objects
          (room_id,type,name,model_path,model_type,position_x,position_y,position_z,rotation_x,rotation_y,rotation_z,scale_x,scale_y,scale_z,has_collision)
          SELECT room_id,type,left(name||' — копия',120),model_path,model_type,position_x+1.5,position_y,position_z,rotation_x,rotation_y,rotation_z,scale_x,scale_y,scale_z,has_collision
          FROM world_objects WHERE room_id=$1 AND id=$2 RETURNING *`,[roomId,objectId])).rows[0];
        const labels=new Set(seats.map(s=>s.label));let order=Math.max(0,...seats.map(s=>s.sort_order));
        for(const s of attached){let n=1;while(labels.has(String(n)))n++;labels.add(String(n));
          await insertSeat(client,roomId,{...s,id:randomUUID(),object_id:row.id,label:String(n),sort_order:Math.min(10000,++order),map_x:Math.min(10000,s.map_x+1.5)});
        }
        result={object:row};
      }
      const updated=(await client.query('UPDATE rooms SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',[roomId])).rows[0];
      await client.query('COMMIT');return {...result,room:updated};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  return {mutate};
}
module.exports={createRoomObjectSeats,detachedSeat};
