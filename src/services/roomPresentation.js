const {randomBytes}=require('node:crypto');
const Protocol=require('../../public/js/roomPresentationProtocol'),Store=require('./roomPresentationStore');
const {fail}=Store;
const V2=require('../../public/js/roomPresentationProtocolV2'),Media=require('../../public/js/roomMediaContract'),Timeline=require('../../public/js/roomVideoTimeline');
// The WS caller shares runRoomOperation with admission/end. SQL also guards races.
function createRoomPresentationService(pool,{identity,broadcast=()=>{},features=()=>Media.features(process.env),now=Date.now}){
  const sessions=new Map(),connections=new Map(),negotiated=new Set();let timer;
  const videoGrants=require('./roomVideoGrants').createRoomVideoGrants(actor=>authorizeContent(actor.userId,actor.slug,actor.assetId,actor.sessionToken,actor.media,true));
  function wireState(connectionId,state){
    if(negotiated.has(connectionId))return state.protocolVersion===2?state:{...state,protocolVersion:2,playback:null};
    return state.protocolVersion===2?V2.legacyState(state):state;
  }
  function current(connectionId){
    const actor=identity(connectionId);
    if(!actor||!Protocol.uuid(actor.userId)||!Protocol.uuid(actor.roomId)||!Protocol.uuid(actor.characterId))fail('PRESENTATION_FORBIDDEN',403);
    return {...actor,connectionId};
  }
  function assertCurrent(actor){const now=current(actor.connectionId);if(now.roomId!==actor.roomId||now.userId!==actor.userId||now.characterId!==actor.characterId)fail('PRESENTATION_FORBIDDEN',403);}
  async function transaction(actor,owner,fn){
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      if(owner)await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[actor.userId]);
      await client.query('SELECT pg_advisory_xact_lock(73421, 1)');
      const room=(await client.query('SELECT * FROM rooms WHERE id=$1 FOR UPDATE',[actor.roomId])).rows[0];
      if(!room||room.deleted_at||!['open','closed'].includes(room.status)||room.status==='closed'&&!room.allow_rejoin)fail('PRESENTATION_FORBIDDEN',403);
      if(owner&&room.owner_user_id!==actor.userId)fail('PRESENTATION_FORBIDDEN',403);
      assertCurrent(actor);
      const claim=await client.query(`SELECT 1 FROM room_seat_claims s JOIN characters c ON c.id=s.character_id
        WHERE s.room_id=$1 AND s.character_id=$2 AND s.session_id=$3 AND s.state='active'
          AND s.expires_at>clock_timestamp() AND c.user_id=$4`,[actor.roomId,actor.characterId,actor.connectionId,actor.userId]);
      if(!claim.rows.length)fail('PRESENTATION_FORBIDDEN',403);
      if(!(await client.query("SELECT 1 FROM world_objects WHERE room_id=$1 AND type='presentation_screen'",[actor.roomId])).rows.length)fail('INVALID_SCREEN',400);
      const state=await Store.read(client,room);
      const result=await fn(client,room,state);
      assertCurrent(actor);await client.query('COMMIT');return result;
    }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
  }
  function revoke(connectionId,keepProtocol=false){
    videoGrants.revokeConnection(connectionId);if(!keepProtocol)negotiated.delete(connectionId);
    const token=connections.get(connectionId),session=sessions.get(token);
    if(session){for(const lease of session.leases)lease.abort();sessions.delete(token);}
    connections.delete(connectionId);
  }
  async function synchronize(connectionId){
    const actor=current(connectionId);
    const data=await transaction(actor,false,async(client,room,state)=>({state:await Store.snapshot(client,state),canControl:room.owner_user_id===actor.userId}));
    assertCurrent(actor);
    let session=sessions.get(connections.get(connectionId));
    if(!session||session.epoch!==data.state.epoch||session.roomId!==actor.roomId||session.userId!==actor.userId){
      revoke(connectionId,true);session={...actor,epoch:data.state.epoch,token:randomBytes(32).toString('base64url'),leases:new Set()};
      sessions.set(session.token,session);connections.set(connectionId,session.token);
    }
    return {session:{roomId:actor.roomId,epoch:session.epoch,token:session.token,canControl:data.canControl},state:wireState(connectionId,data.state),upgradeRequired:data.state.asset?.kind==='video'&&!negotiated.has(connectionId)};
  }
  function changed(roomId,state,previousAssetId){
    if(previousAssetId&&previousAssetId!==state.asset?.id)videoGrants.revokeAsset(previousAssetId);
    if(previousAssetId&&previousAssetId!==state.asset?.id)for(const session of sessions.values())if(session.roomId===roomId)
      for(const lease of session.leases)if(lease.assetId===previousAssetId)lease.abort();
    broadcast(roomId,{type:'ROOM_PRESENTATION_STATE',payload:state});
  }
  async function command(connectionId,body){
    const isV2=body?.protocolVersion===2&&negotiated.has(connectionId);
    if(!(isV2?V2.command(body):Protocol.command(body)))fail('INVALID_COMMAND',400);
    const actor=current(connectionId);let previousAssetId;
    const result=await transaction(actor,true,async(client,room,state)=>{
      const signature=JSON.stringify([...(isV2?[2]:[]),body.expectedEpoch.toLowerCase(),body.expectedRevision,body.command.type,body.command.assetId?.toLowerCase()||null,body.command.pageIndex??null,...(isV2?[body.command.positionMs??null]:[])]);
      const previous=await Store.receipt(client,state,body.requestId,signature);if(previous)return {...previous,reused:true};
      const snapshot=await Store.snapshot(client,state);
      let result;
      if(state.epoch!==body.expectedEpoch.toLowerCase()||String(state.revision)!==body.expectedRevision)result={requestId:body.requestId,success:false,code:'PRESENTATION_CHANGED',status:409,state:snapshot};
      else{
        let asset=state.asset_id,index=state.page_index,playback=snapshot.playback||{status:'paused',positionMs:0,anchorServerTimeMs:null};
        if(body.command.type==='stop'){asset=null;index=0;playback={status:'paused',positionMs:0,anchorServerTimeMs:null};}
        else if(body.command.type==='show'){
          const a=(await client.query("SELECT id,kind FROM room_media_assets WHERE id=$1 AND room_id=$2 AND owner_user_id=$3 AND state='ready' FOR SHARE",[body.command.assetId,room.id,actor.userId])).rows[0];
          if(!a||a.kind==='video'&&!isV2)result={requestId:body.requestId,success:false,code:'MATERIAL_NOT_FOUND',status:404,state:snapshot};
          else if(a.kind==='video'&&!features().videoPlayback)fail('VIDEO_UNAVAILABLE',503);
          else{asset=a.id;index=0;playback={status:'paused',positionMs:0,anchorServerTimeMs:null};}
        }else if(['play','pause','seek'].includes(body.command.type)){
          if(!isV2||!features().videoPlayback)fail('VIDEO_UNAVAILABLE',503);
          if(snapshot.asset?.kind!=='video')fail('INVALID_COMMAND',400);
          const duration=snapshot.asset.durationMs,time=now();
          let position=Math.round(Timeline.position(playback,duration,time)),status=playback.status;
          if(body.command.type==='seek'){
            if(body.command.positionMs>duration)fail('INVALID_COMMAND',400);position=body.command.positionMs;
          }else if(body.command.type==='pause')status='paused';
          else{status='playing';if(position>=duration)position=0;}
          if(position>=duration)status='paused';
          playback={status,positionMs:position,anchorServerTimeMs:status==='playing'?time:null};
        }else if(snapshot.asset?.kind==='video'||!snapshot.asset||body.command.pageIndex>=snapshot.asset.pageCount)result={requestId:body.requestId,success:false,code:'INVALID_COMMAND',status:400,state:snapshot};
        else index=body.command.pageIndex;
        if(!result){
          previousAssetId=state.asset_id;
          const updated=(await client.query(`UPDATE room_presentation_state SET asset_id=$2,page_index=$3,revision=revision+1,
            updated_by=$4,playback_status=$5,playback_position_ms=$6,playback_anchor_at=$7,updated_at=now() WHERE room_id=$1 RETURNING *`,[room.id,asset,index,actor.userId,playback.status,playback.positionMs,playback.anchorServerTimeMs===null?null:new Date(playback.anchorServerTimeMs)])).rows[0];
          result={requestId:body.requestId,success:true,state:await Store.snapshot(client,updated)};
        }
      }
      await Store.remember(client,state,body.requestId,signature,result);return result;
    });
    if(result.success&&!result.reused)changed(actor.roomId,result.state,previousAssetId);return result;
  }
  async function authorizeContent(userId,slug,assetId,token,media,video=false){
    const session=typeof token==='string'&&sessions.get(token);
    if(!session||session.userId!==userId?.toLowerCase()||!Protocol.uuid(assetId))fail('PRESENTATION_FORBIDDEN',403);
    if(video&&(!negotiated.has(session.connectionId)||!features().videoPlayback))fail('VIDEO_UNAVAILABLE',503);
    const actor=current(session.connectionId);let lease;
    if(actor.userId!==session.userId||actor.roomId!==session.roomId||actor.characterId!==session.characterId)fail('PRESENTATION_FORBIDDEN',403);
    try{
      const result=await transaction(actor,false,async(client,room,state)=>{
        if(room.slug!==slug||state.epoch!==session.epoch||state.asset_id!==assetId.toLowerCase()||sessions.get(token)!==session)fail('PRESENTATION_FORBIDDEN',403);
        lease=await media.readPresentation(client,actor,state.asset_id);
        if((lease.mime==='video/mp4')!==video)fail('MATERIAL_NOT_FOUND',404);
        lease.assetId=state.asset_id;session.leases.add(lease);
        const release=lease.release;lease.release=()=>{session.leases.delete(lease);release();};return lease;
      });
      assertCurrent(actor);if(sessions.get(token)!==session)fail('PRESENTATION_FORBIDDEN',403);return result;
    }catch(e){lease?.release();throw e;}
  }
  return {synchronize,command,authorizeContent,changed,revoke,wireState,
    async negotiate(connectionId,body){if(!V2.capabilities(body))fail('INVALID_COMMAND',400);await synchronize(connectionId);negotiated.add(connectionId);return {protocolVersion:2,features:features()};},
    clock(connectionId,body,receivedAtMs=now()){current(connectionId);if(!negotiated.has(connectionId)||!V2.clockRequest(body))fail('INVALID_COMMAND',400);return {protocolVersion:2,nonce:body.nonce,receivedAtMs,sentAtMs:Math.max(now(),receivedAtMs)};},
    async issueVideoGrant(userId,slug,assetId,sessionToken,media){
      const session=sessions.get(sessionToken);if(!session||session.userId!==userId.toLowerCase()||!Protocol.uuid(assetId))fail('PRESENTATION_FORBIDDEN',403);
      const grant=await videoGrants.issue({userId:session.userId,roomId:session.roomId,assetId:assetId.toLowerCase(),slug,sessionToken,connectionId:session.connectionId,scopeKey:session.connectionId+':'+slug,media});
      return {...grant,viewId:session.connectionId};
    },
    async readVideoGrant(token,slug,assetId,viewId){
      const session=sessions.get(connections.get(viewId));if(!session||!Protocol.uuid(assetId))fail('PRESENTATION_FORBIDDEN',403);
      return videoGrants.read(token,{roomId:session.roomId,assetId:assetId.toLowerCase(),scopeKey:viewId+':'+slug});
    },
    revokeRoom(roomId){for(const session of [...sessions.values()])if(session.roomId===roomId)revoke(session.connectionId);},
    async start(){if(timer)return;
      // Restart never silently resumes audio. Persist a single paused checkpoint.
      await pool.query(`UPDATE room_presentation_state s SET playback_status='paused',
        playback_position_ms=LEAST(a.video_duration_ms::numeric,GREATEST(0,s.playback_position_ms+floor(GREATEST(0,extract(epoch FROM(clock_timestamp()-s.playback_anchor_at))*1000))))::int,
        playback_anchor_at=NULL,revision=revision+1 FROM room_media_assets a
        WHERE s.asset_id=a.id AND a.kind='video' AND s.playback_status='playing'`);
      timer=setInterval(()=>pool.query(`DELETE FROM room_presentation_requests WHERE ctid IN
      (SELECT ctid FROM room_presentation_requests WHERE created_at<now()-interval '15 minutes' LIMIT 512)`)
      .catch(()=>console.warn('[roomPresentation] receipt cleanup failed')),30000);timer.unref();},
    close(){videoGrants.close();clearInterval(timer);for(const connectionId of [...connections.keys()])revoke(connectionId);}
  };
}
module.exports={createRoomPresentationService};
