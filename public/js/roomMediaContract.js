/** Shared v2 bounds only; feature gates do not bypass server authorization. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoomMediaContract=factory();
})(typeof window==='undefined'?globalThis:window,()=>{
  const video=Object.freeze({bytes:40*1024**2,durationMs:600000,width:1920,height:1080,fps:30,codec:'h264',pixelFormat:'yuv420p',audioCodec:'aac'});
  const pptx=Object.freeze({bytes:20*1024**2,pages:100,outputBytes:20*1024**2,expandedBytes:200*1024**2});
  // Temporary trial limits apply to new imports only; stored assets keep v2 bounds.
  const importLimits=Object.freeze({video:Object.freeze({bytes:20*1024**2,durationMs:180000}),pptx:Object.freeze({bytes:5*1024**2,pages:20})});
  const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
  function videoMetadata(v){
    return !!v&&typeof v==='object'&&!Array.isArray(v)&&
      Object.keys(v).every(k=>['durationMs','width','height','fps','codec','pixelFormat','audioCodec'].includes(k))&&
      integer(v.durationMs,1,video.durationMs)&&integer(v.width,1,video.width)&&integer(v.height,1,video.height)&&
      typeof v.fps==='number'&&Number.isFinite(v.fps)&&v.fps>0&&v.fps<=video.fps&&
      v.codec===video.codec&&v.pixelFormat===video.pixelFormat&&(v.audioCodec===null||v.audioCodec===video.audioCodec);
  }
  function features(env={}){
    const videoUpload=env.ROOM_VIDEO_UPLOAD_ENABLED==='true';
    return Object.freeze({videoUpload,videoPlayback:videoUpload&&env.ROOM_VIDEO_PLAYBACK_ENABLED==='true',pptxImport:env.ROOM_PPTX_IMPORT_ENABLED==='true'});
  }
  return Object.freeze({version:2,video,pptx,importLimits,integer,videoMetadata,features});
});
