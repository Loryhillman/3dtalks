const assert = require('node:assert/strict');
const fs = require('node:fs');
const { glb, mutate } = require('./avatar-test-fixtures');
const { inspectGlb } = require('../src/services/avatarValidation');
const rig = require('../public/js/avatarRig');

const names = ['Root', 'Hips_01', 'Head_06', 'Upper_Leg_L_063',
  'Lower_Leg_L_064', 'Foot_L_065', 'Upper_Leg_R_067', 'Lower_Leg_R_068', 'Foot_R_069'];
const multi = mutate(glb('body'), json => {
  names.forEach((name, i) => { json.nodes[i].name = name; });
  json.skins = [{ joints: [1, 3, 4, 5, 6, 7, 8] }, { joints: [2] }, { joints: [1, 2] }];
  json.nodes.push({ mesh: 0, skin: 1 }, { mesh: 0, skin: 2 });
  json.nodes[0].children.push(10, 11);
});
const result = inspectGlb(multi, 'body');
assert.equal(result.boneMap.head, 'Head_06');
assert.equal(result.boneMap.leftUpLeg, 'Upper_Leg_L_063');
assert.equal(result.triangles, 3);
assert.equal(rig.normalize('Armature|mixamorig:LeftUpLeg'), 'leftupleg');
assert.equal(rig.normalize('Rig:Upper_Arm_L_027'), 'upperarml');
assert.equal(rig.normalize('Spine1'), 'spine1');
for (const change of [
  json => { json.skins[0].joints.push(500); },
  json => { json.skins[0].joints.push(1); },
  json => { json.nodes[9].skin = 10; },
  json => { json.nodes[12] = { name: 'OtherRig' }; json.nodes[0].children.push(12); json.skins[1].joints.push(12); },
  json => { json.nodes[12] = { name: 'Rig:Hips_02' }; json.nodes[1].children.push(12); json.skins[1].joints.push(12); },
  json => { json.nodes[3].children = []; json.nodes[0].children.push(4); },
  json => { delete json.meshes[0].primitives[0].attributes.WEIGHTS_0; },
  json => { json.skins[0].inverseBindMatrices = 0; },
  json => { json.accessors[1].componentType = 5126; },
]) assert.throws(() => inspectGlb(mutate(multi, change), 'body'), /UNSUPPORTED_RIG/);
assert.throws(() => inspectGlb(glb(), 'body'), /UNSUPPORTED_RIG/);
assert.equal(inspectGlb(glb('body'), 'body').boneMap.hips, 'mixamorig:Hips');
if (process.argv[2]) {
  const actual = inspectGlb(fs.readFileSync(process.argv[2]), 'body');
  console.log('Actual GLB:', actual);
}
console.log('Avatar rig: namespaces, exporter IDs, shared skeleton subsets, ambiguity and invalid rigs OK');
