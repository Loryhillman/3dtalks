/** Real PostgreSQL + Express/JWT/Multer + decoder process, all in temporary storage/schema. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto'),{Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken'),sharp=require('sharp');
const {createRoomMediaService}=require('../src/services/roomMedia');
const {createRoomMediaRouter}=require('../src/routes/roomMedia');
const {pdf}=require('./room-media-fixtures');
async function main(){
 if(!process.env.ROOM_TEST_DATABASE_URL)throw Error('Set ROOM_TEST_DATABASE_URL to a separate test database');
 const config={connectionString:process.env.ROOM_TEST_DATABASE_URL,statement_timeout:15000},admin=new Pool(config);
 const schema='media_test_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({...config,options:'-c search_path='+schema+',pg_catalog'}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'3dtalks-media-'));
 const service=createRoomMediaService(pool,{directory});let server;
 try{
  await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY);CREATE TABLE admin_users(id int PRIMARY KEY);
    CREATE TABLE characters(id uuid PRIMARY KEY);CREATE TABLE geometry_buildings(id serial PRIMARY KEY,user_id integer NOT NULL);
    CREATE TABLE world_objects(id serial PRIMARY KEY,type text,position_x float,position_z float,created_at timestamptz);`);
  for(const name of ['add_rooms.sql','add_room_rejoin_grants.sql','add_room_seats.sql','add_user_rooms.sql','add_room_media.sql','add_room_media.sql','add_room_presentation.sql','add_room_media_v2.sql','add_room_video_portrait.sql','add_room_media_v2.sql','add_room_video_portrait.sql'])
    await pool.query(await fs.readFile(path.join(__dirname,'../database/migrations',name),'utf8'));
  const owner=randomUUID(),other=randomUUID(),room=randomUUID(),room2=randomUUID(),foreign=randomUUID();
  await pool.query('INSERT INTO users VALUES ($1),($2)',[owner,other]);
  for(const [id,user] of [[room,owner],[room2,owner],[foreign,other]])await pool.query('INSERT INTO rooms(id,slug,name,owner_user_id) VALUES($1,$2,$3,$4)',[id,id,'Fixture',user]);
  const app=express();app.use(express.json());process.env.JWT_SECRET='room-media-test-only';
  app.use('/api/my/rooms/:id/materials',createRoomMediaRouter(service,undefined,{idleMs:250,uploadMs:700}));
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});const base='http://127.0.0.1:'+server.address().port;
  const tokens={owner:jwt.sign({userId:owner},process.env.JWT_SECRET),other:jwt.sign({userId:other},process.env.JWT_SECRET),admin:jwt.sign({adminId:1},process.env.JWT_SECRET)};
  const request=async(suffix='',{actor='owner',method='GET',body,roomId=room,raw=false}={})=>{
    const headers=actor?{Authorization:'Bearer '+tokens[actor]}:{};
    if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
    const response=await fetch(base+'/api/my/rooms/'+roomId+'/materials'+suffix,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    if(raw)return response;return {status:response.status,...await response.json()};
  };
  const reserve=(bytes,extra={})=>request('/uploads',{method:'POST',body:{requestId:randomUUID(),kind:'pdf',name:'Fixture.pdf',bytes,...extra}});
  const upload=(id,buffer)=>{const form=new FormData();form.append('file',new Blob([buffer],{type:'text/plain'}),'not-trusted.txt');return request('/uploads/'+id+'/file',{method:'POST',body:form});};
  const expire=()=>pool.query("UPDATE room_media_assets SET lease_until=now()-interval '1 second' WHERE state<>'ready'");
  assert.equal((await request('',{actor:null})).status,401);assert.equal((await request('',{actor:'admin'})).status,401);assert.equal((await request('',{actor:'other'})).status,404);
  const body={requestId:randomUUID(),kind:'pdf',name:'Fixture.pdf',bytes:pdf().length};
  const racing=await Promise.all([request('/uploads',{method:'POST',body}),request('/uploads',{method:'POST',body})]);
  assert.deepEqual(racing.map(r=>r.status).sort(),[200,201]);const id=racing[0].upload.id;assert.equal(racing[1].upload.id,id);
  assert.equal((await request('/uploads',{method:'POST',roomId:room.toUpperCase(),body})).upload.id,id);
  assert.equal((await request('/uploads',{method:'POST',body:{...body,name:'changed'}})).code,'REQUEST_ID_REUSED');
  assert.equal((await request('/uploads',{method:'POST',roomId:room2,body:{...body,requestId:randomUUID()}})).code,'UPLOAD_BUSY');
  const ready=await upload(id,pdf());assert.equal(ready.status,200,JSON.stringify(ready));assert.equal(ready.material.pageCount,2);
  assert.equal((await request('/uploads/'+id.toUpperCase(),{roomId:room.toUpperCase()})).upload.id,id);
  assert.equal((await upload(id,pdf())).status,409);
  const statfs=fs.statfs;fs.statfs=async()=>({bavail:0,bsize:4096});
  try{assert.equal((await request('/uploads',{method:'POST',body})).upload.id,id);assert.equal((await reserve(1)).code,'MEDIA_STORAGE_FULL');}
  finally{fs.statfs=statfs;}
  assert.equal((await request('/'+id+'/content',{actor:'other'})).status,404);
  const response=await request('/'+id+'/content',{raw:true});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('content-type'),'application/pdf');assert(Buffer.from(await response.arrayBuffer()).equals(pdf()));
  const stored=(await pool.query('SELECT * FROM room_media_assets WHERE id=$1',[id])).rows[0];
  assert(!JSON.stringify(ready).includes(stored.storage_key));assert.equal(Number(stored.reserved_bytes),pdf().length);
  const file=path.join(directory,stored.storage_key+'.pdf');await fs.rename(file,file+'.backup');await fs.symlink(file+'.backup',file);
  assert.equal((await request('/'+id+'/content')).status,404,'symlinks cannot bypass private file checks');await fs.unlink(file);await fs.rename(file+'.backup',file);
  assert.equal((await fetch(base+'/uploads/room-media/'+stored.storage_key+'.pdf')).status,404);
  let row=await reserve(4);assert.equal((await upload(row.upload.id,Buffer.from('too large'))).status,413);
  await expire();await service.cleanup();assert.equal((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[row.upload.id])).rows[0].reserved_bytes,'0');
  row=await reserve(4);assert.equal((await upload(row.upload.id,Buffer.from('bad!'))).code,'INVALID_PDF');await expire();await service.cleanup();
  row=await reserve(1000);
  const http=require('node:http');let endTransfer;
  const closed=new Promise(resolve=>endTransfer=resolve);
  const socket=http.request(base+'/api/my/rooms/'+room+'/materials/uploads/'+row.upload.id+'/file',{
    method:'POST',headers:{Authorization:'Bearer '+tokens.owner,'Content-Type':'multipart/form-data; boundary=fixture-boundary'}
  },res=>{res.resume();res.on('end',endTransfer);});socket.on('error',endTransfer);socket.on('close',endTransfer);
  socket.write('--fixture-boundary\r\nContent-Disposition: form-data; name="file"; filename="slow.pdf"\r\nContent-Type: application/pdf\r\n\r\n%');
  for(let n=0;n<100;n++){if((await service.get(owner,room,row.upload.id)).state==='uploading')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal((await request('/uploads/'+row.upload.id,{method:'DELETE'})).upload.state,'cancelled');
  await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Transfer did not abort')),2000).unref())]);
  for(let n=0;n<100;n++){const a=(await pool.query('SELECT lease_until FROM room_media_assets WHERE id=$1',[row.upload.id])).rows[0];if(a.lease_until<=new Date())break;await new Promise(r=>setTimeout(r,10));}
  await expire();await service.cleanup();
  for(const trickle of [false,true]){
    row=await reserve(1000);let done;
    const ended=new Promise(resolve=>done=resolve);
    const stream=http.request(base+'/api/my/rooms/'+room+'/materials/uploads/'+row.upload.id+'/file',{
      method:'POST',headers:{Authorization:'Bearer '+tokens.owner,'Content-Type':'multipart/form-data; boundary=fixture-boundary'}
    },res=>{res.resume();res.on('end',done);});stream.on('error',done);stream.on('close',done);
    stream.write('--fixture-boundary\r\nContent-Disposition: form-data; name="file"; filename="timeout.pdf"\r\n\r\n%');
    const timer=trickle?setInterval(()=>stream.write('x'),50):null;
    try{await Promise.race([ended,new Promise((_,reject)=>setTimeout(()=>reject(Error('Upload deadline failed')),2000).unref())]);}
    finally{if(timer)clearInterval(timer);stream.destroy();}
    await new Promise(r=>setTimeout(r,30));await expire();await service.cleanup();
    assert.equal(Number((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[row.upload.id])).rows[0].reserved_bytes),0);
  }
  const encrypted=await fs.readFile(path.join(__dirname,'fixtures/room-encrypted.pdf'));row=await reserve(encrypted.length);assert.equal((await upload(row.upload.id,encrypted)).code,'ENCRYPTED_PDF');await expire();await service.cleanup();
  const image=await sharp({create:{width:40,height:30,channels:3,background:'#00ff00'}}).png().toBuffer();
  row=await reserve(image.length,{kind:'image',name:'Misleading.pdf'});const imageReady=await upload(row.upload.id,image);assert.equal(imageReady.status,200,JSON.stringify(imageReady));
  const img=await request('/'+row.upload.id+'/content',{raw:true});assert.equal(img.headers.get('content-type'),'image/webp');assert.equal((await sharp(Buffer.from(await img.arrayBuffer())).metadata()).format,'webp');
  const reader=await service.content(owner,room,row.upload.id),fd=await fs.open(reader.path);
  const another=await service.content(owner,room,id);await assert.rejects(service.content(owner,room,id),e=>e.code==='DOWNLOAD_BUSY');another.release();
  await request('/'+row.upload.id,{method:'DELETE'});await service.cleanup();
  assert(Number((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[row.upload.id])).rows[0].reserved_bytes)>0,'open readers keep their disk charge');
  await fd.close();reader.release();await service.cleanup();await assert.rejects(fs.stat(reader.path),{code:'ENOENT'});
  // A process crash after rename but before SQL ready must leave recoverable, charged bytes.
  row=await reserve(pdf().length);const interrupted=await service.begin(owner,room,row.upload.id);
  await fs.writeFile(interrupted.paths.final,pdf());await service.failed(owner,room,row.upload.id,'UPLOAD_FAILED');await expire();await service.cleanup();
  await assert.rejects(fs.stat(interrupted.paths.final),{code:'ENOENT'});
  // Failed unlink must keep the charge and be retried.
  row=await reserve(pdf().length);const blocked=await service.begin(owner,room,row.upload.id);
  await fs.mkdir(blocked.paths.final);await service.failed(owner,room,row.upload.id,'UPLOAD_FAILED');await expire();await service.cleanup();
  assert(Number((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[row.upload.id])).rows[0].reserved_bytes)>0);
  await fs.rmdir(blocked.paths.final);await expire();await service.cleanup();
  // Quota decisions use durable rows, including other rooms and bytes pending removal.
  async function quotaRows(count,bytes,state='ready',user=owner,r=room2){
    const ids=[];
    for(let n=0;n<count;n++){
      const id=randomUUID();ids.push(id);await pool.query(`INSERT INTO room_media_assets
       (id,room_id,owner_user_id,request_id,kind,display_name,declared_bytes,reserved_bytes,storage_key,state,byte_size,page_count,mime,checksum,lease_until)
       VALUES($1,$2,$3,$4,'pdf','Quota fixture',1,$5,$6,$7,$8,1,'application/pdf',$9,now())`,
       [id,r,user,randomUUID(),bytes,randomUUID(),state,bytes||1,'0'.repeat(64)]);
    }return ids;
  }
  let ids=await quotaRows(5,20*1024**2);assert.equal((await reserve(1)).code,'MEDIA_QUOTA_EXCEEDED');await pool.query('DELETE FROM room_media_assets WHERE id=ANY($1::uuid[])',[ids]);
  ids=await quotaRows(20,1);assert.equal((await reserve(1)).code,'MEDIA_QUOTA_EXCEEDED');await pool.query('DELETE FROM room_media_assets WHERE id=ANY($1::uuid[])',[ids]);
  ids=await quotaRows(52,20*1024**2,'ready',other,foreign);assert.equal((await reserve(1)).code,'MEDIA_STORAGE_FULL');await pool.query('DELETE FROM room_media_assets WHERE id=ANY($1::uuid[])',[ids]);
  ids=await quotaRows(60,0,'failed');assert.equal((await reserve(1)).code,'UPLOAD_BUSY');await pool.query('DELETE FROM room_media_assets WHERE id=ANY($1::uuid[])',[ids]);
  // Room deletion marks assets in its SQL transaction; cleanup never reads public/model directories.
  const lifecycle=require('../src/services/userRoomLifecycle').createUserRoomLifecycle(pool,()=>({endRoom:()=>0}));
  const revision=(await pool.query('SELECT revision FROM rooms WHERE id=$1',[room])).rows[0].revision;
  await lifecycle.mutate(owner,room,'delete',{revision});assert.equal((await request('/'+id+'/content')).status,404);
  assert.equal((await pool.query('SELECT state FROM room_media_assets WHERE id=$1',[id])).rows[0].state,'deleting');await service.cleanup();await assert.rejects(fs.stat(file),{code:'ENOENT'});
  console.log('Media PostgreSQL/HTTP: repeat migration, JWT/ownership, reserve races/replay/cross-room slot, multipart/content sniffing, private bytes, quota retention, recovery/unlink retry and room deletion OK');
 }finally{service.close();await new Promise(r=>server?server.close(r):r());await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();await fs.rm(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
