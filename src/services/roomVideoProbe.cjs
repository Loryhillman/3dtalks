// Invoked only inside the existing supervised media-worker process group.
const fs=require('node:fs/promises'),{createReadStream}=require('node:fs'),{createHash}=require('node:crypto'),{execFile}=require('node:child_process');
const Contract=require('../../public/js/roomMediaContract');
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function inspectContainer(input,size){
 const handle=await fs.open(input,'r');
 try{
  let offset=0,count=0,brand=false,moov=false,mdat=false;
  while(offset<size){
   if(++count>4096||size-offset<8)fail('INVALID_VIDEO');
   const header=Buffer.alloc(16);await handle.read(header,0,Math.min(16,size-offset),offset);
   let bytes=header.readUInt32BE(0),length=8;const type=header.toString('ascii',4,8);
   if(bytes===1){if(size-offset<16)fail('INVALID_VIDEO');const n=header.readBigUInt64BE(8);if(n>BigInt(size))fail('INVALID_VIDEO');bytes=Number(n);length=16;}
   if(bytes===0)bytes=size-offset;
   if(bytes<length||bytes>size-offset)fail('INVALID_VIDEO');
   if(type==='moof')fail('UNSUPPORTED_VIDEO');
   if(type==='ftyp'){
    if(offset!==0||bytes<16||bytes>256)fail('INVALID_VIDEO');
    const data=Buffer.alloc(bytes-length);await handle.read(data,0,data.length,offset+length);
    const brands=[data.toString('ascii',0,4)];for(let i=8;i+4<=data.length;i+=4)brands.push(data.toString('ascii',i,i+4));
    brand=brands[0]!=='qt  '&&brands.some(b=>['isom','iso2','iso4','iso5','iso6','mp41','mp42','avc1'].includes(b));
   }
   if(type==='moov')moov=true;if(type==='mdat')mdat=true;
   offset+=bytes;
  }
  if(!brand||!moov||!mdat)fail('INVALID_VIDEO');
 }finally{await handle.close();}
}
function validateVideoProbe(probe){
 const streams=probe.streams;if(!Array.isArray(streams)||streams.length<1||streams.length>3)fail('VIDEO_TRACKS_UNSUPPORTED');
 // A bounded embedded poster is metadata, not a second playable video track.
 const covers=streams.filter(s=>s.disposition?.attached_pic===1);
 if(covers.length>1||covers.some(s=>s.codec_type!=='video'||!['mjpeg','png'].includes(s.codec_name)||
   !Number.isSafeInteger(s.width)||!Number.isSafeInteger(s.height)||s.width<1||s.height<1||s.width*s.height>4000000))fail('VIDEO_TRACKS_UNSUPPORTED');
 const playable=streams.filter(s=>!covers.includes(s)),videos=playable.filter(s=>s.codec_type==='video'),audios=playable.filter(s=>s.codec_type==='audio');
 if(videos.length!==1||audios.length>1||videos.length+audios.length!==playable.length)fail('VIDEO_TRACKS_UNSUPPORTED');
 const v=videos[0],a=audios[0];
 if(v.codec_name!=='h264'||!['avc1','avc3'].includes(v.codec_tag_string)||v.pix_fmt!=='yuv420p')fail('VIDEO_CODEC_UNSUPPORTED');
 if(a&&(a.codec_name!=='aac'||a.codec_tag_string!=='mp4a'||!Number.isInteger(a.channels)||a.channels<1||a.channels>2||
   !Number.isFinite(Number(a.sample_rate))||Number(a.sample_rate)<8000||Number(a.sample_rate)>48000))fail('VIDEO_AUDIO_UNSUPPORTED');
 const rate=value=>{if(typeof value!=='string'||!/^\d+\/\d+$/.test(value))return NaN;const [n,d]=value.split('/').map(Number);return n>0&&d>0?n/d:NaN;};
 const rates=[rate(v.r_frame_rate),rate(v.avg_frame_rate)].filter(Number.isFinite),fps=rates.length?Math.max(...rates):NaN;
 if(!Number.isFinite(fps)||fps>Contract.video.fps)fail('VIDEO_FPS_UNSUPPORTED');
 const rotations=(v.side_data_list||[]).filter(s=>s.rotation!==undefined).map(s=>Number(s.rotation));
 if(rotations.some(n=>!Number.isFinite(n)||Math.abs(n/90-Math.round(n/90))>0.00001)||new Set(rotations).size>1)fail('VIDEO_ROTATION_UNSUPPORTED');
 const quarterTurn=rotations.length&&Math.abs(Math.round(rotations[0]/90))%2===1;
 const width=quarterTurn?v.height:v.width,height=quarterTurn?v.width:v.height;
 if(!Contract.videoDimensions(width,height))fail('VIDEO_DIMENSIONS_UNSUPPORTED');
 // Cover timestamps/rates do not describe the playable media timeline.
 const durations=[probe.format?.duration,...playable.map(s=>s.duration)].filter(n=>n!==undefined&&n!=='N/A').map(Number);
 if(!durations.length||durations.some(n=>!Number.isFinite(n)||n<=0))fail('INVALID_VIDEO');
 const durationMs=Math.ceil(Math.max(...durations)*1000);
 if(durationMs>Contract.importLimits.video.durationMs)fail('VIDEO_LIMIT_EXCEEDED');
 const metadata={durationMs,width,height,fps,codec:v.codec_name,pixelFormat:v.pix_fmt,audioCodec:a?.codec_name??null};
 if(!Contract.videoMetadata(metadata)||!Number.isFinite(Number(probe.format?.start_time??0))||Math.abs(Number(probe.format?.start_time??0))>.1||
   playable.some(s=>!Number.isSafeInteger(Number(s.nb_read_packets))||Number(s.nb_read_packets)<1))fail('UNSUPPORTED_VIDEO');
 return metadata;
}
async function inspectVideo(input){
 const stat=await fs.stat(input);if(stat.size>Contract.importLimits.video.bytes)fail('FILE_TOO_LARGE');
 if(!stat.isFile()||stat.size<16)fail('INVALID_VIDEO');
 await inspectContainer(input,stat.size);
 const args=['-v','error','-max_alloc','67108864','-threads','1','-protocol_whitelist','file','-format_whitelist','mov','-enable_drefs','0','-use_absolute_path','0','-count_packets',
  '-show_entries','format=duration,start_time:stream=codec_type,codec_name,codec_tag_string,pix_fmt,width,height,r_frame_rate,avg_frame_rate,duration,nb_read_packets,channels,sample_rate:stream_disposition=attached_pic:stream_side_data_list','-of','json','-i',input];
 let text;
 try{text=await new Promise((resolve,reject)=>execFile('ffprobe',args,{encoding:'utf8',maxBuffer:65536,env:{PATH:process.env.PATH},windowsHide:true},(error,stdout)=>error?reject(error):resolve(stdout)));}
 catch(e){fail(e.code==='ENOENT'?'PROCESSOR_UNAVAILABLE':'INVALID_VIDEO');}
 let probe;try{probe=JSON.parse(text);}catch(_){fail('INVALID_VIDEO');}
 const metadata=validateVideoProbe(probe);
 const hash=createHash('sha256');for await(const chunk of createReadStream(input))hash.update(chunk);
 return {bytes:stat.size,pageCount:null,mime:'video/mp4',checksum:hash.digest('hex'),video:metadata};
}
module.exports={inspectVideo,validateVideoProbe};
