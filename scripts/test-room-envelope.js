const assert=require('node:assert/strict');
const E=require('../public/js/roomEnvelope');
const {publicationErrors}=require('../src/services/roomTemplateEditor');
const panel=(width,height,depth,x,y,z)=>({type:'box',width,height,depth,position:{x,y,z},color:'#d7d3ca'});
const old={kind:'room',name:'Room',collision:true,position:{x:0,y:0,z:0},rotation_y:0,components:[
  panel(24,.2,20,0,-.1,0),panel(24,8,.2,0,4,-10),panel(24,8,.2,0,4,10),panel(.2,8,20,-12,4,0),panel(.2,8,20,12,4,0),panel(24,.2,20,0,8.1,0)]};
const shell=E.fromLegacy(old);assert.equal(shell.type,'room_shell');assert.equal(shell.envelope.width,23.8);assert.equal(shell.envelope.length,19.8);
const generated=E.components(shell.envelope).map(({surface,...c})=>c);assert.deepEqual(generated,old.components);
assert.equal(E.fromLegacy({...old,components:old.components.slice(1)}),null);
const scale={x:2,y:1.5,z:.5};const scaled=E.fromLegacy({...old,scale});assert(scaled);
E.components(scaled.envelope).forEach((c,i)=>{for(const [d,a]of [['width','x'],['height','y'],['depth','z']])assert(Math.abs(c[d]-old.components[i][d]*scale[a])<1e-8);});
const s=shell.envelope.surfaces.north;s.mode='texture';s.image='/uploads/room-surfaces/'+'a'.repeat(64)+'.webp';assert(E.valid(shell.envelope));
s.image='https://example.com/image.webp';assert(!E.valid(shell.envelope));s.mode='color';s.image=null;
const outside={kind:'seat',type:'seat',name:'Seat',collision:false,position:{x:0,y:0,z:0},seats:[{object_id:null,label:'1',sort_order:1,enabled:true,map_x:0,map_y:0,coordinate_space:'rigid',local_position:{x:30,y:1,z:0},local_rotation:{x:0,y:0,z:0}}]};
assert(publicationErrors([shell,outside],'check-room').some(e=>e.includes('пределами')));
const inside=structuredClone(outside);inside.seats[0].local_position.x=0;assert.deepEqual(publicationErrors([shell,inside],'check-room'),[]);
console.log('Room envelope: legacy geometry and scaled bounds preserved, safe surface paths, inside/outside seat validation: OK');
