const assert=require('node:assert/strict');
const {check}=require('../public/js/roomPlacementCheck');
const Environment=require('../public/js/roomEnvironment');
const {roomSeatPose}=require('../src/services/roomSeatPose');
const room={id:1,is_room_environment:true,room_environment:{version:1,bounds:{min:{x:-4000,y:0,z:-3000},max:{x:4000,y:3000,z:3000}}},
 position_x:10,position_y:0,position_z:-10,rotation_y:.6,scale_x:.001,scale_y:.001,scale_z:.001};
const chair={id:2,name:'Chair',position_x:10,position_y:0,position_z:-10,scale_x:100,scale_y:100,scale_z:100};
const seat=(label,p,enabled=true)=>({label,object_id:null,enabled,coordinate_space:'rigid',local_position:p,local_rotation:{x:0,y:0,z:0}});
const free=seat('Free',{x:10,y:1,z:-10}),attached={...seat('Attached',{x:1,y:1,z:0}),object_id:2};
assert.deepEqual(check([room,chair],[free,attached],roomSeatPose),[],'rigid seats ignore huge furniture scales');
const outside=seat('Outside',{x:13,y:1,z:-7});
assert(check([room,chair],[outside],roomSeatPose).some(i=>i.type==='seatOutside'),'rotated interior is checked rather than its world AABB');
assert.deepEqual(check([room,chair],[{...outside,enabled:false}],roomSeatPose),[],'disabled seats are not admission points');
const issues=check([{...room,position_x:30},chair],[free,attached],roomSeatPose);
assert.equal(issues.filter(i=>i.type==='seatOutside').length,2);assert.equal(issues.filter(i=>i.type==='objectOutside').length,1);
assert(check([room],[{...attached,object_id:99}],roomSeatPose).some(i=>i.type==='invalidSeat'));
assert(check([room],[free,{...free,label:'Duplicate'}],roomSeatPose).filter(i=>i.type==='seatOverlap').length===2);
assert(check([{...room,scale_x:-1}],[],roomSeatPose).some(i=>i.type==='invalidBounds'));
assert(check([room,{...room,id:3}],[],roomSeatPose).some(i=>i.type==='invalidBounds'));
assert.equal(check([{id:1,is_room_shell:true}],[],roomSeatPose)[0].severity,'warning','legacy shells without known bounds remain usable');
const t={position:{x:10,y:0,z:-10},rotation:{x:0,y:.6,z:0},scale:{x:.001,y:.001,z:.001}};
for(const [offset,expected] of [[5,false],[20,true]]){
 const p=Environment.toWorld({x:4000+offset,y:1000,z:0},t);
 assert.equal(check([room],[seat('Edge',p)],roomSeatPose).some(i=>i.type==='seatOutside'),expected,'1 cm tolerance is independent of model source units');
}
const Envelope=require('../public/js/roomEnvelope');
const envelope={version:1,width:8,length:6,height:3,thickness:{x:.2,z:.2,floor:.2,ceiling:.2},surfaces:Object.fromEntries(Envelope.surfaces.map(k=>[k,{mode:'color',color:'#ffffff',image:null,fit:'cover',tileWidth:2,tileHeight:2}]))};
assert.deepEqual(check([{id:1,is_room_shell:true,room_envelope:envelope}],[seat('Inside',{x:0,y:1,z:0})],roomSeatPose),[]);
assert(check([{id:1,is_room_shell:true,room_envelope:envelope}],[seat('Outside',{x:5,y:1,z:0})],roomSeatPose).some(i=>i.type==='seatOutside'));
console.log('Placement diagnostics: imported/built bounds, rotated interiors, source units, independent/rigid seats, overlaps, missing parents and legacy compatibility OK');
// The client diagnostic must agree with existing publication checks on valid layouts.
const {publicationErrors}=require('../src/services/roomTemplateEditor');
const objectTransform=o=>Object.fromEntries(['position','rotation','scale'].map(prefix=>[prefix,Object.fromEntries(['x','y','z'].map(a=>[a,Number(o[prefix+'_'+a]??(prefix==='scale'?1:0))]))]));
function layout(room,seats){
 const complete=(s,i)=>({...s,sort_order:i,map_x:0,map_y:0});
 return [{type:'room_environment',kind:'room',name:'Office',model_id:1,model_path:'/models/uploaded/office.glb',collision:false,environment:room.room_environment,...objectTransform(room)},
  {type:'geometry_building',kind:'furniture',name:'Chair',components:[{type:'box',width:1,height:1,depth:1}],collision:false,...objectTransform(chair),seats:seats.filter(s=>s.object_id===2).map(complete)},
  {type:'seat',kind:'seat',name:'Free seats',collision:false,...objectTransform({}),seats:seats.filter(s=>s.object_id==null).map(complete)}];
}
for(const [r,seats] of [[room,[free,attached]],[{...room,position_x:30},[free,attached]],[room,[outside]],[room,[free,{...free,label:'Second'}]]]){
 const client=check([r,chair],seats,roomSeatPose),server=publicationErrors(layout(r,seats),'office');
 assert.equal(client.some(i=>i.type==='objectOutside'),server.some(s=>s.startsWith('Предмет находится')));
 assert.equal(client.some(i=>i.type==='seatOutside'),server.some(s=>s.startsWith('Посадка находится')));
 assert.equal(client.some(i=>i.type==='seatOverlap'),server.some(s=>s.startsWith('Слишком близко')));
}
console.log('Placement diagnostics agree with existing server publication rules on valid imported layouts');
