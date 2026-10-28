const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const {video}=require('./room-video-fixtures'),{createRoomMediaProcessor}=require('../src/services/roomMediaProcessor');
(async()=>{
 const {validateVideoProbe}=require('../src/services/roomVideoProbe.cjs');
 const base={codec_type:'video',codec_name:'h264',codec_tag_string:'avc1',pix_fmt:'yuv420p',width:160,height:90,r_frame_rate:'0/0',avg_frame_rate:'24000/1001',duration:'2',nb_read_packets:'48'};
 assert(validateVideoProbe({format:{duration:'2'},streams:[base]}).fps<24,'a missing nominal rate falls back to the measured rate');
 const cover={codec_type:'video',codec_name:'mjpeg',width:80,height:60,disposition:{attached_pic:1},r_frame_rate:'90000/1',duration:'N/A'};
 assert.equal(validateVideoProbe({format:{duration:'2'},streams:[base,cover]}).durationMs,2000);
 for(const [streams,code] of [[[base,{...cover,width:4001,height:1000}],'VIDEO_TRACKS_UNSUPPORTED'],[[base,cover,cover],'VIDEO_TRACKS_UNSUPPORTED'],[[{...base,side_data_list:[{rotation:45}]}],'VIDEO_ROTATION_UNSUPPORTED'],[[base,{codec_type:'audio',codec_name:'aac',codec_tag_string:'mp4a',channels:6,sample_rate:'48000'}],'VIDEO_AUDIO_UNSUPPORTED']])
  assert.throws(()=>validateVideoProbe({format:{duration:'2'},streams}),e=>e.code===code);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'room-video-probe-')),processor=createRoomMediaProcessor();
 try{
  for(const audio of [true,false]){const file=video(dir,{audio}),bytes=await fs.readFile(file),result=await processor.run('video',file,path.join(dir,'unused'));assert.equal(result.mime,'video/mp4');assert.equal(result.bytes,bytes.length);assert.equal(result.checksum,createHash('sha256').update(bytes).digest('hex'));assert.equal(result.pageCount,null);assert.equal(result.video.audioCodec,audio?'aac':null);assert(result.video.durationMs>=2000&&result.video.durationMs<2100);}
  for(const [options,code] of [[{codec:'mpeg4'},'VIDEO_CODEC_UNSUPPORTED'],[{fps:31},'VIDEO_FPS_UNSUPPORTED']])await assert.rejects(processor.run('video',video(dir,options),'unused'),e=>e.code===code);
  assert.equal((await processor.run('video',video(dir,{duration:180,width:16,height:16,fps:1,audio:false}),'unused')).video.durationMs,180000);
  await assert.rejects(processor.run('video',video(dir,{duration:181,width:16,height:16,fps:1,audio:false}),'unused'),e=>e.code==='VIDEO_LIMIT_EXCEEDED');
  const oversized=path.join(dir,'oversized.mp4');const handle=await fs.open(oversized,'w');await handle.truncate(20*1024**2+1);await handle.close();
  await assert.rejects(processor.run('video',oversized,'unused'),e=>e.code==='FILE_TOO_LARGE');
  const run=require('node:child_process').execFileSync;
  const source=video(dir);
  for(const format of ['jpeg','png']){
   const cover=path.join(dir,'cover.'+format),output=path.join(dir,'with-'+format+'-cover.mp4');
   await require('sharp')({create:{width:80,height:60,channels:3,background:'#008800'}})[format]().toFile(cover);
   run('ffmpeg',['-v','error','-i',source,'-i',cover,'-map','0','-map','1','-c','copy','-disposition:v:1','attached_pic',output]);
   const result=await processor.run('video',output,'unused');assert.equal(result.video.width,160);assert.equal(result.video.fps,24);
  }
  const portrait=await processor.run('video',video(dir,{width:90,height:160}),'unused');assert.equal(portrait.video.width,90);assert.equal(portrait.video.height,160);
  const rotated=path.join(dir,'rotated.mp4');run('ffmpeg',['-v','error','-i',source,'-map','0','-c','copy','-metadata:s:v:0','rotate=90',rotated]);
  assert.equal((await processor.run('video',rotated,'unused')).video.width,90);
  const duplicate=path.join(dir,'duplicate.mp4');run('ffmpeg',['-v','error','-i',source,'-map','0:v','-map','0:v','-c','copy',duplicate]);
  await assert.rejects(processor.run('video',duplicate,'unused'),e=>e.code==='VIDEO_TRACKS_UNSUPPORTED');
  await assert.rejects(processor.run('video',video(dir,{width:1922,height:16,fps:1}),'unused'),e=>e.code==='VIDEO_DIMENSIONS_UNSUPPORTED');
  const bad=path.join(dir,'bad.mp4');await fs.writeFile(bad,'definitely not an MP4 video');await assert.rejects(processor.run('video',bad,'unused'),e=>e.code==='INVALID_VIDEO');
  await fs.writeFile(bad,'tiny');await assert.rejects(processor.run('video',bad,'unused'),e=>e.code==='INVALID_VIDEO');
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
  for(const code of ['ESRCH','EACCES']){
   const currentPidFile=path.join(dir,'monitor-pid-'+code);
   await fs.writeFile(monitorWorker,`require('fs').writeFileSync(${JSON.stringify(currentPidFile)},String(process.pid));setTimeout(()=>process.send({result:{ok:true}},()=>process.exit(0)),250);`);
   const original=fs.readFile;let injected=false;
   fs.readFile=async function(file,...args){
    // A previous supervisor may still finish an async /proc read. Inject only
    // into this worker, so parallel browser load cannot consume the fixture.
    let pid;try{pid=require('node:fs').readFileSync(currentPidFile,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!injected&&pid&&String(file)==='/proc/'+pid+'/status'){injected=true;throw Object.assign(Error('Fixture proc read'),{code});}
    return original.call(this,file,...args);
   };
   const monitored=createRoomMediaProcessor({worker:monitorWorker});
   try{const pending=monitored.run('video',bad,'unused');if(code==='ESRCH')assert.deepEqual(await pending,{ok:true});else await assert.rejects(pending,e=>e.code==='PROCESSOR_UNAVAILABLE');assert(injected);}finally{monitored.close();fs.readFile=original;}
  }
  console.log('Video processor: real MP4 H264/AAC and silent, checksums, tail-moov, codec/fps/truncation rejection; descendant RSS/group cleanup and ESRCH/EACCES monitoring passed.');
 }finally{processor.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
