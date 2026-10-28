const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {video}=require('./room-video-fixtures'),{createRoomMediaProcessor}=require('../src/services/roomMediaProcessor');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'room-video-probe-')),processor=createRoomMediaProcessor();
 try{
  for(const audio of [true,false]){const file=video(dir,{audio}),bytes=await fs.readFile(file),result=await processor.run('video',file,path.join(dir,'unused'));assert.equal(result.mime,'video/mp4');assert.equal(result.bytes,bytes.length);assert.equal(result.checksum,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.pageCount,null);assert.equal(result.video.audioCodec,audio?'aac':null);assert(result.video.durationMs>=2000&&result.video.durationMs<2100);}
  for(const options of [{codec:'mpeg4'},{fps:31}])await assert.rejects(processor.run('video',video(dir,options),'unused'),e=>e.code==='UNSUPPORTED_VIDEO');
  assert.equal((await processor.run('video',video(dir,{duration:180,width:16,height:16,fps:1,audio:false}),'unused')).video.durationMs,180000);
  await assert.rejects(processor.run('video',video(dir,{duration:181,width:16,height:16,fps:1,audio:false}),'unused'),e=>e.code==='VIDEO_LIMIT_EXCEEDED');
  const oversized=path.join(dir,'oversized.mp4');const handle=await fs.open(oversized,'w');await handle.truncate(20*1024**2+1);await handle.close();
  await assert.rejects(processor.run('video',oversized,'unused'),e=>e.code==='FILE_TOO_LARGE');
  const bad=path.join(dir,'bad.mp4');await fs.writeFile(bad,'definitely not an MP4 video');await assert.rejects(processor.run('video',bad,'unused'),e=>e.code==='INVALID_VIDEO');
  const bytes=await fs.readFile(video(dir));await fs.writeFile(bad,bytes.subarray(0,bytes.length-20));await assert.rejects(processor.run('video',bad,'unused'),e=>e.code==='INVALID_VIDEO');
  // Native descendants share the worker process group and its monitored RSS.
  const child=path.join(dir,'child.cjs'),worker=path.join(dir,'worker.cjs'),pidFile=path.join(dir,'pid');
  await fs.writeFile(child,`global.buffers=[];setInterval(()=>buffers.push(Buffer.alloc(8*1024*1024,1)),5);`);
  await fs.writeFile(worker,`const c=require('child_process').spawn(process.execPath,[${JSON.stringify(child)}],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`);
  const native=createRoomMediaProcessor({worker,rssBytes:120*1024**2});
  try{await assert.rejects(native.run('video',bad,'unused'),e=>e.code==='PROCESSOR_MEMORY_LIMIT');}finally{native.close();}
  const pid=Number(await fs.readFile(pidFile,'utf8'));let alive=true;for(let i=0;i<50;i++){try{const s=await fs.readFile('/proc/'+pid+'/status','utf8');alive=!/^State:\s+Z/m.test(s);}catch(e){if(e.code==='ENOENT')alive=false;else throw e;}if(!alive)break;await new Promise(r=>setTimeout(r,20));}assert.equal(alive,false,'native descendant was killed');
  // Linux /proc may report ESRCH as well as ENOENT during child exit.
  // Ignore only vanished processes; actual permission/read failures stay closed.
  const monitorWorker=path.join(dir,'monitor.cjs');
  await fs.writeFile(monitorWorker,`setTimeout(()=>process.send({result:{ok:true}},()=>process.exit(0)),250);`);
  for(const code of ['ESRCH','EACCES']){
   const original=fs.readFile;let injected=false;
   fs.readFile=async function(file,...args){if(!injected&&/^\/proc\/\d+\/(status|task\/\d+\/children)$/.test(String(file))){injected=true;throw Object.assign(Error('Fixture proc read'),{code});}return original.call(this,file,...args);};
   const monitored=createRoomMediaProcessor({worker:monitorWorker});
   try{const pending=monitored.run('video',bad,'unused');if(code==='ESRCH')assert.deepEqual(await pending,{ok:true});else await assert.rejects(pending,e=>e.code==='PROCESSOR_UNAVAILABLE');assert(injected);}finally{monitored.close();fs.readFile=original;}
  }
  console.log('Video processor: real MP4 H264/AAC and silent, checksums, tail-moov, codec/fps/truncation rejection; descendant RSS/group cleanup and ESRCH/EACCES monitoring passed.');
 }finally{processor.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
