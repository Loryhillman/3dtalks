const assert=require('node:assert/strict');
const {glb,mutate}=require('./avatar-test-fixtures');
const {inspectGlb,normalizeConfig}=require('../src/services/avatarValidation');
const {createUserAvatarService,DEFAULT}=require('../src/services/userAvatars');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),Module=require('node:module');
let db,server;
(async()=>{
  assert.equal(inspectGlb(glb(),'head').triangles,1);
  assert.equal(inspectGlb(glb('body'),'body').boneMap.head,'mixamorig:Head');
  assert.throws(()=>inspectGlb(glb(),'body'),/UNSUPPORTED_RIG/);
  assert.throws(()=>inspectGlb(glb('body'),'head'),/HEAD_MUST_BE_STATIC/);
  for(const [fn,code] of [
    [j=>j.buffers[0].uri='https://example.org/model.bin','INVALID_GLB'],
    [j=>j.nodes[0].children=[0],'INVALID_GLB'],
    [j=>j.extensionsRequired=['KHR_draco_mesh_compression'],'UNSUPPORTED_GLB'],
    [j=>j.accessors[0].count=1000000,'MODEL_TOO_COMPLEX'],
    [j=>j.images=[{uri:'https://example.org/image.png'}],'UNSUPPORTED_GLB']
  ])assert.throws(()=>inspectGlb(mutate(glb(),fn),'head'),new RegExp(code));
  assert.throws(()=>normalizeConfig({...DEFAULT,headScale:NaN}),/INVALID_CONFIG/);
  assert.throws(()=>normalizeConfig({...DEFAULT,headOffset:100}),/INVALID_CONFIG/);
  const {PGlite}=require(process.env.PGLITE_TEST_MODULE||'/tmp/3dtalks-schema-check/node_modules/@electric-sql/pglite');db=new PGlite();
  await db.exec('CREATE TABLE users(id UUID PRIMARY KEY);');
  const migration=await fs.readFile(path.join(__dirname,'../database/migrations/add_user_avatars.sql'),'utf8');await db.exec(migration);await db.exec(migration);
  const pool={query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})};
  const service=createUserAvatarService(pool),a=randomUUID(),b=randomUUID();await db.query('INSERT INTO users(id) VALUES($1),($2)',[a,b]);
  assert.deepEqual((await service.get(a)).config,DEFAULT);
  const asset={id:randomUUID(),kind:'head',path:'/uploads/user-avatars/test.glb',byte_size:100,metadata:{}};
  await service.addAsset(a,asset);
  await assert.rejects(service.save(b,{revision:0,config:{...DEFAULT,headType:'model',headAssetId:asset.id}}),/ASSET_NOT_FOUND/);
  await service.save(a,{revision:0,config:{...DEFAULT,headType:'model',headAssetId:asset.id}});
  await assert.rejects(service.save(a,{revision:0,config:DEFAULT}),/REVISION_CONFLICT/);
  await assert.rejects(service.removeAsset(a,asset.id),/ASSET_IN_USE/);
  await service.save(a,{revision:1,config:DEFAULT});await service.removeAsset(a,asset.id);
  // Real multipart upload, JWT middleware, validation and PostgreSQL-compatible SQL.
  const original=Module._load;
  const sharpModule=process.env.SHARP_TEST_MODULE||'/tmp/3dtalks-schema-check/node_modules/sharp';
  Module._load=function(name,parent,...rest){if(name==='../websocket/wsServer')return {getPlayerPositions:()=>new Map()};if(name==='../database/db')return {pool,query:pool.query};if(name==='sharp')return original(sharpModule,parent,...rest);return original(name,parent,...rest);};
  const router=require('../src/routes/userAvatar');Module._load=original;
  // The upload handler resolves sharp lazily.
  Module._load=function(name,parent,...rest){if(name==='../websocket/wsServer')return {getPlayerPositions:()=>new Map()};if(name==='sharp')return original(sharpModule,parent,...rest);return original(name,parent,...rest);};
  const express=require('express'),jwt=require('jsonwebtoken');process.env.JWT_SECRET='avatar-test-secret';
  const app=express();app.use(express.json());app.use('/api/my/avatar',router);server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/api/my/avatar';
  const headers={Authorization:'Bearer '+jwt.sign({userId:a},process.env.JWT_SECRET)};
  assert.equal((await fetch(base)).status,401);
  const upload=async(kind,buffer,name)=>{const data=new FormData();data.append('file',new Blob([buffer]),name);return fetch(base+'/assets/'+kind,{method:'POST',headers,body:data});};
  const before=new Set(await fs.readdir(path.join(__dirname,'../public/uploads/user-avatars')).catch(()=>[]));
  let response=await upload('head',glb(),'head.glb');assert.equal(response.status,201);const uploaded=(await response.json()).asset;
  const sharp=require(sharpModule),png=await sharp({create:{width:20,height:40,channels:3,background:'#ff0000'}}).png().toBuffer();
  response=await upload('image',png,'photo.png');assert.equal(response.status,201);const image=(await response.json()).asset;assert.equal(image.metadata.width,1024);
  response=await upload('body',glb('body'),'body.glb');assert.equal(response.status,201);const body=(await response.json()).asset;
  response=await upload('body',glb(),'bad.glb');assert.equal(response.status,400);assert.equal((await response.json()).errorKey,'avatar.UNSUPPORTED_RIG');
  response=await upload('image',Buffer.from('not an image'),'bad.png');assert.equal(response.status,400);
  response=await upload('head',glb(),'bad.obj');assert.equal(response.status,400);
  response=await fetch(base,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({revision:2,config:{mode:'full',bodyAssetId:body.id}})});assert.equal(response.status,200);
  assert.equal((await response.json()).config.asset.boneMap.hips,'mixamorig:Hips');
  response=await fetch(base+'/assets/'+body.id,{method:'DELETE',headers});assert.equal(response.status,409);
  await service.save(a,{revision:3,config:DEFAULT});
  for(const id of [uploaded.id,image.id,body.id])assert.equal((await fetch(base+'/assets/'+id,{method:'DELETE',headers})).status,200);
  const after=new Set(await fs.readdir(path.join(__dirname,'../public/uploads/user-avatars')));assert.deepEqual(after,before,'failed uploads and deleted files leave no residue');
  for(let i=0;i<12;i++)await service.addAsset(a,{...asset,id:randomUUID(),path:'/uploads/user-avatars/'+i+'.glb'});
  await assert.rejects(service.addAsset(a,{...asset,id:randomUUID()}),/ASSET_QUOTA/);
  Module._load=original;
  console.log('Avatar: GLB/rig validation, idempotent schema, ownership, revisions, quotas, real image/GLB uploads and cleanup OK');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await db?.close();});
