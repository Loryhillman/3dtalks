const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {video}=require('./room-video-fixtures'),{createRoomMediaProcessor}=require('../src/services/roomMediaProcessor');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'room-video-probe-')),processor=createRoomMediaProcessor();
 try{
  for(const audio of [true,false]){const file=video(dir,{audio}),bytes=await fs.readFile(file),result=await processor.run('video',file,path.join(dir,'unused'));assert.equal(result.mime,'video/mp4');assert.equal(result.bytes,bytes.length);assert.equal(result.checksum,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.pageCount,null);assert.equal(result.video.audioCodec,audio?'aac':null);assert(result.video.durationMs>=2000&&result.video.durationMs<2100);}
  for(const options of [{codec:'mpeg4'},{fps:31}])await assert.rejects(processor.run('video',video(dir,options),'unused'),e=>e.code==='UNSUPPORTED_VIDEO');
  const bad=path.join(dir,'bad.mp4');await fs.writeFile(bad,'definitely not an MP4 video');await assert.rejects(processor.run('video',bad,'unused'),e=>e.code==='INVALID_VIDEO');
  const bytes=await fs.readFile(video(dir));await fs.writeFile(bad,bytes.subarray(0,bytes.length-20));await assert.rejects(processor.run('video',bad,'unused'),e=>e.code==='INVALID_VIDEO');
  // Native descendants share the worker process group and its monitored RSS.
  const child=path.join(dir,'child.cjs'),worker=path.join(dir,'worker.cjs'),pidFile=path.join(dir,'pid');
  await fs.writeFile(child,`global.buffers=[];setInterval(()=>buffers.push(Buffer.alloc(8*1024*1024,1)),5);`);
  await fs.writeFile(worker,`const c=require('child_process').spawn(process.execPath,[${JSON.stringify(child)}],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setInterval(()=>{},1000);`);
  const native=createRoomMediaProcessor({worker,rssBytes:120*1024**2});
  try{await assert.rejects(native.run('video',bad,'unused'),e=>e.code==='PROCESSOR_MEMORY_LIMIT');}finally{native.close();}
  const pid=Number(await fs.readFile(pidFile,'utf8'));let alive=true;for(let i=0;i<50;i++){try{const s=await fs.readFile('/proc/'+pid+'/status','utf8');alive=!/^State:\s+Z/m.test(s);}catch(e){if(e.code==='ENOENT')alive=false;else throw e;}if(!alive)break;await new Promise(r=>setTimeout(r,20));}assert.equal(alive,false,'native descendant was killed');
  console.log('Video processor: real MP4 H264/AAC and silent, checksums, tail-moov, codec/fps/truncation rejection; descendant RSS limit and group cleanup passed.');
 }finally{processor.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
