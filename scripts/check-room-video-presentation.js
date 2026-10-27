/** Real PostgreSQL, production WS admission/RPC and JWT HTTP; voice alone is stubbed. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto'),{Pool}=require('pg'),express=require('express'),jwt=require('jsonwebtoken'),WebSocket=require('ws');
const {pdf}=require('./room-media-fixtures');
const {video}=require('./room-video-fixtures');
async function main(){
 if(!process.env.ROOM_TEST_DATABASE_URL)throw Error('Set ROOM_TEST_DATABASE_URL to a separate test database');
 const config={connectionString:process.env.ROOM_TEST_DATABASE_URL,statement_timeout:10000},admin=new Pool(config);
 const schema='video_presentation_'+randomUUID().replaceAll('-','');await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({...config,options:'-c search_path='+schema+',pg_catalog'}),directory=await fs.mkdtemp(path.join(os.tmpdir(),'3dtalks-presentation-'));
 let server,wsServer,presentation,media;const sockets=[];
 try{
  await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY,room_character_id uuid,avatar_config jsonb);
   CREATE TABLE admin_users(id int PRIMARY KEY);CREATE TABLE characters(id uuid PRIMARY KEY,user_id uuid,name text,last_position jsonb,last_online timestamptz);
   CREATE TABLE geometry_buildings(id serial PRIMARY KEY,user_id integer NOT NULL);
   CREATE TABLE world_objects(id serial PRIMARY KEY,type text,position_x float,position_y float,position_z float,created_at timestamptz);`);
  for(const name of ['add_rooms.sql','add_room_rejoin_grants.sql','add_room_seats.sql','add_user_rooms.sql','add_room_media.sql','add_room_presentation.sql','add_room_presentation.sql','add_room_media_v2.sql','add_room_media_v2.sql'])
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
  presentation=require('../src/services/roomPresentation').createRoomPresentationService(pool,{identity:wsServer.presentationIdentity,broadcast:wsServer.broadcastToRoom,features:()=>({videoUpload:true,videoPlayback:true,pptxImport:false})});
  cache('../src/services/roomPresentationRuntime',{service:presentation});
  media=require('../src/services/roomMedia').createRoomMediaService(pool,{directory,presentationChanged:presentation.changed,features:()=>({videoUpload:true,videoPlayback:true,pptxImport:false})});
  cache('../src/services/roomMediaRuntime',{service:media});
  const app=express();app.use(express.json());
  app.get('/api/config/language',(_q,res)=>res.json({language:'ru-RU'}));
  app.use('/api/my/rooms/:id/materials',require('../src/routes/roomMedia').createRoomMediaRouter(media));
  app.use('/api/rooms/:slug/presentation',require('../src/routes/roomPresentation').createRoomPresentationRouter(presentation,media));
  const tls=process.env.ROOM_VIDEO_TLS_KEY&&process.env.ROOM_VIDEO_TLS_CERT;
  server=tls?require('node:https').createServer({key:await fs.readFile(process.env.ROOM_VIDEO_TLS_KEY),cert:await fs.readFile(process.env.ROOM_VIDEO_TLS_CERT)},app):require('node:http').createServer(app);wsServer.setupWebSocketServer(server);
  server.on('upgrade',(req,socket,head)=>wsServer.getWss().handleUpgrade(req,socket,head,ws=>wsServer.getWss().emit('connection',ws,req)));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=(tls?'https':'http')+'://127.0.0.1:'+server.address().port;
  const tokens=users.map(u=>jwt.sign({userId:u.id},process.env.JWT_SECRET));
  const wait=async(fn)=>{for(let i=0;i<500;i++){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out waiting for fixture');};
  async function join(index,room=rooms[0]){
   const ws=new WebSocket(base.replace(/^http/,'ws'));ws.messages=[];sockets.push(ws);ws.on('message',m=>ws.messages.push(JSON.parse(m)));
   await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
   ws.send(JSON.stringify({type:'PLAYER_JOIN',payload:{roomSlug:room,characterId:users[index].character,token:tokens[index]}}));
   await wait(()=>ws.messages.find(m=>m.type==='ROOM_PRESENTATION_SESSION')||ws.messages.find(m=>m.type==='ROOM_JOIN_DENIED'));
   assert(!ws.messages.find(m=>m.type==='ROOM_JOIN_DENIED'),JSON.stringify(ws.messages));
   ws.session=ws.messages.find(m=>m.type==='ROOM_PRESENTATION_SESSION').payload;
   ws.state=(await wait(()=>ws.messages.find(m=>m.type==='ROOM_PRESENTATION_STATE'))).payload;return ws;
  }
  const owner=await join(0),participants=[];for(let i=1;i<3;i++)participants.push(await join(i));const outsider=await join(6,rooms[1]);
  assert(owner.session.canControl);assert(participants.every(w=>!w.session.canControl));assert.equal(new Set([owner,...participants].map(w=>w.session.token)).size,3);
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
  const V2=require('../public/js/roomPresentationProtocolV2');
  const negotiate=async ws=>{ws.send(JSON.stringify({type:'ROOM_PRESENTATION_CAPABILITIES',payload:{protocolVersion:2}}));await wait(()=>ws.messages.some(m=>m.type==='ROOM_PRESENTATION_CAPABILITIES_RESULT'));await wait(()=>ws.messages.some(m=>m.type==='ROOM_PRESENTATION_STATE'&&m.payload.protocolVersion===2));ws.state=ws.messages.filter(m=>m.type==='ROOM_PRESENTATION_STATE').at(-1).payload;};
  const peer=participants[0],legacy=participants[1];await negotiate(owner);await negotiate(peer);await negotiate(outsider);
  const nonce=randomUUID();owner.send(JSON.stringify({type:'ROOM_PRESENTATION_CLOCK',payload:{protocolVersion:2,nonce}}));assert(V2.clockResponse((await wait(()=>owner.messages.find(m=>m.type==='ROOM_PRESENTATION_CLOCK_RESULT'&&m.payload.nonce===nonce))).payload));
  const clip=await fs.readFile(video(directory,process.env.ROOM_VIDEO_RELEASE_CHECK==='1'?{duration:90,width:1920,height:1080,preset:'ultrafast',faststart:true}:{duration:12}));
  const reserved=await media.reserve(users[0].id,rooms[0],{requestId:randomUUID(),kind:'video',name:'Shared clip.mp4',bytes:clip.length});
  const transfer=await media.begin(users[0].id,rooms[0],reserved.upload.id);await fs.writeFile(transfer.paths.input,clip);const ready=await media.complete(users[0].id,rooms[0],transfer);
  const connection=[...wsServer.getPlayerPositions()].find(([,p])=>p.characterId===users[0].character)[0];
  const vbody=(s,c)=>({...body(s,c),protocolVersion:2});
  let result=await presentation.command(connection,vbody(owner.state,{type:'show',assetId:ready.id}));assert(result.success);let state=result.state;assert(V2.state(state));assert.equal(state.playback.status,'paused');
  await wait(()=>peer.messages.some(m=>m.type==='ROOM_PRESENTATION_STATE'&&m.payload.asset?.kind==='video'));
  await wait(()=>legacy.messages.some(m=>m.type==='CHAT'&&m.payload.sender==='3DTalks'));
  const legacyState=legacy.messages.filter(m=>m.type==='ROOM_PRESENTATION_STATE').at(-1).payload;assert.equal(legacyState.asset,null);assert(require('../public/js/roomPresentationProtocol').state(legacyState));
  const grantUrl='/api/rooms/'+rooms[0]+'/presentation/materials/'+ready.id+'/video/grant';
  assert.equal((await http(grantUrl,{method:'POST',body:{},index:1})).status,403);
  assert.equal((await http(grantUrl,{method:'POST',body:{},index:2,session:legacy.session})).status,503);
  assert.equal((await http(grantUrl,{method:'POST',body:{},index:6,session:outsider.session})).status,403);
  const grant=await http(grantUrl,{method:'POST',body:{},index:1,session:peer.session,raw:true});assert.equal(grant.status,200);const cookie=grant.headers.get('set-cookie').split(';')[0],native=(await grant.json()).contentPath;
  const data=await fetch(base+native,{headers:{Cookie:cookie,Range:'bytes=0-15'}});assert.equal(data.status,206);assert(Buffer.from(await data.arrayBuffer()).equals(clip.subarray(0,16)));
  const token=cookie.split('=')[1],viewId=native.split('/').at(-2);
  const reader=await presentation.readVideoGrant(token,rooms[0],ready.id,viewId);
  state=(await presentation.command(connection,vbody(state,{type:'play'}))).state;assert.equal(state.playback.status,'playing');
  const seek=vbody(state,{type:'seek',positionMs:3000}),pause=vbody(state,{type:'pause'}),raced=await Promise.all([presentation.command(connection,seek),presentation.command(connection,pause)]);
  assert.equal(raced.filter(r=>r.success).length,1);assert.equal(raced.find(r=>!r.success).code,'PRESENTATION_CHANGED');state=raced.find(r=>r.success).state;
  const won=raced[0].success?seek:pause,replay=await presentation.command(connection,won);assert(replay.reused);assert.equal(replay.state.revision,state.revision);
  await assert.rejects(presentation.command(connection,{...won,command:{type:'seek',positionMs:4000}}),e=>e.code==='REQUEST_ID_REUSED');
  await assert.rejects(presentation.command(connection,vbody(state,{type:'seek',positionMs:600000})),e=>e.code==='INVALID_COMMAND');
  state=(await presentation.command(connection,vbody(state,{type:'pause'}))).state;
  const peerConnection=[...wsServer.getPlayerPositions()].find(([,p])=>p.characterId===users[1].character)[0];await assert.rejects(presentation.command(peerConnection,vbody(state,{type:'play'})),e=>e.code==='PRESENTATION_FORBIDDEN');
  state=(await presentation.command(connection,vbody(state,{type:'stop'}))).state;assert(reader.signal.aborted);reader.release();assert.equal((await fetch(base+native,{headers:{Cookie:cookie}})).status,403);
  assert.equal((await pool.query('SELECT playback_status,playback_position_ms,playback_anchor_at FROM room_presentation_state WHERE room_id=$1',[rooms[0]])).rows[0].playback_anchor_at,null);
  for(const ws of [owner,peer,legacy])ws.close();
  await wait(()=>!wsServer.presentationIdentity(connection));
  if(process.env.ROOM_VIDEO_BROWSER_CHECK==='0'){
   // Alpine gate runs backend transports; native Chromium runs separately on
   // the glibc host. Retain a second ready asset for the lifecycle assertion.
   const spare=await media.reserve(users[0].id,rooms[0],{requestId:randomUUID(),kind:'video',name:'Spare clip.mp4',bytes:clip.length});
   const upload=await media.begin(users[0].id,rooms[0],spare.upload.id);await fs.writeFile(upload.paths.input,clip);await media.complete(users[0].id,rooms[0],upload);
  }else await require('./room-video-presentation-browser').check({app,base,roomId:rooms[0],actors:users.map((u,i)=>({...u,token:tokens[i]})),clip});
  // A restart pauses at a bounded durable checkpoint, even for a very old anchor.
  await pool.query("UPDATE room_presentation_state SET asset_id=$2,page_index=0,playback_status='playing',playback_position_ms=1,playback_anchor_at='1970-01-01' WHERE room_id=$1",[rooms[0],ready.id]);
  const restarted=require('../src/services/roomPresentation').createRoomPresentationService(pool,{identity:wsServer.presentationIdentity});
  try{await restarted.start();const row=(await pool.query('SELECT * FROM room_presentation_state WHERE room_id=$1',[rooms[0]])).rows[0];assert.equal(row.playback_status,'paused');assert.equal(row.playback_position_ms,ready.video.durationMs);assert.equal(row.playback_anchor_at,null);}finally{restarted.close();}
  const beforeDelete=(await pool.query('SELECT * FROM room_presentation_state WHERE room_id=$1',[rooms[0]])).rows[0];
  await pool.query("UPDATE room_presentation_state SET playback_status='playing',playback_position_ms=0,playback_anchor_at=now() WHERE room_id=$1",[rooms[0]]);
  await media.remove(users[0].id,rooms[0],ready.id,{stopShowing:true,requestId:randomUUID(),expectedEpoch:beforeDelete.epoch,expectedRevision:String(beforeDelete.revision)});
  let reset=(await pool.query('SELECT * FROM room_presentation_state WHERE room_id=$1',[rooms[0]])).rows[0];assert.equal(reset.asset_id,null);assert.equal(reset.playback_status,'paused');assert.equal(reset.playback_position_ms,0);assert.equal(reset.playback_anchor_at,null);
  const nextVideo=(await pool.query("SELECT id FROM room_media_assets WHERE room_id=$1 AND kind='video' AND state='ready' LIMIT 1",[rooms[0]])).rows[0];
  await pool.query("UPDATE room_presentation_state SET asset_id=$2,playback_status='playing',playback_anchor_at=now() WHERE room_id=$1",[rooms[0],nextVideo.id]);
  const roomRevision=(await pool.query('SELECT revision FROM rooms WHERE id=$1',[rooms[0]])).rows[0].revision;
  await require('../src/services/userRoomLifecycle').createUserRoomLifecycle(pool,()=>wsServer,async()=>({ok:true})).mutate(users[0].id,rooms[0],'end',{revision:roomRevision});
  const ended=(await pool.query('SELECT * FROM room_presentation_state WHERE room_id=$1',[rooms[0]])).rows[0];assert.notEqual(ended.epoch,reset.epoch);assert.equal(ended.asset_id,null);assert.equal(ended.playback_position_ms,0);assert.equal(ended.playback_anchor_at,null);
  console.log('Video presentation SQL/HTTP/WS: negotiation/clock, V1 projection, room/owner/session guards, video grants, play/pause/seek races/replay/stop/revoke and restart pause passed.');
 }finally{
  for(const ws of sockets)ws.terminate();presentation?.close();media?.close();
  if(wsServer?.getWss())await new Promise(r=>wsServer.getWss().close(r));
  await new Promise(r=>server?server.close(r):r());
  await require('../src/services/roomOperationQueue').runRoomOperation(async()=>{});
  await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();await fs.rm(directory,{recursive:true,force:true});
 }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
