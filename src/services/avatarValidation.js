const rig = require('../../public/js/avatarRig');
const LIMITS = { image:8*1024*1024, head:20*1024*1024, body:40*1024*1024 };
function fail(code, status=400) { throw Object.assign(new Error(code), {code,status}); }
// Accept self-contained GLB 2.0 only. No external fetches, unsupported compression,
// alternate scenes, or animation retargeting in the first avatar implementation.
function inspectGlbData(buffer, kind) {
  if (!['head','body'].includes(kind) || buffer.length > LIMITS[kind]) fail('FILE_TOO_LARGE');
  if (buffer.length < 20 || buffer.readUInt32LE(0)!==0x46546c67 || buffer.readUInt32LE(4)!==2 || buffer.readUInt32LE(8)!==buffer.length) fail('INVALID_GLB');
  let json, binaryBytes=0, offset=12, chunks=0;
  while (offset < buffer.length) {
    if (offset+8>buffer.length) fail('INVALID_GLB');
    chunks++;
    const size=buffer.readUInt32LE(offset), type=buffer.readUInt32LE(offset+4); offset+=8;
    if (size%4 || offset+size>buffer.length) fail('INVALID_GLB');
    if (type===0x4e4f534a) {
      if(json || offset!==20 || size>4*1024*1024) fail('INVALID_GLB');
      try {json=JSON.parse(buffer.subarray(offset,offset+size).toString('utf8'));} catch (_) {fail('INVALID_GLB');}
    } else if(type===0x004e4942) binaryBytes+=size;
    else fail('INVALID_GLB');
    offset+=size;
  }
  if (chunks!==2 || !json || json.asset?.version!=='2.0' || !binaryBytes || json.buffers?.length!==1 || json.buffers[0].uri || json.buffers[0].byteLength>binaryBytes) fail('INVALID_GLB');
  if ((json.extensionsRequired || []).length || (json.extensionsUsed || []).some(x=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(x))) fail('UNSUPPORTED_GLB');
  if ((json.images||[]).length>32 || (json.images||[]).some(x=>x.uri || !['image/png','image/jpeg','image/webp'].includes(x.mimeType))) fail('UNSUPPORTED_GLB');
  const nodes=json.nodes||[], meshes=json.meshes||[];
  if (!nodes.length || !meshes.length || nodes.length>512 || (json.materials||[]).length>64 || (json.scenes||[]).length!==1) fail('MODEL_TOO_COMPLEX');
  const parents=new Map();
  nodes.forEach((n,i)=>{for(const child of n.children||[]) {if(!Number.isInteger(child)||!nodes[child]||parents.has(child)||child===i)fail('INVALID_GLB');parents.set(child,i);}});
  for(let i=0;i<nodes.length;i++){const visited=new Set();for(let p=i;p!==undefined;p=parents.get(p)){if(visited.has(p))fail('INVALID_GLB');visited.add(p);}}
  let triangles=0;
  const meshTris=meshes.map(mesh=> (mesh.primitives||[]).reduce((sum,p)=>{
    const accessor=json.accessors?.[p.indices??p.attributes?.POSITION];
    if(!accessor || !Number.isInteger(accessor.count) || accessor.count<1 || (p.mode!==undefined && p.mode!==4))fail('UNSUPPORTED_GLB');
    return sum+Math.ceil(accessor.count/3);
  },0));
  nodes.forEach(n=>{if(n.mesh!==undefined){if(meshTris[n.mesh]===undefined)fail('INVALID_GLB');triangles+=meshTris[n.mesh];}});
  if (!triangles || triangles>(kind==='head'?30000:100000)) fail('MODEL_TOO_COMPLEX');
  const joints=new Set((json.skins||[]).flatMap(s=>s.joints||[])), mapped=rig.mapNodes(nodes,joints);
  const descendant=(child,parent)=> {if(child===undefined||parent===undefined)return false;for(let p=parents.get(child);p!==undefined;p=parents.get(p))if(p===parent)return true;return false;};
  if(kind==='head' && (json.skins||[]).length)fail('HEAD_MUST_BE_STATIC');
  if(kind==='body') {
    const valid=['left','right'].every(side=>descendant(mapped[side+'UpLeg'],mapped.hips)&&descendant(mapped[side+'Leg'],mapped[side+'UpLeg'])&&descendant(mapped[side+'Foot'],mapped[side+'Leg']))&&descendant(mapped.head,mapped.hips);
    const skinned=nodes.some(n=>n.skin!==undefined && n.mesh!==undefined);
    if(!valid || !skinned || (json.skins||[]).length!==1)fail('UNSUPPORTED_RIG');
    if(Object.values(mapped).some(i=>nodes.filter(n=>n.name===nodes[i].name).length!==1))fail('UNSUPPORTED_RIG');
  }
  for (const view of json.bufferViews||[]) {
    if(view.buffer!==0 || !Number.isInteger(view.byteLength) || view.byteLength<0 || (view.byteOffset||0)<0 || (view.byteOffset||0)+view.byteLength>json.buffers[0].byteLength)fail('INVALID_GLB');
  }
  const componentBytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};
  const dimensions={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
  for(const accessor of json.accessors||[]){
    const view=json.bufferViews?.[accessor.bufferView],elementSize=componentBytes[accessor.componentType]*dimensions[accessor.type];
    if(!view||!elementSize||!Number.isInteger(accessor.count)||accessor.count<1||accessor.sparse)fail('UNSUPPORTED_GLB');
    const stride=view.byteStride||elementSize,offset=accessor.byteOffset||0;
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(stride)||stride<elementSize||offset+(accessor.count-1)*stride+elementSize>view.byteLength)fail('INVALID_GLB');
  }
  const reachable=new Set();
  function visit(i){if(!Number.isInteger(i)||!nodes[i])fail('INVALID_GLB');if(reachable.has(i))fail('INVALID_GLB');reachable.add(i);for(const child of nodes[i].children||[])visit(child);}
  for(const i of json.scenes[0].nodes||[])visit(i);
  if(![...reachable].some(i=>nodes[i].mesh!==undefined))fail('INVALID_GLB');
  if(kind==='body'&&Object.values(mapped).some(i=>!reachable.has(i)))fail('UNSUPPORTED_RIG');
  return {triangles, boneMap:kind==='body'?Object.fromEntries(Object.entries(mapped).map(([key,i])=>[key,nodes[i].name])):{}};
}
function inspectGlb(buffer,kind) {
  try { return inspectGlbData(buffer,kind); } catch(error) { if(error.status)throw error;fail('INVALID_GLB'); }
}
function normalizeConfig(input) {
  if (!input || !['standard','full'].includes(input.mode)) fail('INVALID_CONFIG');
  const color = value=> {if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))fail('INVALID_CONFIG');return value;};
  const number=(value,min,max,def)=>{if(value===undefined)return def;if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail('INVALID_CONFIG');return value;};
  const id=value=>{if(value==null)return null;if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))fail('INVALID_CONFIG');return value;};
  if(input.mode==='full')return {version:1,mode:'full',bodyAssetId:id(input.bodyAssetId),bodyYaw:number(input.bodyYaw,-180,180,0)};
  if(!['image','sphere','cube','model'].includes(input.headType))fail('INVALID_CONFIG');
  return {version:1,mode:'standard',headType:input.headType,headAssetId:id(input.headAssetId),bodyColor:color(input.bodyColor||'#4a90e2'),headColor:color(input.headColor||'#ffaa99'),headScale:number(input.headScale,.5,1.5,1),headOffset:number(input.headOffset,-.3,.3,0),headYaw:number(input.headYaw,-180,180,0)};
}
module.exports={LIMITS,fail,inspectGlb,normalizeConfig};
