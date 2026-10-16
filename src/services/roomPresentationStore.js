const Protocol=require('../../public/js/roomPresentationProtocol');
function fail(code,status=409,state){throw Object.assign(new Error(code),{code,status,state});}
async function read(client,room){
  if(!room.presentation_initialized){
    await client.query('INSERT INTO room_presentation_state(room_id) VALUES($1) ON CONFLICT DO NOTHING',[room.id]);
    await client.query('UPDATE rooms SET presentation_initialized=true WHERE id=$1',[room.id]);
  }
  return (await client.query('SELECT * FROM room_presentation_state WHERE room_id=$1 FOR UPDATE',[room.id])).rows[0];
}
async function snapshot(client,state){
  const a=state.asset_id?(await client.query("SELECT id,display_name,kind,page_count FROM room_media_assets WHERE id=$1 AND room_id=$2 AND state='ready'",[state.asset_id,state.room_id])).rows[0]:null;
  return {roomId:state.room_id,epoch:state.epoch,revision:String(state.revision),asset:a?{id:a.id,name:a.display_name,kind:a.kind,pageCount:a.page_count}:null,pageIndex:a?state.page_index:0};
}
async function receipt(client,state,requestId,signature){
  await client.query("DELETE FROM room_presentation_requests WHERE room_id=$1 AND created_at<now()-interval '15 minutes'",[state.room_id]);
  const previous=(await client.query('SELECT signature,result FROM room_presentation_requests WHERE room_id=$1 AND epoch=$2 AND request_id=$3',[state.room_id,state.epoch,requestId])).rows[0];
  if(previous){if(previous.signature!==signature)fail('REQUEST_ID_REUSED');return previous.result;}
  const count=(await client.query('SELECT count(*)::int AS n FROM room_presentation_requests WHERE room_id=$1',[state.room_id])).rows[0].n;
  if(count>=256)fail('PRESENTATION_REQUEST_LIMIT',429);return null;
}
async function remember(client,state,requestId,signature,result){
  await client.query('INSERT INTO room_presentation_requests(room_id,epoch,request_id,signature,result) VALUES($1,$2,$3,$4,$5::jsonb)',[state.room_id,state.epoch,requestId,signature,JSON.stringify(result)]);
}
async function reset(client,roomId){
  await client.query(`UPDATE room_presentation_state SET epoch=gen_random_uuid(),revision=revision+1,
    asset_id=NULL,page_index=0,updated_by=NULL,updated_at=now() WHERE room_id=$1`,[roomId]);
  await client.query('DELETE FROM room_presentation_requests WHERE room_id=$1',[roomId]);
}
async function deleteActive(client,state,id,body,userId){
  if(!state)return null;
  if(body.stopShowing!==true){if(state.asset_id===id)fail('MATERIAL_IN_USE',409,await snapshot(client,state));return null;}
  if(!Protocol.keys(body,['stopShowing','requestId','expectedEpoch','expectedRevision'])||!Protocol.uuid(body.requestId)||!Protocol.uuid(body.expectedEpoch)||!Protocol.revision(body.expectedRevision))fail('INVALID_COMMAND',400);
  const signature=JSON.stringify(['delete',id,body.expectedEpoch.toLowerCase(),body.expectedRevision]);
  const previous=await receipt(client,state,body.requestId,signature);if(previous)return {reused:true,...previous};
  const current=await snapshot(client,state);
  if(state.epoch!==body.expectedEpoch.toLowerCase()||String(state.revision)!==body.expectedRevision){
    const result={error:true,code:'PRESENTATION_CHANGED',status:409,state:current};
    await remember(client,state,body.requestId,signature,result);return result;
  }
  if(state.asset_id!==id)return null;
  const updated=(await client.query(`UPDATE room_presentation_state SET asset_id=NULL,page_index=0,
    revision=revision+1,updated_by=$2,updated_at=now() WHERE room_id=$1 RETURNING *`,[state.room_id,userId])).rows[0];
  const result={id,state:await snapshot(client,updated)};
  await remember(client,state,body.requestId,signature,result);return result;
}
module.exports={read,snapshot,receipt,remember,reset,deleteActive,fail};
