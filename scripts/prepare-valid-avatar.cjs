const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
// Offline only: pinned input, explicit new output and isolated authoring dependencies.
const [source,output,dependencyRoot]=process.argv.slice(2);
if(!source||!output||!dependencyRoot)throw Error('Usage: node scripts/prepare-valid-avatar.cjs source.glb new-output.glb /absolute/dependency-root');
const dependencies=createRequire(path.resolve(dependencyRoot,'package.json'));
const {NodeIO}=dependencies('@gltf-transform/core');
const {ALL_EXTENSIONS}=dependencies('@gltf-transform/extensions');
const {dequantize,prune}=dependencies('@gltf-transform/functions');
const sharp=dependencies('sharp'),MeshoptDecoder=dependencies('meshoptimizer/decoder.cjs');
const hash=array=>crypto.createHash('sha256').update(Buffer.from(array.buffer,array.byteOffset,array.byteLength)).digest('hex');
function geometryFingerprint(root){
 return JSON.stringify({meshes:root.listMeshes().map(mesh=>({name:mesh.getName(),primitives:mesh.listPrimitives().map(p=>({
  indices:hash(p.getIndices().getArray()),attributes:p.listSemantics().sort().map(name=>[name,hash(p.getAttribute(name).getArray())]),
  targets:p.listTargets().map(t=>({name:t.getName(),attributes:t.listSemantics().sort().map(name=>[name,hash(t.getAttribute(name).getArray())])}))
 }))})),skins:root.listSkins().map(s=>hash(s.getInverseBindMatrices().getArray()))});
}
(async()=>{
 const bytes=await fs.readFile(source);
 if(crypto.createHash('sha256').update(bytes).digest('hex')!=='6ddf21c0951b4b6c031ef885e6deaaaf9f91b3de339029a64072e86d26b5b14b')throw Error('Wrong source');
 await MeshoptDecoder.ready;
 const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
 const doc=await io.readBinary(bytes),root=doc.getRoot();
 for(const mesh of root.listMeshes()){
  for(const primitive of mesh.listPrimitives()){
   for(const target of primitive.listTargets()){
    if(['h_expressions.MouthOpen_h','h_teeth.t_MouthOpen_h'].includes(target.getName()))target.setName('viseme_aa');
    else primitive.removeTarget(target);
   }
  }
  mesh.setWeights(mesh.listPrimitives()[0].listTargets().map(()=>0));
 }
 for(const node of root.listNodes())if(node.getWeights().length)node.setWeights(node.getMesh()?.listPrimitives()[0].listTargets().map(()=>0)||[]);
 await doc.transform(dequantize(),prune());
 const geometry=geometryFingerprint(root);
 for(const texture of root.listTextures()){
  const original=texture.getImage();
  const image=await sharp(original).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();
  const originalPixels=await sharp(original).ensureAlpha().raw().toBuffer();
  const outputPixels=await sharp(image).ensureAlpha().raw().toBuffer();
  if(!originalPixels.equals(outputPixels))throw Error('Texture pixels changed');
  texture.setImage(image).setMimeType('image/png');
 }
 for(const extension of root.listExtensionsUsed())if(['EXT_meshopt_compression','EXT_texture_webp'].includes(extension.extensionName))extension.dispose();
 for(const accessor of root.listAccessors())accessor.setSparse(false);
 const result=await io.writeBinary(doc);
 if(geometryFingerprint((await io.readBinary(result)).getRoot())!==geometry)throw Error('Export changed geometry, skinning or retained mouth targets');
 const inspection=require('../src/services/avatarValidation').inspectGlb(Buffer.from(result),'body');
 await fs.writeFile(output,result,{flag:'wx'});
 console.log(JSON.stringify({output,bytes:result.length,sha256:crypto.createHash('sha256').update(result).digest('hex')}));
 console.log(inspection);
})().catch(e=>{console.error(e);process.exitCode=1;});
