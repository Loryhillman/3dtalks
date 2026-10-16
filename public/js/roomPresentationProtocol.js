/** Wire metadata only. Revisions use decimal strings to preserve SQL bigint precision. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoomPresentationProtocol=factory();
})(typeof window==='undefined'?globalThis:window,()=>{
  const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const keys=(v,list)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>list.includes(k));
  const revision=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
  function command(v){
    return keys(v,['requestId','expectedEpoch','expectedRevision','command'])&&uuid(v.requestId)&&uuid(v.expectedEpoch)&&revision(v.expectedRevision)&&
      (keys(v.command,['type','assetId'])&&v.command.type==='show'&&uuid(v.command.assetId)||
       keys(v.command,['type','pageIndex'])&&v.command.type==='page'&&Number.isInteger(v.command.pageIndex)&&v.command.pageIndex>=0&&v.command.pageIndex<100||
       keys(v.command,['type'])&&v.command.type==='stop');
  }
  function state(v){return keys(v,['roomId','epoch','revision','asset','pageIndex'])&&uuid(v.roomId)&&uuid(v.epoch)&&revision(v.revision)&&
    Number.isInteger(v.pageIndex)&&(v.asset===null?v.pageIndex===0:
      keys(v.asset,['id','name','kind','pageCount'])&&uuid(v.asset.id)&&typeof v.asset.name==='string'&&v.asset.name.length<=120&&
      ['pdf','image'].includes(v.asset.kind)&&Number.isInteger(v.asset.pageCount)&&v.asset.pageCount>=1&&v.asset.pageCount<=100&&
      (v.asset.kind!=='image'||v.asset.pageCount===1)&&v.pageIndex>=0&&v.pageIndex<v.asset.pageCount);}
  function session(v){return keys(v,['roomId','epoch','token','canControl'])&&uuid(v.roomId)&&uuid(v.epoch)&&
    typeof v.token==='string'&&/^[a-zA-Z0-9_-]{43}$/.test(v.token)&&typeof v.canControl==='boolean';}
  function requestId(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;
    const h=[...b].map(n=>n.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
  return {uuid,keys,revision,command,state,session,requestId};
});
