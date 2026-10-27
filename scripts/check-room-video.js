/** Real PostgreSQL/JWT/Multer/ffprobe/Range/cookie gate in disposable schema/files. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto'),{Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken');
const {video}=require('./room-video-fixtures');
async function main(){
 if(!process.env.ROOM_TEST_DATABASE_URL)throw Error('Set ROOM_TEST_DATABASE_URL to a separate test database');
 const config={connectionString:process.env.ROOM_TEST_DATABASE_URL,statement_timeout:15000},admin=new Pool(config),schema='video_'+randomUUID().replaceAll('-','');
 await admin.query('CREATE SCHEMA '+schema);const pool=new Pool({...config,options:'-c search_path='+schema+',pg_catalog'}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'3dtalks-video-'));
 let service,server,browser,enabled=false,clock=Date.now();
 try{
  await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY);CREATE TABLE admin_users(id int PRIMARY KEY);CREATE TABLE characters(id uuid PRIMARY KEY);CREATE TABLE geometry_buildings(id serial PRIMARY KEY,user_id integer NOT NULL);CREATE TABLE world_objects(id serial PRIMARY KEY,type text,position_x float,position_z float,created_at timestamptz);`);
  for(const name of ['add_rooms.sql','add_room_rejoin_grants.sql','add_room_seats.sql','add_user_rooms.sql','add_room_media.sql','add_room_presentation.sql','add_room_media_v2.sql'])await pool.query(await fs.readFile(path.join(__dirname,'../database/migrations',name),'utf8'));
  const owner=randomUUID(),other=randomUUID(),room=randomUUID(),foreign=randomUUID();
  await pool.query('INSERT INTO users VALUES($1),($2)',[owner,other]);
  for(const [id,user] of [[room,owner],[foreign,other]])await pool.query("INSERT INTO rooms(id,slug,name,owner_user_id,status) VALUES($1::uuid,$1::text,'Fixture',$2,'open')",[id,user]);
  service=require('../src/services/roomMedia').createRoomMediaService(pool,{directory,features:()=>({videoUpload:enabled,videoPlayback:false,pptxImport:false}),videoGrantsOptions:{now:()=>clock}});
  process.env.JWT_SECRET='video-test-only';const tokens={owner:jwt.sign({userId:owner},process.env.JWT_SECRET),other:jwt.sign({userId:other},process.env.JWT_SECRET)};
  const app=express();app.use(express.json());app.use('/api/my/rooms/:id/materials',require('../src/routes/roomMedia').createRoomMediaRouter(service));app.get('/__video-test',(_req,res)=>res.send('<video id="video" playsinline controls preload="metadata"></video>'));
  server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));}),base='http://127.0.0.1:'+server.address().port,prefix='/api/my/rooms/'+room+'/materials';
  const request=(suffix,{actor='owner',body,method='GET',cookie,range}={})=>fetch(base+prefix+suffix,{method,headers:{...(actor?{Authorization:'Bearer '+tokens[actor]}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(range?{Range:range}:{})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});
  const file=video(directory),bytes=await fs.readFile(file),reservation={requestId:randomUUID(),kind:'video',name:'Clip.mp4',bytes:bytes.length};
  assert.equal((await request('/uploads',{method:'POST',body:reservation})).status,503);enabled=true;
  assert.equal((await request('/uploads',{actor:null,method:'POST',body:reservation})).status,401);
  assert.equal((await request('/uploads',{actor:'other',method:'POST',body:reservation})).status,404);
  assert.equal((await request('/uploads',{method:'POST',body:{...reservation,bytes:41943041}})).status,413);
  const reserve=await request('/uploads',{method:'POST',body:reservation});assert.equal(reserve.status,201);const id=(await reserve.json()).upload.id;
  assert.equal((await request('/uploads',{method:'POST',body:reservation})).status,200);
  const form=new FormData();form.append('file',new Blob([bytes],{type:'text/plain'}),'misleading.txt');
  const upload=await request('/uploads/'+id+'/file',{method:'POST',body:form});assert.equal(upload.status,200,await upload.clone().text());const asset=(await upload.json()).material;assert.equal(asset.kind,'video');assert.equal(asset.pageCount,null);assert.equal(asset.video.width,160);assert.equal(asset.video.fps,24);
  assert.equal((await (await request('')).json()).materials.some(m=>m.id===id),false,'old library never sees unsupported video');
  assert.equal((await (await request('?protocolVersion=2')).json()).materials.some(m=>m.id===id),true);
  const target='/'+id+'/video',content=target+'/content';
  assert.equal((await request(target+'/grant',{method:'POST',actor:'other',body:{}})).status,404);
  assert.equal((await request(target+'/grant',{method:'POST',actor:null,body:{}})).status,401);
  assert.equal((await request(content,{actor:null})).status,403);
  const grant=await request(target+'/grant',{method:'POST',body:{}});assert.equal(grant.status,200);const setCookie=grant.headers.get('set-cookie'),cookie=setCookie.split(';')[0],token=cookie.slice(cookie.indexOf('=')+1);
  assert(setCookie.includes('HttpOnly')&&setCookie.includes('SameSite=Strict')&&setCookie.includes('Path='+prefix+content));assert(!JSON.stringify(await grant.json()).includes(token));
  let response=await request(content,{actor:null,cookie,method:'HEAD'});assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),String(bytes.length));assert.equal((await response.arrayBuffer()).byteLength,0);
  response=await request(content,{actor:null,cookie});assert.equal(response.status,200);assert(Buffer.from(await response.arrayBuffer()).equals(bytes));
  for(const [range,start,end] of [['bytes=0-15',0,15],['bytes=20-',20,bytes.length-1],['bytes=-10',bytes.length-10,bytes.length-1]]){
   response=await request(content,{actor:null,cookie,range});assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/${bytes.length}`);assert(Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(start,end+1)));
  }
  for(const range of ['bytes=0-1,2-3','bytes='+bytes.length+'-','bytes=-0']){response=await request(content,{actor:null,cookie,range});assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */'+bytes.length);}
  assert.equal((await fetch(base+'/api/my/rooms/'+foreign+'/materials'+content,{headers:{Cookie:cookie}})).status,403);
  assert.equal((await request(content,{actor:null,cookie:cookie+'; '+cookie})).status,403);
  // A native video element uses the HttpOnly cookie, not Authorization headers.
  if(process.env.ROOM_VIDEO_BROWSER_CHECK==='1'){
   const {chromium}=require('playwright');let executable=chromium.executablePath();try{await fs.access(executable);}catch(_){for(const name of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(name))executable='/root/.cache/ms-playwright/'+name+'/chrome-linux64/chrome';}
   browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage();await page.goto(base+'/__video-test');
   assert.equal(await page.evaluate(async ({url,token})=>(await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}'})).status,{url:prefix+target+'/grant',token:tokens.owner}),200);
   assert(!(await page.evaluate(()=>document.cookie)).includes('room_video'));
   await page.evaluate(url=>{document.querySelector('video').src=url;},prefix+content);
   await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
   const meta=await page.evaluate(()=>{const v=document.querySelector('video');return {width:v.videoWidth,height:v.videoHeight,duration:v.duration};});assert.equal(meta.width,160);assert.equal(meta.height,90);assert(meta.duration>=2&&meta.duration<2.1);
   await page.evaluate(()=>document.querySelector('video').play());await page.waitForFunction(()=>document.querySelector('video').currentTime>.2);
   await page.evaluate(()=>{const v=document.querySelector('video');v.pause();v.currentTime=1;});await page.waitForFunction(()=>Math.abs(document.querySelector('video').currentTime-1)<.1);await browser.close();browser=null;
   console.log('Chromium native video: HttpOnly cookie, metadata, H264/AAC decode, playback and seek passed.');
  }
  const active=await service.readVideoGrant(token,room,id);clock+=60001;assert.equal((await request(content,{actor:null,cookie})).status,403);assert(active.signal.aborted);active.release();
  const renewed=await request(target+'/grant',{method:'POST',body:{}});const fresh=renewed.headers.get('set-cookie').split(';')[0],freshToken=fresh.split('=')[1];
  const reader=await service.readVideoGrant(freshToken,room,id);assert.equal((await request('/'+id,{method:'DELETE',body:{}})).status,200);assert(reader.signal.aborted);
  await service.cleanup();assert((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[id])).rows[0].reserved_bytes>0);reader.release();
  assert.equal((await request(content,{actor:null,cookie:fresh})).status,403);
  await pool.query('UPDATE room_media_assets SET lease_until=now() WHERE id=$1',[id]);await service.cleanup();assert.equal(Number((await pool.query('SELECT reserved_bytes FROM room_media_assets WHERE id=$1',[id])).rows[0].reserved_bytes),0);
  // Invalid real codec never becomes ready and releases charge after cleanup.
  const bad=await fs.readFile(video(directory,{codec:'mpeg4'}));const badReserve=await request('/uploads',{method:'POST',body:{...reservation,requestId:randomUUID(),bytes:bad.length}});const badId=(await badReserve.json()).upload.id;const badForm=new FormData();badForm.append('file',new Blob([bad]),'looks-valid.mp4');const invalid=await request('/uploads/'+badId+'/file',{method:'POST',body:badForm});assert.equal(invalid.status,422);assert.equal((await invalid.json()).code,'UNSUPPORTED_VIDEO');
  const disabled=await request('/uploads',{method:'POST',body:{...reservation,requestId:randomUUID()}});const disabledId=(await disabled.json()).upload.id;enabled=false;
  const disabledForm=new FormData();disabledForm.append('file',new Blob([bytes]),'Clip.mp4');
  assert.equal((await request('/uploads/'+disabledId+'/file',{method:'POST',body:disabledForm})).status,503);
  await request('/uploads/'+disabledId,{method:'DELETE'});
  enabled=false;assert.equal((await request(target+'/grant',{method:'POST',body:{}})).status,503);
  console.log('Video PostgreSQL/HTTP passed: upload gate, real multipart/probe, replay/ownership/quota, private cookie/HEAD/Range/full bytes, scope/expiry/revocation, reader-held quota and invalid-codec cleanup.');
 }finally{await browser?.close();service?.close();if(server)await new Promise(r=>server.close(r));await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();await fs.rm(directory,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
