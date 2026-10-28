/** Real common-screen/WS traffic in the importing application's process. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),jwt=require('jsonwebtoken'),WebSocket=require('ws');
const {setTimeout:delay}=require('node:timers/promises');
async function check({pool,service,server,room,owner,token,assetId,directory,schema}){
 const sockets=[],latencies=[],reads=[];let wsServer,presentation,running=false,traffic,trafficError;
 const base='http://127.0.0.1:'+server.address().port,spool=process.env.ROOM_PPTX_SPOOL;
 const wait=async(fn,ms=15000)=>{const end=Date.now()+ms;while(Date.now()<end){const v=await fn();if(v)return v;await delay(20);}throw Error('Stress fixture timed out');};
 const cache=(name,exports)=>{const filename=require.resolve(name);require.cache[filename]={id:filename,filename,loaded:true,exports};};
 try{
  process.env.APP_MODE='rooms';process.env.ROOMS_ENABLED='true';
  cache('../src/database/db',{pool,query:(...a)=>pool.query(...a)});cache('../src/websocket/voiceRelay',{init(){},ensureDefaultConfig(){},handleDisconnect(){}});
  wsServer=require('../src/websocket/wsServer');presentation=require('../src/services/roomPresentation').createRoomPresentationService(pool,{identity:wsServer.presentationIdentity,broadcast:wsServer.broadcastToRoom});
  cache('../src/services/roomPresentationRuntime',{service:presentation});cache('../src/services/roomMediaRuntime',{service});
  wsServer.setupWebSocketServer(server);server.on('upgrade',(req,socket,head)=>wsServer.getWss().handleUpgrade(req,socket,head,ws=>wsServer.getWss().emit('connection',ws,req)));
  const obj=(await pool.query("INSERT INTO world_objects(type,room_id) VALUES('presentation_screen',$1) RETURNING id",[room])).rows[0].id;
  for(let i=0;i<6;i++)await pool.query('INSERT INTO room_seats(room_id,object_id,label,sort_order) VALUES($1,$2,$3,$4)',[room,obj,'Stress '+i,i]);
  const actors=[];
  for(let i=0;i<6;i++){
   const user=i?randomUUID():owner,character=randomUUID();if(i)await pool.query('INSERT INTO users(id) VALUES($1)',[user]);
   await pool.query('UPDATE users SET room_character_id=$2 WHERE id=$1',[user,character]);await pool.query('INSERT INTO characters(id,user_id,name) VALUES($1,$2,$3)',[character,user,'Stress '+i]);
   const auth=i?jwt.sign({userId:user},process.env.JWT_SECRET):token,ws=new WebSocket(base.replace('http','ws'));ws.messages=[];ws.on('message',m=>ws.messages.push(JSON.parse(m)));sockets.push(ws);
   await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
   ws.send(JSON.stringify({type:'PLAYER_JOIN',payload:{roomSlug:room,characterId:character,token:auth}}));await wait(()=>ws.messages.find(m=>m.type==='ROOM_PRESENTATION_SESSION')||ws.messages.find(m=>m.type==='ROOM_JOIN_DENIED'));
   const session=ws.messages.find(m=>m.type==='ROOM_PRESENTATION_SESSION')?.payload;assert(session,JSON.stringify(ws.messages));actors.push({user,character,auth,ws,session});
  }
  const connection=[...wsServer.getPlayerPositions()].find(([,p])=>p.characterId===actors[0].character)[0];
  let state=sockets[0].messages.filter(m=>m.type==='ROOM_PRESENTATION_STATE').at(-1).payload;
  const command=async c=>{const reply=await presentation.command(connection,{requestId:randomUUID(),expectedEpoch:state.epoch,expectedRevision:state.revision,command:c});assert(reply.success,JSON.stringify(reply));state=reply.state;};
  await command({type:'show',assetId});
  // Mount the production shared-content router on this same HTTP listener.
  server.listeners('request')[0].use('/api/rooms/:slug/presentation',require('../src/routes/roomPresentation').createRoomPresentationRouter(presentation,service));
  const ping=ws=>new Promise((resolve,reject)=>{const id=Buffer.from(randomUUID()),start=performance.now(),timer=setTimeout(()=>{ws.removeListener('pong',done);reject(Error('Meeting ping stalled'));},3000);function done(data){if(!data.equals(id))return;clearTimeout(timer);ws.removeListener('pong',done);latencies.push(performance.now()-start);resolve();}ws.on('pong',done);ws.ping(id);});
  running=true;traffic=(async()=>{while(running){await Promise.all(actors.map(async a=>{await ping(a.ws);const start=performance.now(),response=await fetch(base+'/api/rooms/'+room+'/presentation/materials/'+assetId+'/content',{headers:{Authorization:'Bearer '+a.auth,'X-Room-Session':a.session.token}});assert.equal(response.status,200);assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0,5).toString(),'%PDF-');reads.push(performance.now()-start);}));await delay(300);}})().catch(e=>{trafficError=e;running=false;});
  const upload=async(name)=>{
   const bytes=await fs.readFile(path.join(process.env.ROOM_PPTX_STRESS_FIXTURES,name+'.pptx')),start=performance.now();
   const reservation=await service.reserve(owner,room,{requestId:randomUUID(),kind:'pdf',sourceFormat:'pptx',name:name+'.pptx',bytes:bytes.length});
   const form=new FormData();form.append('file',new Blob([bytes]),name+'.pptx');const response=await fetch(base+'/api/my/rooms/'+room+'/materials/uploads/'+reservation.upload.id+'/file',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});
   const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.material.pageCount,20);
   const readback=await fetch(base+'/api/my/rooms/'+room+'/materials/'+result.material.id+'/content',{headers:{Authorization:'Bearer '+token}});assert.equal(readback.status,200);
   const task=(await import('pdfjs-dist/legacy/build/pdf.mjs')).getDocument({data:new Uint8Array(await readback.arrayBuffer()),isEvalSupported:false,useWasm:false});const document=await task.promise;
   try{for(const page of [1,20]){const text=(await (await document.getPage(page)).getTextContent()).items.map(i=>i.str).join(' ');for(const script of ['日本語','中文','한글','Проверка'])assert(text.replace(/\s/g,'').includes(script),text);}}finally{await task.destroy();}
   console.log(JSON.stringify({case:name,inputMiB:bytes.length/1024**2,outputMiB:result.material.bytes/1024**2,seconds:(performance.now()-start)/1000,pages:result.material.pageCount}));
   await service.remove(owner,room,result.material.id);await service.cleanup();
  };
  await upload('trial-text');await upload('trial-images');
  // A short real deadline must stop the process group and acknowledge cleanup.
  const limited=require('../src/services/roomPptxImport').createRoomPptxImport({directory:spool,timeoutMs:1000});
  try{await wait(()=>limited.available());await assert.rejects(limited.run(path.join(process.env.ROOM_PPTX_STRESS_FIXTURES,'trial-images.pptx'),path.join(directory,'timed.prepared'),randomUUID()),e=>e.code==='PPTX_TIMEOUT');}finally{limited.close();}
  await require('./room-pptx-recovery').check(directory);
  await command({type:'stop'});running=false;await traffic;
  if(trafficError)throw trafficError;
  // Quiescent fixture: preserve the actual prepared file alongside a pg_dump,
  // restore into another database, then verify its DB/file hash association.
  await require('./room-pptx-recovery').control('backup',null,{schema});
  const url=new URL(process.env.ROOM_TEST_DATABASE_URL);url.pathname='/pptx_restore_gate';
  const restored=new (require('pg').Pool)({connectionString:url.href,options:'-c search_path='+schema+',pg_catalog'});
  try{
   const row=(await restored.query('SELECT * FROM room_media_assets WHERE id=$1',[assetId])).rows[0];assert.equal(row.state,'ready');assert.equal(row.source_format,'pptx');assert.equal(row.page_count,2);
   const backup=path.join(directory,'backup-file.pdf');await fs.copyFile(path.join(directory,row.storage_key+'.pdf'),backup);
   const bytes=await fs.readFile(backup);assert.equal(bytes.length,Number(row.byte_size));assert.equal(require('crypto').createHash('sha256').update(bytes).digest('hex'),row.checksum);
   assert.equal((await restored.query('SELECT owner_user_id FROM rooms WHERE id=$1',[room])).rows[0].owner_user_id,owner);
   console.log('Quiescent pg_dump/restore into a separate database preserved the prepared PPTX PDF, owner, source metadata, byte size and SHA-256.');
  }finally{await restored.end();}

  assert(latencies.length>=12&&reads.length>=12);assert(sockets.every(s=>s.readyState===WebSocket.OPEN));
  const p95=a=>a.sort((a,b)=>a-b)[Math.floor((a.length-1)*.95)];console.log(JSON.stringify({meetingClients:6,pingSamples:latencies.length,pingP95Ms:p95(latencies),pingMaxMs:Math.max(...latencies),pdfP95Ms:p95(reads),pdfMaxMs:Math.max(...reads)}));
 }finally{
  running=false;await traffic?.catch(()=>{});for(const ws of sockets)ws.terminate();presentation?.close();
  if(wsServer?.getWss())await new Promise(r=>wsServer.getWss().close(r));
  await require('../src/services/roomOperationQueue').runRoomOperation(async()=>{});
 }
}
module.exports={check};
