/** Opt-in temporary-schema PostgreSQL gate; never migrates the working schema. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto'),{Pool}=require('pg');
async function main(){
 if(!process.env.ROOM_TEST_DATABASE_URL)throw Error('Set ROOM_TEST_DATABASE_URL to a separate test database');
 const config={connectionString:process.env.ROOM_TEST_DATABASE_URL,statement_timeout:15000},admin=new Pool(config);
 const schema='media_v2_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({...config,options:'-c search_path='+schema+',pg_catalog'});
 const migration=await fs.readFile(path.join(__dirname,'../database/migrations/add_room_media_v2.sql'),'utf8');
 const apply=async()=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query(migration);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}};
 try{
  await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY);CREATE TABLE admin_users(id int PRIMARY KEY);
   CREATE TABLE characters(id uuid PRIMARY KEY);CREATE TABLE geometry_buildings(id serial PRIMARY KEY,user_id integer NOT NULL);
   CREATE TABLE world_objects(id serial PRIMARY KEY,type text,position_x float,position_z float,created_at timestamptz);`);
  for(const name of ['add_rooms.sql','add_room_rejoin_grants.sql','add_room_seats.sql','add_user_rooms.sql','add_room_media.sql','add_room_presentation.sql'])await pool.query(await fs.readFile(path.join(__dirname,'../database/migrations',name),'utf8'));
  const owner=randomUUID(),room=randomUUID(),pdf=randomUUID(),image=randomUUID(),video=randomUUID();
  await pool.query('INSERT INTO users VALUES($1)',[owner]);
  await pool.query("INSERT INTO rooms(id,slug,name,owner_user_id) VALUES($1::uuid,$1::text,'Fixture',$2)",[room,owner]);
  async function insert(id,kind,state='ready'){
   await pool.query(`INSERT INTO room_media_assets(id,room_id,owner_user_id,request_id,kind,display_name,declared_bytes,reserved_bytes,storage_key,state,byte_size,page_count,mime,checksum,lease_until)
    VALUES($1,$2,$3,$4,$5,'Fixture',10,10,$6,$7,10,$8,$9,$10,now())`,[id,room,owner,randomUUID(),kind,randomUUID(),state,kind==='pdf'?2:1,kind==='pdf'?'application/pdf':'image/webp','0'.repeat(64)]);
  }
  await insert(pdf,'pdf');await insert(image,'image');await insert(randomUUID(),'pdf','failed');
  await pool.query('INSERT INTO room_presentation_state(room_id,asset_id,page_index,revision) VALUES($1,$2,1,9)',[room,pdf]);
  const request=randomUUID();await pool.query("INSERT INTO room_presentation_requests(room_id,epoch,request_id,signature,result) SELECT room_id,epoch,$2,'preserved','{}'::jsonb FROM room_presentation_state WHERE room_id=$1",[room,request]);
  const oldAssets=(await pool.query('SELECT to_jsonb(a) row FROM room_media_assets a ORDER BY id')).rows;
  const oldState=(await pool.query('SELECT to_jsonb(s) row FROM room_presentation_state s')).rows;
  const oldRequests=(await pool.query('SELECT * FROM room_presentation_requests')).rows;
  const oldRooms=(await pool.query('SELECT * FROM rooms')).rows;
  await apply();await apply();
  const extra=['source_format','video_duration_ms','video_width','video_height','video_fps','video_codec','video_pixel_format','video_audio_codec'];
  assert.deepEqual((await pool.query('SELECT to_jsonb(a)-$1::text[] row FROM room_media_assets a ORDER BY id',[extra])).rows,oldAssets);
  assert.deepEqual((await pool.query("SELECT to_jsonb(s)-ARRAY['playback_status','playback_position_ms','playback_anchor_at'] row FROM room_presentation_state s")).rows,oldState);
  assert.deepEqual((await pool.query('SELECT * FROM room_presentation_requests')).rows,oldRequests);assert.deepEqual((await pool.query('SELECT * FROM rooms')).rows,oldRooms);
  const invalid=sql=>assert.rejects(pool.query(sql),e=>e.code==='23514');
  await invalid(`UPDATE room_media_assets SET source_format='pptx' WHERE id='${image}'`);
  await invalid(`UPDATE room_media_assets SET video_duration_ms=100 WHERE id='${pdf}'`);
  await pool.query(`INSERT INTO room_media_assets(id,room_id,owner_user_id,request_id,kind,display_name,declared_bytes,reserved_bytes,storage_key,state,lease_until)
   VALUES($1,$2,$3,$4,'video','Fixture.mp4',41943040,83886080,$5,'checking',now())`,[video,room,owner,randomUUID(),randomUUID()]);
  await invalid(`UPDATE room_media_assets SET state='ready',byte_size=10,reserved_bytes=10,checksum=repeat('0',64),mime='video/mp4' WHERE id='${video}'`);
  await pool.query(`UPDATE room_media_assets SET state='ready',byte_size=41943040,reserved_bytes=41943040,checksum=repeat('0',64),mime='video/mp4',video_duration_ms=600000,video_width=1920,video_height=1080,video_fps=30,video_codec='h264',video_pixel_format='yuv420p',video_audio_codec='aac' WHERE id=$1`,[video]);
  for(const patch of ["video_duration_ms=600001","video_width=1921","video_height=1081","video_fps='NaN'","video_fps=30.1","video_codec='hevc'","video_pixel_format='yuv444p'","video_audio_codec='opus'","video_width=NULL","page_count=1","mime='application/pdf'","declared_bytes=41943041","reserved_bytes=83886081","byte_size=41943041,reserved_bytes=41943041"]){await invalid(`UPDATE room_media_assets SET ${patch} WHERE id='${video}'`);}
  await invalid(`UPDATE room_presentation_state SET playback_status='playing' WHERE room_id='${room}'`);
  await invalid(`UPDATE room_presentation_state SET playback_anchor_at=now() WHERE room_id='${room}'`);
  await invalid(`UPDATE room_presentation_state SET playback_position_ms=600001 WHERE room_id='${room}'`);
  await pool.query("UPDATE room_presentation_state SET asset_id=$2,page_index=0,playback_status='playing',playback_position_ms=1000,playback_anchor_at=now() WHERE room_id=$1",[room,video]);
  await invalid(`UPDATE room_presentation_state SET playback_anchor_at='infinity' WHERE room_id='${room}'`);
  await invalid(`UPDATE room_presentation_state SET asset_id=NULL WHERE room_id='${room}'`);
  await pool.query("UPDATE room_presentation_state SET asset_id=NULL,playback_status='paused',playback_position_ms=0,playback_anchor_at=NULL WHERE room_id=$1",[room]);
  await pool.query('UPDATE room_media_assets SET source_format=$2 WHERE id=$1',[pdf,'pptx']);
  const service=require('../src/services/roomMedia').createRoomMediaService(pool,{processor:{available:()=>true,close(){}}});
  try{for(const kind of ['video','pptx'])await assert.rejects(service.reserve(owner,room,{requestId:randomUUID(),kind,name:'Unsupported',bytes:10}),e=>e.code===(kind==='video'?'VIDEO_UNAVAILABLE':'INVALID_UPLOAD'));}finally{await service.close();}
  await apply();
  console.log('PostgreSQL V2: repeated migration preserved V1 assets/rooms/state/receipts; SQL rejected invalid video metadata/ready states/timeline; upload remained fail-closed.');
 }finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
