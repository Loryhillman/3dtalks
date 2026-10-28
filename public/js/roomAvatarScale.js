// Shared contract. Room snapshots, not personal profiles, own furniture calibration.
(function(root){
  const MIN=.5,MAX=2;
  const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=MIN&&value<=MAX;
  const api={MIN,MAX,valid,resolve:value=>valid(value)?value:1};
  if(typeof module!=='undefined')module.exports=api;else root.RoomAvatarScale=api;
})(typeof window==='undefined'?globalThis:window);
