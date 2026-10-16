/** Canonical init.sql + production startup twice in a throwaway database, never public/models. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto'),{Pool}=require('pg'),{spawn}=require('node:child_process');
async function child(){
 const directory=process.env.ROOM_STARTUP_TEST_DIRECTORY;
 const builtin=require('../src/services/roomBuiltinBundle'),install=builtin.ensureBuiltinMeeting;
 builtin.ensureBuiltinMeeting=pool=>install(pool,{publicDir:directory});
 const db=require('../src/database/db');
 try{
  await db.initializeDatabase();
  const before=(await db.pool.query('SELECT * FROM room_templates ORDER BY version')).rows;
  assert.equal(before.length,4);assert.equal(before[3].layout.length,9);
  assert.deepEqual((await db.pool.query('SELECT bundle_key FROM room_builtin_bundles')).rows,[{bundle_key:'meeting-six-v2'}]);
  const realPublic=path.resolve(__dirname,'../public');
  const stat=absolute=>fs.stat(path.join(directory,path.relative(realPublic,absolute)));
  const rooms=require('../src/services/userRooms').createUserRoomService(db.pool,(id,pool)=>require('../src/services/roomValidation').validateRoom(id,pool,stat));
  const owner=randomUUID(),other=randomUUID();
  for(const id of [owner,other])await db.pool.query('INSERT INTO users(id,username,email,password_hash) VALUES($1,$2,$3,$4)',[id,id,id+'@fixture.invalid','fixture-unused']);
  const first=(await rooms.create(owner,{name:'First default',capacity:6,request_key:randomUUID()})).room;
  const snapshot=(await db.pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id',[first.id])).rows;
  assert.equal(snapshot.length,9);assert.equal(snapshot.filter(i=>i.type==='presentation_screen').length,1);
  await db.initializeDatabase();
  assert.deepEqual((await db.pool.query('SELECT * FROM room_templates ORDER BY version')).rows,before);
  assert.deepEqual((await db.pool.query('SELECT * FROM world_objects WHERE room_id=$1 ORDER BY id',[first.id])).rows,snapshot);
  const second=(await rooms.create(other,{name:'Other account',capacity:6,request_key:randomUUID()})).room;
  for(const room of [first,second])assert.equal((await db.pool.query('SELECT count(*)::int n FROM room_seats WHERE room_id=$1',[room.id])).rows[0].n,6);
  assert.notEqual(first.id,second.id);assert.equal((await db.pool.query('SELECT count(*)::int n FROM uploaded_models')).rows[0].n,3);
  assert.equal((await fs.readdir(path.join(directory,'models/uploaded'))).length,3);
  console.log('Canonical startup: all migrations twice, v2 default, model reuse, two accounts/rooms and preserved first snapshot OK');
 }finally{await db.pool.end();}
}
async function main(){
 if(!process.env.ROOM_TEST_DATABASE_URL)throw Error('Set ROOM_TEST_DATABASE_URL to a separate test cluster (CREATE DATABASE required)');
 const url=new URL(process.env.ROOM_TEST_DATABASE_URL),admin=new Pool({connectionString:url.href});
 const name='room_startup_test_'+randomUUID().replaceAll('-',''),directory=await fs.mkdtemp(path.join(os.tmpdir(),'3dtalks-startup-'));let created=false;
 try{
  await admin.query('CREATE DATABASE '+name);created=true;url.pathname='/'+name;
  const env={...process.env,DB_HOST:url.hostname,DB_PORT:url.port||'5432',DB_NAME:name,DB_USER:decodeURIComponent(url.username),DB_PASSWORD:decodeURIComponent(url.password),
   APP_MODE:'rooms',ROOMS_ENABLED:'true',ADMIN_USERNAME:'startup-fixture',ADMIN_PASSWORD:randomBytes(32).toString('hex'),ROOM_STARTUP_TEST_DIRECTORY:directory};
  await new Promise((resolve,reject)=>{const worker=spawn(process.execPath,[__filename,'--child'],{env,stdio:'inherit',timeout:120000});worker.once('error',reject);worker.once('exit',code=>code===0?resolve():reject(Error('Canonical startup child failed: '+code)));});
 }finally{
  if(created)await admin.query('DROP DATABASE '+name);await admin.end();await fs.rm(directory,{recursive:true,force:true});
 }
}
(process.argv.includes('--child')?child():main()).catch(e=>{console.error(e);process.exitCode=1;});
