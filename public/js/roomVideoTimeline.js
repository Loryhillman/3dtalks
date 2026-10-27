/** Shared millisecond timeline; no client time is authoritative for commands. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoomVideoTimeline=factory();})(typeof window==='undefined'?globalThis:window,()=>({
 position(playback,durationMs,serverNowMs){
  const elapsed=playback.status==='playing'?Math.max(0,serverNowMs-playback.anchorServerTimeMs):0;
  return Math.max(0,Math.min(durationMs,playback.positionMs+elapsed));
 }
}));
