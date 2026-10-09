/** Placement diagnostics over DTOs. Bounds check anchors, not mesh intersections. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./roomEnvironment'),require('./roomEnvelope'));
  else root.RoomPlacementCheck=factory(root.RoomEnvironment,root.RoomEnvelope);
})(typeof window==='undefined'?globalThis:window,(Environment,Envelope)=>{
  const axes=['x','y','z'];
  const finitePoint=p=>p&&axes.every(a=>Number.isFinite(p[a])&&Math.abs(p[a])<=10000);
  const transform=o=>Object.fromEntries(['position','rotation','scale'].map(prefix=>[prefix,
    Object.fromEntries(axes.map(a=>[a,Number(o[prefix+'_'+a]??(prefix==='scale'?1:0))]))]));
  function check(objects,seats,resolvePose){
    const issues=[],parents=new Map(objects.map(o=>[o.id,o]));
    const rooms=objects.filter(o=>o.is_room_environment||o.is_room_shell);
    let contains;
    if(rooms.length>1)issues.push({type:'invalidBounds',severity:'error'});
    else if(rooms[0]?.is_room_environment){
      const room=rooms[0],t=transform(room);
      if(Environment.valid(room.room_environment,t))contains=p=>Environment.contains(p,room.room_environment,t);
      else issues.push({type:'invalidBounds',severity:'error'});
    }else if(rooms[0]?.room_envelope){
      const room=rooms[0],t=transform(room);
      if(Envelope.valid(room.room_envelope)&&finitePoint(t.position)&&finitePoint(t.rotation)&&axes.every(a=>Number.isFinite(t.scale[a])&&t.scale[a]>0)){
        const shell={envelope:room.room_envelope,...t};contains=p=>Envelope.contains(p,shell);
      }else issues.push({type:'invalidBounds',severity:'error'});
    }else issues.push({type:'unavailableBounds',severity:'warning'});
    for(const object of objects){
      if(object.is_room_environment||object.is_room_shell)continue;
      const position=transform(object).position;
      if(!finitePoint(position))issues.push({type:'invalidObject',severity:'error',id:object.id,name:object.name});
      else if(contains&&!contains(position))issues.push({type:'objectOutside',severity:'error',id:object.id,name:object.name});
    }
    const positions=[],overlapping=new Set();
    seats.forEach((seat,index)=>{
      if(!seat.enabled)return;
      try{
        if(seat.object_id!=null&&!parents.has(seat.object_id))throw Error('Missing parent');
        const position=resolvePose(seat,parents.get(seat.object_id)).position;
        if(!finitePoint(position))throw Error('Invalid position');
        if(contains&&!contains(position))issues.push({type:'seatOutside',severity:'error',index,label:seat.label});
        for(const previous of positions)if(Math.hypot(...axes.map(a=>position[a]-previous.position[a]))<.2){overlapping.add(previous.index);overlapping.add(index);}
        positions.push({position,index});
      }catch(_){issues.push({type:'invalidSeat',severity:'error',index,label:seat.label});}
    });
    for(const index of overlapping)issues.push({type:'seatOverlap',severity:'error',index,label:seats[index].label});
    return issues;
  }
  return {check};
});
