const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const limits=require('./roomMediaLimits');
const MediaContract=require('../../public/js/roomMediaContract');
const {createRoomMediaProcessor}=require('./roomMediaProcessor');
const Presentation=require('./roomPresentationStore');
const {runRoomOperation}=require('./roomOperationQueue');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{code,status});};
const dto=a=>({id:a.id,name:a.display_name,kind:a.kind,state:a.state,bytes:Number(a.byte_size||a.declared_bytes),
  pageCount:a.page_count,errorCode:a.error_code,createdAt:a.created_at,...(a.kind==='video'?{
    video:{durationMs:a.video_duration_ms,width:a.video_width,height:a.video_height,fps:a.video_fps===null?null:Number(a.video_fps)}}:{})});
// Called after owner -> advisory -> room locks, also by room deletion.
async function markRoomMediaDeleted(client,roomId){
  await client.query('SELECT id FROM room_media_budget WHERE id=1 FOR UPDATE');
  await client.query("UPDATE room_media_assets SET state='deleting',updated_at=now() WHERE room_id=$1",[roomId]);
}
function createRoomMediaService(pool,{directory=path.resolve(__dirname,'../../uploads/room-media'),processor=createRoomMediaProcessor(),
  features=()=>MediaContract.features(process.env),videoGrantsOptions={},
  presentationChanged=(roomId,state,previous)=>require('./roomPresentationRuntime').service.changed(roomId,state,previous)}={}){
  const videoGrants=require('./roomVideoGrants').createRoomVideoGrants(async actor=>{
    if(!features().videoUpload)fail('VIDEO_UNAVAILABLE',503);
    const lease=await content(actor.userId,actor.roomId,actor.assetId);
    if(lease.mime!=='video/mp4'){lease.release();fail('MATERIAL_NOT_FOUND',404);}return lease;
  },videoGrantsOptions);
  const transfers=new Map(),downloads=new Map();let janitor,ticking=false,stopped=false;
  // UUIDs are case-insensitive, including keys used by the local transfer maps.
  const canonical=id=>typeof id==='string'?id.toLowerCase():id;
  const owned=fn=>(userId,roomId,...args)=>fn(canonical(userId),canonical(roomId),...args);
  const identified=fn=>owned((userId,roomId,id,...args)=>fn(userId,roomId,canonical(id),...args));
  const file=(a,suffix)=>path.join(directory,a.storage_key+suffix);
  const files=a=>({input:file(a,'.part'),output:file(a,'.prepared'),final:file(a,a.kind==='pdf'?'.pdf':a.kind==='video'?'.mp4':'.webp')});
  async function folder(){await fs.mkdir(directory,{recursive:true,mode:0o700});}
  async function transaction(userId,roomId,fn,{deleted=false}={}){
    if(!UUID.test(userId||''))fail('UNAUTHORIZED',401);
    if(!UUID.test(roomId||''))fail('ROOM_NOT_FOUND',404);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      if(!(await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[userId])).rows.length)fail('UNAUTHORIZED',401);
      await client.query('SELECT pg_advisory_xact_lock(73421, 1)');
      const room=(await client.query('SELECT * FROM rooms WHERE id=$1 AND owner_user_id=$2 FOR UPDATE',[roomId,userId])).rows[0];
      if(!room||(!deleted&&(room.deleted_at||room.status==='archived')))fail('ROOM_NOT_FOUND',404);
      const presentation=room.presentation_initialized?await Presentation.read(client,room):null;
      await client.query('SELECT id FROM room_media_budget WHERE id=1 FOR UPDATE');
      const result=await fn(client,room,presentation);await client.query('COMMIT');return result;
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  async function asset(client,userId,roomId,id){
    if(!UUID.test(id||''))fail('MATERIAL_NOT_FOUND',404);
    const row=(await client.query('SELECT * FROM room_media_assets WHERE id=$1 AND room_id=$2 AND owner_user_id=$3 FOR UPDATE',[id,roomId,userId])).rows[0];
    if(!row)fail('MATERIAL_NOT_FOUND',404);return row;
  }
  async function reserve(userId,roomId,body){
    if(!body||Object.keys(body).some(k=>!['requestId','kind','name','bytes'].includes(k))||!UUID.test(body.requestId||'')||
      !['pdf','image','video'].includes(body.kind)||typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>120||/[\x00-\x1f\x7f]/.test(body.name)||!Number.isSafeInteger(body.bytes)||body.bytes<1)fail('INVALID_UPLOAD',400);
    if(body.kind==='video'&&!features().videoUpload)fail('VIDEO_UNAVAILABLE',503);
    if(body.bytes>(body.kind==='video'?MediaContract.video.bytes:body.kind==='pdf'?limits.pdfBytes:limits.imageBytes))fail('FILE_TOO_LARGE',413);
    const charge=body.bytes+(body.kind==='image'?limits.imageBytes:0);
    return transaction(userId,roomId,async client=>{
      const prior=(await client.query('SELECT * FROM room_media_assets WHERE owner_user_id=$1 AND request_id=$2',[userId,body.requestId])).rows[0];
      if(prior){
        if(prior.room_id!==roomId||prior.kind!==body.kind||prior.display_name!==body.name.trim()||Number(prior.declared_bytes)!==body.bytes)fail('REQUEST_ID_REUSED');
        return {upload:dto(prior),reused:true};
      }
      const usage=(await client.query(`SELECT COALESCE(sum(reserved_bytes),0)::bigint AS bytes,
        count(*) FILTER(WHERE reserved_bytes>0)::int AS count,
        count(*) FILTER(WHERE state IN ('reserved','uploading','checking'))::int AS active,
        count(*) FILTER(WHERE created_at>now()-interval '15 minutes')::int AS recent
        FROM room_media_assets WHERE owner_user_id=$1`,[userId])).rows[0];
      if(usage.active>0)fail('UPLOAD_BUSY',429);
      if(usage.recent>=60)fail('UPLOAD_BUSY',429);
      if(Number(usage.bytes)+charge>limits.ownerBytes||usage.count>=limits.ownerCount)fail('MEDIA_QUOTA_EXCEEDED');
      const total=(await client.query('SELECT COALESCE(sum(reserved_bytes),0)::bigint AS bytes,count(*)::int AS count FROM room_media_assets')).rows[0];
      if(Number(total.bytes)+charge>limits.serverBytes||total.count>=2000)fail('MEDIA_STORAGE_FULL',503);
      if(!processor.available())fail('PROCESSOR_BUSY',503);
      await folder();const disk=await fs.statfs(directory);
      if(disk.bavail*disk.bsize<charge+limits.diskMargin)fail('MEDIA_STORAGE_FULL',503);
      const row=(await client.query(`INSERT INTO room_media_assets
        (id,room_id,owner_user_id,request_id,kind,display_name,declared_bytes,reserved_bytes,storage_key,state,lease_until)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reserved',now()+$10*interval '1 millisecond') RETURNING *`,
        [randomUUID(),roomId,userId,body.requestId,body.kind,body.name.trim(),body.bytes,charge,randomUUID(),limits.reserveMs])).rows[0];
      await client.query('UPDATE rooms SET media_initialized=true WHERE id=$1',[roomId]);return {upload:dto(row),reused:false};
    });
  }
  async function list(userId,roomId,{includeVideo=false}={}){return transaction(userId,roomId,async client=>{
    const rows=(await client.query('SELECT * FROM room_media_assets WHERE owner_user_id=$1 AND room_id=$2 AND (kind<>\'video\' OR $3::boolean) ORDER BY created_at DESC LIMIT 64',[userId,roomId,includeVideo===true&&features().videoUpload])).rows;
    const used=(await client.query('SELECT COALESCE(sum(reserved_bytes),0)::bigint AS bytes,count(*) FILTER(WHERE reserved_bytes>0)::int AS count FROM room_media_assets WHERE owner_user_id=$1',[userId])).rows[0];
    return {materials:rows.map(dto),quota:{bytes:Number(used.bytes),count:used.count,byteLimit:limits.ownerBytes,countLimit:limits.ownerCount}};
  });}
  async function get(userId,roomId,id){return transaction(userId,roomId,async client=>dto(await asset(client,userId,roomId,id)));}
  async function begin(userId,roomId,id){
    if(stopped||transfers.size>=limits.transfers)fail('UPLOAD_BUSY',429);
    // Reserve the local slot before the first await; SQL owns cross-tab idempotence.
    const controller=new AbortController(),slot=randomUUID();transfers.set(slot,controller);
    controller.roomId=roomId;
    try{
      const row=await transaction(userId,roomId,async client=>{
        const a=await asset(client,userId,roomId,id);
        if(a.kind==='video'&&!features().videoUpload)fail('VIDEO_UNAVAILABLE',503);
        if(a.state!=='reserved'||new Date(a.lease_until)<=new Date())fail('UPLOAD_EXPIRED');
        if(!processor.available())fail('PROCESSOR_BUSY',503);
        return (await client.query("UPDATE room_media_assets SET state='uploading',lease_until=now()+$2*interval '1 millisecond',updated_at=now() WHERE id=$1 RETURNING *",[id,limits.processingLeaseMs])).rows[0];
      });
      transfers.delete(slot);transfers.set(id,controller);return {row,paths:files(row),controller};
    }catch(e){transfers.delete(slot);throw e;}
  }
  async function failed(userId,roomId,id,code){
    try{await transaction(userId,roomId,async client=>{
      await asset(client,userId,roomId,id);
      await client.query(`UPDATE room_media_assets SET state=CASE WHEN state IN ('cancelled','deleting') THEN state ELSE 'failed' END,
        error_code=$2,lease_until=now(),updated_at=now() WHERE id=$1 AND state<>'ready'`,[id,code]);
    },{deleted:true});}finally{transfers.delete(id);}
  }
  async function complete(userId,roomId,upload){
    const {row,paths,controller}=upload;
    const stat=await fs.stat(paths.input);if(stat.size!==Number(row.declared_bytes))fail('UPLOAD_SIZE_MISMATCH',400);
    await transaction(userId,roomId,async client=>{
      const a=await asset(client,userId,roomId,row.id);if(a.state!=='uploading')fail('UPLOAD_CANCELLED');
      await client.query("UPDATE room_media_assets SET state='checking',updated_at=now() WHERE id=$1",[row.id]);
    });
    const result=await processor.run(row.kind,paths.input,paths.output,controller.signal);
    if(controller.signal.aborted)fail('UPLOAD_CANCELLED');
    if(row.kind==='video'&&!features().videoUpload)fail('VIDEO_UNAVAILABLE',503);
    const video=row.kind==='video';
    if(!Number.isSafeInteger(result.bytes)||result.bytes<1||result.bytes>Number(row.reserved_bytes)||!/^[a-f0-9]{64}$/.test(result.checksum||'')||
      (video?result.bytes!==stat.size||result.pageCount!==null||result.mime!=='video/mp4'||!MediaContract.videoMetadata(result.video):
        !Number.isInteger(result.pageCount)||result.pageCount<1||result.pageCount>limits.pages||result.mime!==(row.kind==='pdf'?'application/pdf':'image/webp')))fail('PROCESSOR_FAILED',422);
    await fs.rename(row.kind==='image'?paths.output:paths.input,paths.final);
    if(row.kind==='image')await fs.unlink(paths.input);
    const ready=await transaction(userId,roomId,async client=>{
      const a=await asset(client,userId,roomId,row.id);if(a.state!=='checking'||controller.signal.aborted)fail('UPLOAD_CANCELLED');
      return (await client.query(`UPDATE room_media_assets SET state='ready',reserved_bytes=$2,byte_size=$2,page_count=$3,
        mime=$4,checksum=$5,video_duration_ms=$6,video_width=$7,video_height=$8,video_fps=$9,
        video_codec=$10,video_pixel_format=$11,video_audio_codec=$12,lease_until=now(),updated_at=now() WHERE id=$1 RETURNING *`,
        [row.id,result.bytes,result.pageCount,result.mime,result.checksum,result.video?.durationMs??null,result.video?.width??null,result.video?.height??null,
          result.video?.fps??null,result.video?.codec??null,result.video?.pixelFormat??null,result.video?.audioCodec??null])).rows[0];
    });
    transfers.delete(row.id);return dto(ready);
  }
  async function cancel(userId,roomId,id){
    const result=await transaction(userId,roomId,async client=>{
      const a=await asset(client,userId,roomId,id);
      if(a.state==='ready')fail('UPLOAD_ALREADY_READY');
      if(a.state==='deleting')return dto(a);
      return dto((await client.query("UPDATE room_media_assets SET state='cancelled',updated_at=now() WHERE id=$1 RETURNING *",[id])).rows[0]);
    });
    transfers.get(id)?.abort();return result;
  }
  async function remove(userId,roomId,id,body={}){
    if(!require('../../public/js/roomPresentationProtocol').keys(body,['stopShowing','requestId','expectedEpoch','expectedRevision'])||body.stopShowing!==undefined&&typeof body.stopShowing!=='boolean')fail('INVALID_COMMAND',400);
    let changed;
    const result=await transaction(userId,roomId,async(client,_room,state)=>{
      const stopped=await Presentation.deleteActive(client,state,id,body,userId);
      if(stopped?.error||stopped?.reused)return stopped;
      const a=await asset(client,userId,roomId,id);
      if(['reserved','uploading','checking'].includes(a.state))fail('UPLOAD_BUSY',429);
      await client.query("UPDATE room_media_assets SET state='deleting',lease_until=now(),updated_at=now() WHERE id=$1",[id]);
      if(stopped)changed=stopped.state;return stopped||{id};
    });
    if(result.error)Presentation.fail(result.code,result.status,result.state);
    videoGrants.revokeAsset(id);
    for(const download of downloads.values())if(download.assetId===id)download.controller.abort();
    if(changed)presentationChanged(roomId,changed,id);return result;
  }
  function lease(a,userId,roomId){
    if(stopped||downloads.size>=limits.downloads||[...downloads.values()].filter(d=>d.userId===userId).length>=limits.ownerDownloads)fail('DOWNLOAD_BUSY',429);
    const key=randomUUID(),controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),a.kind==='video'?MediaContract.video.durationMs+30000:limits.readMs);timeout.unref();
    const release=()=>{clearTimeout(timeout);downloads.delete(key);};
    downloads.set(key,{userId,roomId,assetId:a.id,controller});
    return {path:files(a).final,mime:a.mime,bytes:Number(a.byte_size),signal:controller.signal,release,abort:()=>controller.abort()};
  }
  async function content(userId,roomId,id){
    let release=()=>{};
    try{return await transaction(userId,roomId,async client=>{
      const a=await asset(client,userId,roomId,id);if(a.state!=='ready')fail('MATERIAL_NOT_FOUND',404);
      const result=lease(a,userId,roomId);release=result.release;return result;
    });}catch(e){release();throw e;}
  }
  async function cleanup(){
    if(ticking||stopped)return;ticking=true;
    try{
      const candidates=(await pool.query(`SELECT a.* FROM room_media_assets a JOIN rooms r ON r.id=a.room_id
        WHERE (a.state<>'ready' AND a.lease_until<now()) OR r.deleted_at IS NOT NULL
        ORDER BY a.lease_until LIMIT $1`,[limits.cleanupBatch])).rows;
      for(const a of candidates){
        // POSIX unlink does not free disk blocks until open readers close.
        if(transfers.has(a.id)||[...downloads.values()].some(d=>d.assetId===a.id))continue;
        const claimed=await transaction(a.owner_user_id,a.room_id,async(client,room)=>{
          const current=await asset(client,a.owner_user_id,a.room_id,a.id);
          if(current.state==='ready'&&!room.deleted_at||new Date(current.lease_until)>new Date())return false;
          await client.query(`UPDATE room_media_assets SET state=CASE WHEN state IN ('reserved','uploading','checking') THEN 'failed'
            WHEN $2 THEN 'deleting' ELSE state END,error_code=COALESCE(error_code,'UPLOAD_EXPIRED'),
            lease_until=now()+interval '30 seconds' WHERE id=$1`,[a.id,!!room.deleted_at]);return true;
        },{deleted:true});
        if(!claimed)continue;
        try{
          for(const name of Object.values(files(a)))await fs.unlink(name).catch(e=>{if(e.code!=='ENOENT')throw e;});
          await transaction(a.owner_user_id,a.room_id,async client=>{
            await client.query("UPDATE room_media_assets SET reserved_bytes=0 WHERE id=$1 AND state IN ('failed','cancelled','deleting')",[a.id]);
            await client.query("DELETE FROM room_media_assets WHERE id=$1 AND reserved_bytes=0 AND updated_at<now()-interval '15 minutes'",[a.id]);
          },{deleted:true});
        }catch(e){console.warn('[roomMedia] cleanup failed',{assetId:a.id,code:e.code||'CLEANUP_FAILED'});}
      }
    }finally{ticking=false;}
  }
  return {reserve:owned(reserve),list:owned(list),get:identified(get),begin:identified(begin),complete:owned(complete),
    failed:identified(failed),cancel:identified(cancel),remove:identified((...args)=>runRoomOperation(()=>remove(...args))),content:identified(content),cleanup,
    async issueVideoGrant(userId,roomId,assetId){return videoGrants.issue({userId:canonical(userId),roomId:canonical(roomId),assetId:canonical(assetId)});},
    async readVideoGrant(token,roomId,assetId){return videoGrants.read(token,{roomId:canonical(roomId),assetId:canonical(assetId)});},
    // Internal only: the presentation authorizer holds the room/state SQL locks.
    async readPresentation(client,actor,id){
      const row=(await client.query("SELECT * FROM room_media_assets WHERE id=$1 AND room_id=$2 AND state='ready'",[id,actor.roomId])).rows[0];
      if(!row)fail('MATERIAL_NOT_FOUND',404);return lease(row,actor.userId,actor.roomId);
    },
    abortRoom(roomId){
      videoGrants.revokeRoom(roomId.toLowerCase());
      for(const controller of transfers.values())if(controller.roomId.toLowerCase()===roomId.toLowerCase())controller.abort();
      for(const download of downloads.values())if(download.roomId.toLowerCase()===roomId.toLowerCase())download.controller.abort();
    },
    async start(){await folder();await cleanup();janitor=setInterval(()=>cleanup().catch(e=>console.warn('[roomMedia] cleanup error',{code:e.code||'DATABASE_ERROR'})),30000);janitor.unref();},
    close(){stopped=true;videoGrants.close();clearInterval(janitor);for(const controller of transfers.values())controller.abort();for(const d of downloads.values())d.controller.abort();processor.close();}
  };
}
module.exports={createRoomMediaService,markRoomMediaDeleted};
