/** Explicit opt-in wire contract; reuses V1 slides and shared media bounds. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./roomPresentationProtocol'),require('./roomMediaContract'));
  else root.RoomPresentationProtocolV2=factory(root.RoomPresentationProtocol,root.RoomMediaContract);
})(typeof window==='undefined'?globalThis:window,(Legacy,Media)=>{
  const {uuid,keys,revision}=Legacy;
  const {integer:bounded,video}=Media;
  const timestamp=n=>bounded(n,0,8640000000000000);
  function commandV2(v){
    if(!keys(v,['protocolVersion','requestId','expectedEpoch','expectedRevision','command'])||v.protocolVersion!==2)return false;
    const {protocolVersion,...legacy}=v;
    if(Legacy.command(legacy))return true;
    return uuid(v.requestId)&&uuid(v.expectedEpoch)&&revision(v.expectedRevision)&&
      (keys(v.command,['type'])&&['play','pause'].includes(v.command.type)||
       keys(v.command,['type','positionMs'])&&v.command.type==='seek'&&bounded(v.command.positionMs,0,video.durationMs));
  }
  function stateV2(v){
    if(!keys(v,['protocolVersion','roomId','epoch','revision','asset','pageIndex','playback'])||v.protocolVersion!==2)return false;
    const {protocolVersion,playback,...legacy}=v;
    if(Legacy.state(legacy))return playback===null;
    const a=v.asset,p=v.playback;
    return uuid(v.roomId)&&uuid(v.epoch)&&revision(v.revision)&&v.pageIndex===0&&
      keys(a,['id','name','kind','durationMs','width','height'])&&uuid(a.id)&&typeof a.name==='string'&&a.name.length<=120&&a.kind==='video'&&
      bounded(a.durationMs,1,video.durationMs)&&Media.videoDimensions(a.width,a.height)&&
      keys(p,['status','positionMs','anchorServerTimeMs'])&&bounded(p.positionMs,0,a.durationMs)&&
      (p.status==='paused'&&p.anchorServerTimeMs===null||p.status==='playing'&&timestamp(p.anchorServerTimeMs)&&p.positionMs<a.durationMs);
  }
  // A V1 viewer must never retain an obsolete slide while a video is active.
  // Routing/notice delivery is implemented in the later playback stage.
  function legacyState(v){
    if(!stateV2(v))return null;
    const {protocolVersion,playback,...result}=v;
    return v.asset?.kind==='video'?{...result,asset:null,pageIndex:0}:result;
  }
  // Explicit address-only negotiation; never broadcast a participant's session.
  function capabilities(v){return keys(v,['protocolVersion'])&&v.protocolVersion===2;}
  function capabilitiesResult(v){
    const f=v?.features;
    return keys(v,['protocolVersion','features'])&&v.protocolVersion===2&&
      keys(f,['videoUpload','videoPlayback','pptxImport'])&&
      ['videoUpload','videoPlayback','pptxImport'].every(k=>typeof f[k]==='boolean')&&(!f.videoPlayback||f.videoUpload);
  }
  function clockRequest(v){return keys(v,['protocolVersion','nonce'])&&v.protocolVersion===2&&uuid(v.nonce);}
  function clockResponse(v){return keys(v,['protocolVersion','nonce','receivedAtMs','sentAtMs'])&&clockRequest({protocolVersion:v.protocolVersion,nonce:v.nonce})&&
    timestamp(v.receivedAtMs)&&timestamp(v.sentAtMs)&&v.sentAtMs>=v.receivedAtMs;}
  return Object.freeze({command:commandV2,state:stateV2,legacyState,capabilities,capabilitiesResult,clockRequest,clockResponse});
});
