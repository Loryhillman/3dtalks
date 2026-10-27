const {randomBytes}=require('node:crypto');
const Protocol=require('../../public/js/roomPresentationProtocol'),Store=require('./roomPresentationStore');
const {fail}=Store;
// The WS caller shares runRoomOperation with admission/end. SQL also guards races.
function createRoomPresentationService(pool,{identity,broadcast=()=>{}}){
  const sessions=new Map(),connections=new Map();let timer;
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
  function revoke(connectionId){
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
      revoke(connectionId);session={...actor,epoch:data.state.epoch,token:randomBytes(32).toString('base64url'),leases:new Set()};
      sessions.set(session.token,session);connections.set(connectionId,session.token);
    }
    return {session:{roomId:actor.roomId,epoch:session.epoch,token:session.token,canControl:data.canControl},state:data.state};
  }
  function changed(roomId,state,previousAssetId){
    if(previousAssetId&&previousAssetId!==state.asset?.id)for(const session of sessions.values())if(session.roomId===roomId)
      for(const lease of session.leases)if(lease.assetId===previousAssetId)lease.abort();
    broadcast(roomId,{type:'ROOM_PRESENTATION_STATE',payload:state});
  }
  async function command(connectionId,body){
    if(!Protocol.command(body))fail('INVALID_COMMAND',400);
    const actor=current(connectionId);let previousAssetId;
    const result=await transaction(actor,true,async(client,room,state)=>{
      const signature=JSON.stringify([body.expectedEpoch.toLowerCase(),body.expectedRevision,body.command.type,body.command.assetId?.toLowerCase()||null,body.command.pageIndex??null]);
      const previous=await Store.receipt(client,state,body.requestId,signature);if(previous)return {...previous,reused:true};
      const snapshot=await Store.snapshot(client,state);
      let result;
      if(state.epoch!==body.expectedEpoch.toLowerCase()||String(state.revision)!==body.expectedRevision)result={requestId:body.requestId,success:false,code:'PRESENTATION_CHANGED',status:409,state:snapshot};
      else{
        let asset=state.asset_id,index=state.page_index;
        if(body.command.type==='stop'){asset=null;index=0;}
        else if(body.command.type==='show'){
          const a=(await client.query("SELECT id FROM room_media_assets WHERE id=$1 AND room_id=$2 AND owner_user_id=$3 AND state='ready' AND kind IN ('pdf','image') FOR SHARE",[body.command.assetId,room.id,actor.userId])).rows[0];
          if(!a)result={requestId:body.requestId,success:false,code:'MATERIAL_NOT_FOUND',status:404,state:snapshot};
          else{asset=a.id;index=0;}
        }else if(!snapshot.asset||body.command.pageIndex>=snapshot.asset.pageCount)result={requestId:body.requestId,success:false,code:'INVALID_COMMAND',status:400,state:snapshot};
        else index=body.command.pageIndex;
        if(!result){
          previousAssetId=state.asset_id;
          const updated=(await client.query(`UPDATE room_presentation_state SET asset_id=$2,page_index=$3,revision=revision+1,
            updated_by=$4,updated_at=now() WHERE room_id=$1 RETURNING *`,[room.id,asset,index,actor.userId])).rows[0];
          result={requestId:body.requestId,success:true,state:await Store.snapshot(client,updated)};
        }
      }
      await Store.remember(client,state,body.requestId,signature,result);return result;
    });
    if(result.success&&!result.reused)changed(actor.roomId,result.state,previousAssetId);return result;
  }
  async function authorizeContent(userId,slug,assetId,token,media){
    const session=typeof token==='string'&&sessions.get(token);
    if(!session||session.userId!==userId?.toLowerCase()||!Protocol.uuid(assetId))fail('PRESENTATION_FORBIDDEN',403);
    const actor=current(session.connectionId);let lease;
    if(actor.userId!==session.userId||actor.roomId!==session.roomId||actor.characterId!==session.characterId)fail('PRESENTATION_FORBIDDEN',403);
    try{
      const result=await transaction(actor,false,async(client,room,state)=>{
        if(room.slug!==slug||state.epoch!==session.epoch||state.asset_id!==assetId.toLowerCase()||sessions.get(token)!==session)fail('PRESENTATION_FORBIDDEN',403);
        lease=await media.readPresentation(client,actor,state.asset_id);
        lease.assetId=state.asset_id;session.leases.add(lease);
        const release=lease.release;lease.release=()=>{session.leases.delete(lease);release();};return lease;
      });
      assertCurrent(actor);if(sessions.get(token)!==session)fail('PRESENTATION_FORBIDDEN',403);return result;
    }catch(e){lease?.release();throw e;}
  }
  return {synchronize,command,authorizeContent,changed,revoke,
    revokeRoom(roomId){for(const session of [...sessions.values()])if(session.roomId===roomId)revoke(session.connectionId);},
    start(){if(timer)return;timer=setInterval(()=>pool.query(`DELETE FROM room_presentation_requests WHERE ctid IN
      (SELECT ctid FROM room_presentation_requests WHERE created_at<now()-interval '15 minutes' LIMIT 512)`)
      .catch(()=>console.warn('[roomPresentation] receipt cleanup failed')),30000);timer.unref();},
    close(){clearInterval(timer);for(const connectionId of [...connections.keys()])revoke(connectionId);}
  };
}
module.exports={createRoomPresentationService};
