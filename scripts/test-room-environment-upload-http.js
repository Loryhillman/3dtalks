/** Real routing, JWT and multipart upload; only DB, processors and destination are isolated. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const Module=require('node:module'),express=require('express'),jwt=require('jsonwebtoken'),multer=require('multer');
const {officeGlb}=require('./room-environment-fixtures');
const originalLoad=Module._load;
let server,directory,insertions=0,processors=0,dbFailure=false;
process.env.APP_MODE='rooms';process.env.ADMIN_JWT_SECRET='isolated-office-import-test';
const pool={query:async(sql,args)=>{
 if(sql.includes('FROM admin_users'))return {rows:[{id:1,is_active:true}]};
 if(sql.includes('INSERT INTO uploaded_models')){if(dbFailure)throw Error('Fixture DB failed');insertions++;return {rows:[{id:insertions,file_name:args[0],saved_file_name:args[1],path:args[2],file_type:'glb'}]};}
 return {rows:[]};
}};
(async()=>{try{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'3dtalks-office-upload-'));
 Module._load=function(name,parent,...args){
  if(parent?.filename.includes('/src/')&&name==='../database/db')return {pool,...pool};
  if(parent?.filename.endsWith('/routes/uploadedModels.js')){
   if(name==='multer')return Object.assign((...args)=>multer(...args),multer,{diskStorage:options=>multer.diskStorage({...options,destination:directory})});
   const functions={'../services/modelAutoCompress':'compressIfNeeded','../services/textureCompress':'compressTextures','../services/modelDecimate':'decimateIfNeeded','../services/modelLod':'generateLodVariants'};
   if(functions[name])return {[functions[name]]:async()=>{processors++;throw Error('Office must not be processed');}};
  }
  return originalLoad(name,parent,...args);
 };
 const uploads=require('../src/routes/uploadedModels');
 Module._load=originalLoad;
 const app=express();app.use('/api',uploads);
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const url='http://127.0.0.1:'+server.address().port+'/api/admin/rooms/models/upload';
 const token=jwt.sign({type:'admin',adminUserId:1},process.env.ADMIN_JWT_SECRET);
 const file=officeGlb();
 async function send(buffer,profile='room_environment',authorization='Bearer '+token){
  const body=new FormData();body.append('model',new Blob([buffer],{type:'model/gltf-binary'}),'OFFICE.GLB');body.append('profile',profile);
  return fetch(url,{method:'POST',headers:authorization?{Authorization:authorization}:{},body});
 }
 assert.equal((await send(file,'room_environment',null)).status,401);
 assert.equal((await send(file,'room_environment','Bearer '+jwt.sign({userId:1},process.env.ADMIN_JWT_SECRET))).status,403);
 assert.deepEqual(await fs.readdir(directory),[],'authentication runs before storage');
 const response=await send(file);assert.equal(response.status,201);const data=await response.json();
 assert(data.model.saved_file_name.endsWith('.glb'));assert.equal(data.inspection.triangles,96);
 assert((await fs.readFile(path.join(directory,data.model.saved_file_name))).equals(file));
 assert.equal(processors,0,'office import never calls decimation, compression or LOD');assert.equal(insertions,1);
 assert.equal((await send(Buffer.from('invalid'))).status,422);
 assert.equal((await fs.readdir(directory)).length,1,'invalid upload was removed');assert.equal(insertions,1);
 assert.equal((await send(file,'unknown')).status,400);assert.equal((await fs.readdir(directory)).length,1);
 dbFailure=true;
 assert.equal((await send(file)).status,500);assert.equal((await fs.readdir(directory)).length,1,'failed insert removed the uploaded file');
 console.log('Office upload HTTP: real JWT/Multer, upper-case GLB, unchanged source, skipped processors and failure cleanup OK (isolated destination/DB)');
}finally{Module._load=originalLoad;if(server)await new Promise(r=>server.close(r));if(directory)await fs.rm(directory,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
