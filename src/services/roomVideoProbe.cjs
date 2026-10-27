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
async function inspectVideo(input){
 const stat=await fs.stat(input);if(!stat.isFile()||stat.size<16||stat.size>Contract.video.bytes)fail('FILE_TOO_LARGE');
 await inspectContainer(input,stat.size);
 const args=['-v','error','-max_alloc','67108864','-threads','1','-protocol_whitelist','file','-format_whitelist','mov','-enable_drefs','0','-use_absolute_path','0','-count_packets',
  '-show_entries','format=duration,start_time:stream=codec_type,codec_name,codec_tag_string,pix_fmt,width,height,r_frame_rate,avg_frame_rate,duration,nb_read_packets,channels,sample_rate:stream_disposition=attached_pic:stream_side_data_list','-of','json','-i',input];
 let text;
 try{text=await new Promise((resolve,reject)=>execFile('ffprobe',args,{encoding:'utf8',maxBuffer:65536,env:{PATH:process.env.PATH},windowsHide:true},(error,stdout)=>error?reject(error):resolve(stdout)));}
 catch(e){fail(e.code==='ENOENT'?'PROCESSOR_UNAVAILABLE':'INVALID_VIDEO');}
 let probe;try{probe=JSON.parse(text);}catch(_){fail('INVALID_VIDEO');}
 const streams=probe.streams;if(!Array.isArray(streams)||streams.length<1||streams.length>2)fail('UNSUPPORTED_VIDEO');
 const videos=streams.filter(s=>s.codec_type==='video'),audios=streams.filter(s=>s.codec_type==='audio');
 if(videos.length!==1||videos.length+audios.length!==streams.length)fail('UNSUPPORTED_VIDEO');
 const v=videos[0],a=audios[0];
 const rate=value=>{if(typeof value!=='string'||!/^\d+\/\d+$/.test(value))return NaN;const [n,d]=value.split('/').map(Number);return n/d;};
 const duration=Math.max(Number(probe.format?.duration),...streams.map(s=>Number(s.duration??0)));
 const metadata={durationMs:Math.ceil(duration*1000),width:v.width,height:v.height,fps:Math.max(rate(v.r_frame_rate),rate(v.avg_frame_rate)),codec:v.codec_name,pixelFormat:v.pix_fmt,audioCodec:a?.codec_name??null};
 if(!Contract.videoMetadata(metadata)||!['avc1','avc3'].includes(v.codec_tag_string)||v.disposition?.attached_pic||
   (v.side_data_list||[]).some(s=>s.rotation!==undefined&&Number(s.rotation)!==0)||!Number.isFinite(Number(probe.format?.start_time??0))||Math.abs(Number(probe.format?.start_time??0))>.1||
   streams.some(s=>!Number.isSafeInteger(Number(s.nb_read_packets))||Number(s.nb_read_packets)<1)||
   a&&(!['mp4a'].includes(a.codec_tag_string)||!Number.isInteger(a.channels)||a.channels<1||a.channels>2||!Number.isFinite(Number(a.sample_rate))||Number(a.sample_rate)<8000||Number(a.sample_rate)>48000))fail('UNSUPPORTED_VIDEO');
 const hash=createHash('sha256');for await(const chunk of createReadStream(input))hash.update(chunk);
 return {bytes:stat.size,pageCount:null,mime:'video/mp4',checksum:hash.digest('hex'),video:metadata};
}
module.exports={inspectVideo};
