/** Actual PostgreSQL/JWT/Multer/spool/LibreOffice/PDF worker. Dedicated DB only. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {Pool}=require('pg'),{randomUUID}=require('node:crypto'),jwt=require('jsonwebtoken'),express=require('express');
async function main(){
 if(!process.env.ROOM_TEST_DATABASE_URL||!process.env.ROOM_PPTX_SPOOL)throw Error('Use the isolated PPTX Docker gate');
 const admin=new Pool({connectionString:process.env.ROOM_TEST_DATABASE_URL}),schema='pptx_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({connectionString:process.env.ROOM_TEST_DATABASE_URL,options:'-c search_path='+schema+',pg_catalog'}),dir=await fs.mkdtemp(path.join(os.tmpdir(),'pptx-media-'));
 const importer=require('../src/services/roomPptxImport').createRoomPptxImport();let enabled=false,service,server;
 try{
  for(let n=0;n<100&&!importer.available();n++)await new Promise(r=>setTimeout(r,100));assert(importer.available(),'isolated converter heartbeat');
  await pool.query('CREATE TABLE users(id uuid PRIMARY KEY,room_character_id uuid,avatar_config jsonb);CREATE TABLE admin_users(id int PRIMARY KEY);CREATE TABLE characters(id uuid PRIMARY KEY,user_id uuid,name text,last_position jsonb,last_online timestamptz);CREATE TABLE geometry_buildings(id serial PRIMARY KEY,user_id integer NOT NULL);CREATE TABLE world_objects(id serial PRIMARY KEY,type text,position_x float,position_z float,created_at timestamptz);');
  for(const migration of ['add_rooms.sql','add_room_rejoin_grants.sql','add_room_seats.sql','add_user_rooms.sql','add_room_media.sql','add_room_presentation.sql','add_room_media_v2.sql','add_room_video_portrait.sql'])await pool.query(await fs.readFile(path.join(__dirname,'../database/migrations',migration),'utf8'));
  const owner=randomUUID(),other=randomUUID(),room=randomUUID();for(const id of [owner,other])await pool.query('INSERT INTO users(id) VALUES($1)',[id]);
  await pool.query("INSERT INTO rooms(id,slug,name,owner_user_id,status,seating_mode) VALUES($1,$2,'PPTX fixture',$3,'open','seated')",[room,room,owner]);
  service=require('../src/services/roomMedia').createRoomMediaService(pool,{directory:dir,pptx:importer,features:()=>({videoUpload:false,videoPlayback:false,pptxImport:enabled})});
  process.env.JWT_SECRET='pptx-private-test-only';const token=jwt.sign({userId:owner},process.env.JWT_SECRET),otherToken=jwt.sign({userId:other},process.env.JWT_SECRET);
  const app=express();app.use(express.json());app.use('/api/my/rooms/:id/materials',require('../src/routes/roomMedia').createRoomMediaRouter(service));
  server=require('node:http').createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/my/rooms/'+room+'/materials';
  async function request(suffix='',{method='GET',body,auth=token,raw=false}={}){
   const res=await fetch(base+suffix,{method,headers:{Authorization:'Bearer '+auth,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
   return raw?res:{status:res.status,...await res.json()};
  }
  const fixture=name=>fs.readFile(path.join(__dirname,'fixtures/room-pptx',name+'.pptx'));
  const good=await fixture('valid'),body={requestId:randomUUID(),kind:'pdf',sourceFormat:'pptx',name:'Представление.pptx',bytes:good.length};
  assert.equal((await request('/capabilities')).features.pptxImport,false);
  assert.equal((await request('/uploads',{method:'POST',body})).code,'PPTX_UNAVAILABLE');enabled=true;
  assert.equal((await request('/capabilities')).features.pptxImport,true);
  assert.equal((await request('/uploads',{method:'POST',body:{...body,requestId:randomUUID(),bytes:5*1024**2+1}})).code,'FILE_TOO_LARGE');
  const reserve=await request('/uploads',{method:'POST',body});assert.equal(reserve.status,201,JSON.stringify(reserve));
  const id=reserve.upload.id,row=(await pool.query('SELECT * FROM room_media_assets WHERE id=$1',[id])).rows[0];assert.equal(row.source_format,'pptx');assert.equal(Number(row.reserved_bytes),2*good.length+40*1024**2);
  const post=async(id,bytes)=>{const form=new FormData();form.append('file',new Blob([bytes]),'input.pptx');return request('/uploads/'+id+'/file',{method:'POST',body:form});};
  assert.equal((await request('/uploads/'+id,{auth:otherToken})).status,404);
  const ready=await post(id,good);assert.equal(ready.status,200,JSON.stringify(ready));assert.equal(ready.material.sourceFormat,'pptx');assert.equal(ready.material.kind,'pdf');assert.equal(ready.material.pageCount,2);
  const preview=await request('/'+id+'/content',{raw:true});assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'application/pdf');const pdf=Buffer.from(await preview.arrayBuffer());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),document=await pdfjs.getDocument({data:new Uint8Array(pdf),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWasm:false}).promise;
  try{const text=(await (await document.getPage(1)).getTextContent()).items.map(i=>i.str).join(' ');assert(text.includes('Проверка PPTX'),text);const links=(await (await document.getPage(1)).getAnnotations()).filter(a=>a.subtype==='Link');assert(links.every(a=>!a.url||/^https?:|^mailto:/.test(a.url)),'only inert web/mail URI metadata');}finally{await document.destroy();}
  await fs.writeFile('/tmp/pptx-converted-fixture.pdf',pdf);
  assert.equal((await request('/'+id+'/content',{auth:otherToken,raw:true})).status,404);
  assert.equal((await request('/uploads',{method:'POST',body})).upload.id,id);
  assert.equal((await request('/uploads',{method:'POST',body:{...body,sourceFormat:undefined}})).code,'REQUEST_ID_REUSED');
  const stored=(await pool.query('SELECT * FROM room_media_assets WHERE id=$1',[id])).rows[0];assert.equal(Number(stored.reserved_bytes),pdf.length);assert.equal(stored.source_format,'pptx');
  await assert.rejects(fs.stat(path.join(dir,row.storage_key+'.part')),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(process.env.ROOM_PPTX_SPOOL,row.storage_key)),{code:'ENOENT'});
  for(const [name,code] of [['external','UNSUPPORTED_PPTX'],['macro','UNSUPPORTED_PPTX'],['traversal','INVALID_PPTX'],['bomb','PPTX_LIMIT_EXCEEDED'],['slides-overflow','TOO_MANY_PAGES'],['doctype','UNSUPPORTED_PPTX'],['invalid','INVALID_PPTX']]){
   const bytes=await fixture(name),r=await request('/uploads',{method:'POST',body:{...body,requestId:randomUUID(),name:name+'.pptx',bytes:bytes.length}});assert.equal(r.status,201,JSON.stringify(r));
   const failed=await post(r.upload.id,bytes);assert.equal(failed.code,code,JSON.stringify(failed));
   assert(Number((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[r.upload.id])).rows[0].reserved_bytes)>0);
   await pool.query("UPDATE room_media_assets SET lease_until=now()-interval '1 second' WHERE id=$1",[r.upload.id]);await service.cleanup();
   assert.equal(Number((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[r.upload.id])).rows[0].reserved_bytes),0);
  }
  const cancelled=await request('/uploads',{method:'POST',body:{...body,requestId:randomUUID()}});const posting=post(cancelled.upload.id,good);
  for(let n=0;n<300;n++){const r=(await pool.query('SELECT state FROM room_media_assets WHERE id=$1',[cancelled.upload.id])).rows[0];if(r.state==='checking')break;await new Promise(r=>setTimeout(r,10));if(n===299)throw Error('No checking transition');}
  const cancelRow=(await pool.query('SELECT storage_key FROM room_media_assets WHERE id=$1',[cancelled.upload.id])).rows[0];
  for(let n=0;n<300;n++){const h=JSON.parse(await fs.readFile(path.join(process.env.ROOM_PPTX_SPOOL,'heartbeat.json'),'utf8'));if(h.busy===cancelRow.storage_key)break;await new Promise(r=>setTimeout(r,10));if(n===299)throw Error('Converter did not start cancel fixture');}
  assert.equal((await request('/uploads/'+cancelled.upload.id,{method:'DELETE'})).upload.state,'cancelled');
  assert(Number((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[cancelled.upload.id])).rows[0].reserved_bytes)>0,'cancel does not prematurely release charge');
  const cancelledReply=await posting;assert.equal(cancelledReply.code,'UPLOAD_CANCELLED',JSON.stringify(cancelledReply));
  await pool.query("UPDATE room_media_assets SET lease_until=now()-interval '1 second' WHERE id=$1",[cancelled.upload.id]);await service.cleanup();assert.equal(Number((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[cancelled.upload.id])).rows[0].reserved_bytes),0);
  if(process.env.ROOM_PPTX_STRESS_CHECK==='1')await require('./room-pptx-stress').check({pool,service,server,room,owner,token,assetId:id,directory:dir,schema});
  // Completed PDF remains readable/deletable with PPTX disabled.
  enabled=false;assert.equal((await request('/'+id+'/content',{raw:true})).status,200);assert.equal((await request('/'+id,{method:'DELETE'})).status,200);await service.cleanup();
  console.log('PPTX SQL/JWT/HTTP + isolated LibreOffice: flags, private 2-page PDF, idempotency, source/spool removal, peak quota, malicious OOXML rejection, cancel/ack and disabled-flag PDF deletion passed.');
 }finally{service?.close();if(server)await new Promise(r=>server.close(r));await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();await fs.rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
