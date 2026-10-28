/** Real PostgreSQL, production WS admission/RPC and JWT HTTP; voice alone is stubbed. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto'),{Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken'),WebSocket=require('ws');
const {pdf}=require('./room-media-fixtures');
async function main(){
 if(!process.env.ROOM_TEST_DATABASE_URL)throw Error('Set ROOM_TEST_DATABASE_URL to a separate test database');
 const config={connectionString:process.env.ROOM_TEST_DATABASE_URL,statement_timeout:10000},admin=new Pool(config);
 const schema='presentation_test_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({...config,options:'-c search_path='+schema+',pg_catalog'}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'3dtalks-presentation-'));
 let server,wsServer,presentation,media;const sockets=[];
 try{
  await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY,room_character_id uuid,avatar_config jsonb);
   CREATE TABLE admin_users(id int PRIMARY KEY);CREATE TABLE characters(id uuid PRIMARY KEY,user_id uuid,name text,last_position jsonb,last_online timestamptz);
   CREATE TABLE geometry_buildings(id serial PRIMARY KEY,user_id integer NOT NULL);
   CREATE TABLE world_objects(id serial PRIMARY KEY,type text,position_x float,position_y float,position_z float,created_at timestamptz);`);
  for(const name of ['add_rooms.sql','add_room_rejoin_grants.sql','add_room_seats.sql','add_user_rooms.sql','add_room_media.sql','add_room_presentation.sql','add_room_presentation.sql','add_room_media_v2.sql','add_room_video_portrait.sql','add_room_media_v2.sql','add_room_video_portrait.sql'])
   await pool.query(await fs.readFile(path.join(__dirname,'../database/migrations',name),'utf8'));
  const rooms=[randomUUID(),randomUUID()],users=Array.from({length:7},()=>({id:randomUUID(),character:randomUUID()}));
  for(const u of users){await pool.query('INSERT INTO users VALUES($1,$2,NULL)',[u.id,u.character]);await pool.query('INSERT INTO characters(id,user_id,name) VALUES($1,$2,$3)',[u.character,u.id,'Fixture']);}
  for(const r of rooms){
   await pool.query("INSERT INTO rooms(id,slug,name,owner_user_id,status,seating_mode) VALUES($1::uuid,$1::text,'Fixture',$2,'open','seated')",[r,users[0].id]);
   const object=(await pool.query("INSERT INTO world_objects(room_id,type) VALUES($1,'presentation_screen') RETURNING id",[r])).rows[0].id;
   for(let i=0;i<6;i++)await pool.query('INSERT INTO room_seats(room_id,object_id,label,sort_order) VALUES($1,$2,$3,$4)',[r,object,'Seat '+i,i]);
  }
  process.env.JWT_SECRET='presentation-fixture-only';process.env.APP_MODE='rooms';process.env.ROOMS_ENABLED='true';
  const cache=(name,exports)=>{const filename=require.resolve(name);require.cache[filename]={id:filename,filename,loaded:true,exports};};
  cache('../src/database/db',{pool,query:(...args)=>pool.query(...args)});
  cache('../src/websocket/voiceRelay',{init(){},ensureDefaultConfig(){},handleDisconnect(){}});
  wsServer=require('../src/websocket/wsServer');
  presentation=require('../src/services/roomPresentation').createRoomPresentationService(pool,{identity:wsServer.presentationIdentity,broadcast:wsServer.broadcastToRoom});
  cache('../src/services/roomPresentationRuntime',{service:presentation});
  media=require('../src/services/roomMedia').createRoomMediaService(pool,{directory,presentationChanged:presentation.changed});
  cache('../src/services/roomMediaRuntime',{service:media});
  const app=express();app.use(express.json());
  app.use('/api/my/rooms/:id/materials',require('../src/routes/roomMedia').createRoomMediaRouter(media));
  app.use('/api/rooms/:slug/presentation',require('../src/routes/roomPresentation').createRoomPresentationRouter(presentation,media));
  server=require('node:http').createServer(app);wsServer.setupWebSocketServer(server);
  server.on('upgrade',(req,socket,head)=>wsServer.getWss().handleUpgrade(req,socket,head,ws=>wsServer.getWss().emit('connection',ws,req)));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
  const tokens=users.map(u=>jwt.sign({userId:u.id},process.env.JWT_SECRET));
  const wait=async(fn)=>{for(let i=0;i<500;i++){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out waiting for fixture');};
  async function join(index,room=rooms[0]){
   const ws=new WebSocket(base.replace('http:','ws:'));ws.messages=[];sockets.push(ws);ws.on('message',m=>ws.messages.push(JSON.parse(m)));
   await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
   ws.send(JSON.stringify({type:'PLAYER_JOIN',payload:{roomSlug:room,characterId:users[index].character,token:tokens[index]}}));
   await wait(()=>ws.messages.find(m=>m.type==='ROOM_PRESENTATION_SESSION')||ws.messages.find(m=>m.type==='ROOM_JOIN_DENIED'));
   assert(!ws.messages.find(m=>m.type==='ROOM_JOIN_DENIED'),JSON.stringify(ws.messages));
   ws.session=ws.messages.find(m=>m.type==='ROOM_PRESENTATION_SESSION').payload;
   ws.state=(await wait(()=>ws.messages.find(m=>m.type==='ROOM_PRESENTATION_STATE'))).payload;return ws;
  }
  const owner=await join(0),participants=[];for(let i=1;i<6;i++)participants.push(await join(i));const outsider=await join(6,rooms[1]);
  assert(owner.session.canControl);assert(participants.every(w=>!w.session.canControl));assert.equal(new Set([owner,...participants].map(w=>w.session.token)).size,6);
  const http=async(url,{index=0,session,method='GET',body,raw=false}={})=>{
   const response=await fetch(base+url,{method,headers:{Authorization:'Bearer '+tokens[index],...(session?{'X-Room-Session':session.token}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
   return raw?response:{status:response.status,...await response.json()};
  };
  const materialUrl='/api/my/rooms/'+rooms[0]+'/materials';
  const reserve=await http(materialUrl+'/uploads',{method:'POST',body:{requestId:randomUUID(),kind:'pdf',name:'Fixture.pdf',bytes:pdf().length}});
  assert.equal(reserve.status,201,JSON.stringify(reserve));const upload=await media.begin(users[0].id,rooms[0],reserve.upload.id);
  await fs.writeFile(upload.paths.input,pdf());const asset=await media.complete(users[0].id,rooms[0],upload);
  const body=(state,command)=>({requestId:randomUUID(),expectedEpoch:state.epoch,expectedRevision:state.revision,command});
  const rpc=async(ws,payload)=>{ws.send(JSON.stringify({type:'ROOM_PRESENTATION_COMMAND',payload}));return (await wait(()=>ws.messages.find(m=>m.type==='ROOM_PRESENTATION_RESULT'&&m.payload.requestId===payload.requestId))).payload;};
  let result=await rpc(participants[0],body(owner.state,{type:'show',assetId:asset.id}));assert.equal(result.code,'PRESENTATION_FORBIDDEN');
  let show=body(owner.state,{type:'show',assetId:asset.id});result=await rpc(owner,show);assert(result.success,JSON.stringify(result));let state=result.state;
  const durable=require('../src/services/roomPresentation').createRoomPresentationService(pool,{identity:wsServer.presentationIdentity});
  const ownerConnection=[...wsServer.getPlayerPositions()].find(([,p])=>p.characterId===users[0].character)[0];
  assert.deepEqual((await durable.synchronize(ownerConnection)).state,state,'a new service reads persisted show');
  await assert.rejects(durable.authorizeContent(users[0].id,rooms[0],asset.id,owner.session.token,media),e=>e.code==='PRESENTATION_FORBIDDEN');durable.close();
  await wait(()=>participants.every(w=>w.messages.some(m=>m.type==='ROOM_PRESENTATION_STATE'&&m.payload.revision===state.revision)));
  assert(!outsider.messages.some(m=>m.type==='ROOM_PRESENTATION_STATE'&&m.payload.asset));
  for(const w of [owner,...participants])assert(!JSON.stringify(w.messages.filter(m=>m.type!=='ROOM_PRESENTATION_SESSION')).includes(w.session.token),'private token is never in snapshots/broadcasts');
  const content='/api/rooms/'+rooms[0]+'/presentation/materials/'+asset.id+'/content';
  assert.equal((await http(content,{index:1})).status,403);assert.equal((await http(content,{index:1,session:owner.session})).status,403);
  assert.equal((await http(content,{index:6,session:outsider.session})).status,403);
  const readers=await Promise.all([owner,...participants].map((w,i)=>http(content,{index:i,session:w.session,raw:true})));
  for(const response of readers){assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert(Buffer.from(await response.arrayBuffer()).equals(pdf()));}
  const leases=[];
  try{
   for(let i=0;i<8;i++){const index=i%6,w=[owner,...participants][index];leases.push(await presentation.authorizeContent(users[index].id,rooms[0],asset.id,w.session.token,media));}
   await assert.rejects(presentation.authorizeContent(users[2].id,rooms[0],asset.id,participants[1].session.token,media),e=>e.code==='DOWNLOAD_BUSY');
  }finally{for(const lease of leases)lease.release();}
  const connection=[...wsServer.getPlayerPositions()].find(([,p])=>p.characterId===users[0].character)[0];
  // Direct service concurrency bypasses the process queue to test SQL serialization itself.
  const page=body(state,{type:'page',pageIndex:1}),stop=body(state,{type:'stop'});
  const racing=await Promise.all([presentation.command(connection,page),presentation.command(connection,stop)]);
  assert.equal(racing.filter(r=>r.success).length,1);assert.equal(racing.find(r=>!r.success).code,'PRESENTATION_CHANGED');
  const winner=racing.find(r=>r.success);state=winner.state;
  const replay=await presentation.command(connection,winner.requestId===page.requestId?page:stop);assert(replay.reused);assert.equal(replay.state.revision,state.revision);
  await assert.rejects(presentation.command(connection,{...page,requestId:show.requestId}),e=>e.code==='REQUEST_ID_REUSED');
  assert.equal((await presentation.command(connection,body(state,{type:'show',assetId:randomUUID()}))).code,'MATERIAL_NOT_FOUND');
  const foreign=randomUUID();await pool.query(`INSERT INTO room_media_assets
   (id,room_id,owner_user_id,request_id,kind,display_name,declared_bytes,reserved_bytes,storage_key,state,byte_size,page_count,mime,checksum,lease_until)
   VALUES($1,$2,$3,$4,'image','Foreign',1,1,$5,'ready',1,1,'image/webp',$6,now())`,[foreign,rooms[1],users[0].id,randomUUID(),randomUUID(),'0'.repeat(64)]);
  assert.equal((await presentation.command(connection,body(state,{type:'show',assetId:foreign}))).code,'MATERIAL_NOT_FOUND','even the owner cannot show a different room material');
  const videoId=randomUUID();await pool.query(`INSERT INTO room_media_assets
   (id,room_id,owner_user_id,request_id,kind,display_name,declared_bytes,reserved_bytes,storage_key,state,byte_size,page_count,mime,checksum,lease_until,video_duration_ms,video_width,video_height,video_fps,video_codec,video_pixel_format)
   VALUES($1,$2,$3,$4,'video','Video fixture',1,1,$5,'ready',1,NULL,'video/mp4',$6,now(),1000,160,90,24,'h264','yuv420p')`,[videoId,rooms[0],users[0].id,randomUUID(),randomUUID(),'0'.repeat(64)]);
  assert.equal((await presentation.command(connection,body(state,{type:'show',assetId:videoId}))).code,'MATERIAL_NOT_FOUND','V1 cannot show a prepared video before the playback stage');
  state=(await presentation.command(connection,body(state,{type:'show',assetId:asset.id}))).state;
  assert.equal((await presentation.command(connection,body(state,{type:'page',pageIndex:2}))).code,'INVALID_COMMAND');
  await assert.rejects(presentation.command(connection,{...body(state,{type:'stop'}),roomId:rooms[1]}),e=>e.code==='INVALID_COMMAND');
  const lease=await presentation.authorizeContent(users[1].id,rooms[0],asset.id,participants[0].session.token,media);
  state=(await presentation.command(connection,body(state,{type:'stop'}))).state;assert(lease.signal.aborted);lease.release();
  assert.equal((await http(content,{index:1,session:participants[0].session})).status,403);
  state=(await presentation.command(connection,body(state,{type:'show',assetId:asset.id}))).state;
  const replaced=await join(1);assert.notEqual(replaced.session.token,participants[0].session.token);
  assert.equal((await http(content,{index:1,session:participants[0].session})).status,403);assert.equal(replaced.state.revision,state.revision);
  const activeLease=await presentation.authorizeContent(users[1].id,rooms[0],asset.id,replaced.session.token,media);
  replaced.close();await wait(()=>activeLease.signal.aborted);activeLease.release();
  const lifecycle=require('../src/services/userRoomLifecycle').createUserRoomLifecycle(pool,()=>wsServer,async()=>({ok:true}));
  let revision=(await pool.query('SELECT revision FROM rooms WHERE id=$1',[rooms[0]])).rows[0].revision;
  const closed=await lifecycle.mutate(users[0].id,rooms[0],'close',{revision});revision=closed.room.revision;
  assert.equal((await presentation.synchronize(connection)).state.epoch,state.epoch,'closing entry preserves show');
  assert.equal((await http(materialUrl+'/'+asset.id,{method:'DELETE'})).code,'MATERIAL_IN_USE');
  let confirmation={stopShowing:true,requestId:randomUUID(),expectedEpoch:state.epoch,expectedRevision:'0'};
  assert.equal((await http(materialUrl+'/'+asset.id,{method:'DELETE',body:confirmation})).code,'PRESENTATION_CHANGED');
  confirmation={...confirmation,requestId:randomUUID(),expectedRevision:state.revision};
  const removed=await http(materialUrl+'/'+asset.id,{method:'DELETE',body:confirmation});assert.equal(removed.status,200,JSON.stringify(removed));assert.equal(removed.state.asset,null);
  assert.equal((await http(materialUrl+'/'+asset.id,{method:'DELETE',body:confirmation})).state.revision,removed.state.revision);
  const oldEpoch=state.epoch;
  const ending=await Promise.allSettled([presentation.command(connection,body(removed.state,{type:'stop'})),lifecycle.mutate(users[0].id,rooms[0],'end',{revision})]);
  assert.equal(ending[1].status,'fulfilled');
  if(ending[0].status==='rejected')assert.equal(ending[0].reason.code,'PRESENTATION_FORBIDDEN');
  const ended=(await pool.query('SELECT * FROM room_presentation_state WHERE room_id=$1',[rooms[0]])).rows[0];assert.notEqual(ended.epoch,oldEpoch);assert.equal(ended.asset_id,null);
  assert.equal((await http(content,{session:owner.session})).status,403);
  assert.equal((await pool.query('SELECT count(*)::int n FROM room_presentation_requests WHERE room_id=$1',[rooms[0]])).rows[0].n,0);
  // Receipt retention is bounded; expiry does not bypass the revision precondition.
  await pool.query("INSERT INTO room_presentation_requests(room_id,epoch,request_id,signature,result) SELECT $1,$2,gen_random_uuid(),'fixture','{}' FROM generate_series(1,256)",[rooms[1],outsider.state.epoch]);
  // Exercise the journal's hard cap independently of the owner command limit.
  const store=require('../src/services/roomPresentationStore'),client=await pool.connect();
  try{
   const s=(await client.query('SELECT * FROM room_presentation_state WHERE room_id=$1',[rooms[1]])).rows[0];
   await assert.rejects(store.receipt(client,s,randomUUID(),'fixture'),e=>e.code==='PRESENTATION_REQUEST_LIMIT');
   await client.query("UPDATE room_presentation_requests SET created_at=now()-interval '16 minutes' WHERE room_id=$1",[rooms[1]]);
   assert.equal(await store.receipt(client,s,randomUUID(),'fixture'),null);
  }finally{client.release();}
  await pool.query('UPDATE room_presentation_state SET asset_id=$2 WHERE room_id=$1',[rooms[1],foreign]);
  await pool.query('UPDATE rooms SET media_initialized=true WHERE id=$1',[rooms[1]]);
  const secondRevision=(await pool.query('SELECT revision FROM rooms WHERE id=$1',[rooms[1]])).rows[0].revision;
  await lifecycle.mutate(users[0].id,rooms[1],'delete',{revision:secondRevision});
  assert.equal((await pool.query('SELECT asset_id FROM room_presentation_state WHERE room_id=$1',[rooms[1]])).rows[0].asset_id,null);
  assert.equal((await pool.query('SELECT state FROM room_media_assets WHERE id=$1',[foreign])).rows[0].state,'deleting');
  // A process restart keeps SQL state while all former in-memory grants disappear.
  const restarted=require('../src/services/roomPresentation').createRoomPresentationService(pool,{identity:wsServer.presentationIdentity});
  await assert.rejects(restarted.authorizeContent(users[0].id,rooms[0],asset.id,owner.session.token,media),e=>e.code==='PRESENTATION_FORBIDDEN');restarted.close();
  console.log('Presentation PostgreSQL/real WS/JWT HTTP: six viewers, private grants, room isolation, owner-only commands, SQL races/replay, page bounds, stop/replacement/disconnect revocation, close/end epochs and atomic confirmed deletion OK');
 }finally{
  for(const ws of sockets)ws.terminate();presentation?.close();media?.close();
  if(wsServer?.getWss())await new Promise(r=>wsServer.getWss().close(r));
  await new Promise(r=>server?server.close(r):r());
  await require('../src/services/roomOperationQueue').runRoomOperation(async()=>{});
  await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();await fs.rm(directory,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
