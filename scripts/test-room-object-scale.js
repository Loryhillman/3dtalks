const assert=require('node:assert/strict');
const {apply}=require('../public/js/roomObjectScale');
const layout=[
  {editor_id:1,kind:'room',type:'room_shell'},
  {editor_id:2,kind:'furniture',position:{x:-2,y:0,z:4},rotation:{x:0,y:.7,z:0},scale:{x:1,y:2,z:3},seats:[{local_position:{x:0,y:1,z:0},coordinate_space:'rigid'}]},
  {editor_id:3,kind:'furniture',position:{x:2,y:0,z:4},scale:{x:2,y:1,z:1}},
  {editor_id:4,kind:'seat',type:'seat',seats:[{local_position:{x:1,y:1,z:1}}]}
];
const snapshot=JSON.stringify(layout);
const next=apply(layout,[2,3],.5);
assert.deepEqual(next[1].position,{x:-1,y:0,z:4});
assert.deepEqual(next[2].position,{x:1,y:0,z:4});
assert.deepEqual(next[1].scale,{x:.5,y:1,z:1.5});
assert.deepEqual(next[1].rotation,layout[1].rotation);
assert.deepEqual(next[1].seats,layout[1].seats);
assert.equal(next[3],layout[3]);assert.equal(next[0],layout[0]);
assert.deepEqual(apply(next,[2,3],2),layout,'inverse scaling restores sizes and relative positions');
for(const [ids,factor]of [[[2],2],[[1,2],2],[[2,4],2],[[2,99],2],[[2,3],0],[[2,3],NaN],[[2,3],100],[[2,3],.001]])assert.throws(()=>apply(layout,ids,factor));
const nearLimit=structuredClone(layout);nearLimit[1].position.x=9999;nearLimit[2].position.x=10000;
assert.throws(()=>apply(nearLimit,[2,3],4),/groupScaleRange/);
assert.equal(JSON.stringify(layout),snapshot,'success and failure never mutate the source');
console.log('Group scaling: relative spacing, nonuniform proportions, bounds, atomic failure and unchanged seat offsets OK');
