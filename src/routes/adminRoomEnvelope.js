const E=require('../../public/js/roomEnvelope');
const {listRoomObjects}=require('../services/roomObjects');
const fs=require('node:fs/promises');
const path=require('node:path');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function registerRoomEnvelopeRoutes(router,pool,logAdminAction){
  router.patch('/:id/envelope',async(req,res)=>{
    const {envelope,revision}=req.body||{};
    if(!UUID.test(req.params.id)||!Number.isInteger(revision)||revision<1||!E.valid(envelope))return res.status(400).json({success:false,error:'Проверьте размеры и оформление помещения'});
    let client;
    try{
      client=await pool.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(73421, 1)');
      const room=(await client.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
      if(!room||room.status!=='draft'||room.revision!==revision)throw Object.assign(new Error('Комната изменилась или уже используется. Обновите страницу'),{status:409});
      const shells=(await listRoomObjects(room.id,client)).filter(o=>o.is_room_shell);
      if(shells.length!==1||!shells[0].room_envelope)throw Object.assign(new Error('Не удалось распознать прямоугольное помещение'),{status:422});
      for(const surface of Object.values(envelope.surfaces))if(surface.mode!=='color'){
        const file=await fs.stat(path.join(__dirname,'../../public',surface.image)).catch(()=>null);
        if(!file?.isFile()||!file.size)throw Object.assign(new Error('Не найден файл оформления поверхности'),{status:422});
      }
      const geometry=(await client.query(`INSERT INTO geometry_buildings(user_id,name,template_id,geometry_data,owner_user_id,created_at)
        VALUES($1,$2,'room_room',$3::jsonb,$4,now()) RETURNING id`,
        [req.adminUser.id,shells[0].name,JSON.stringify({envelope,components:E.components(envelope)}),room.owner_user_id])).rows[0];
      await client.query(`UPDATE world_objects SET model_path=$3,scale_x=1,scale_y=1,scale_z=1,has_collision=true,updated_at=now() WHERE room_id=$1 AND id=$2`,[room.id,shells[0].id,'geometry_building:'+geometry.id]);
      const updated=(await client.query('UPDATE rooms SET revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',[room.id])).rows[0];
      await client.query('COMMIT');
      logAdminAction(req.adminUser.id,'UPDATE_ROOM_ENVELOPE','rooms',room.id,'Room surfaces and dimensions',req.ip).catch(()=>{});
      res.json({success:true,room:updated});
    }catch(e){if(client)await client.query('ROLLBACK').catch(()=>{});if(!e.status)console.error('[roomEnvelope]',e);res.status(e.status||500).json({success:false,error:e.status?e.message:'Не удалось сохранить помещение'});}
    finally{client?.release();}
  });
}
module.exports={registerRoomEnvelopeRoutes};
