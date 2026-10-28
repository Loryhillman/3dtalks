const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const sharp=require('sharp');const {pdf}=require('./room-media-fixtures');
const {createRoomMediaProcessor}=require('../src/services/roomMediaProcessor');
(async()=>{
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'room-media-processor-')),processor=createRoomMediaProcessor();
 try{
  const input=path.join(temp,'input'),output=path.join(temp,'output');
  for(const rotate of [0,90]){await fs.writeFile(input,pdf({rotate}));const result=await processor.run('pdf',input,output);assert.equal(result.pageCount,2);assert.equal(result.mime,'application/pdf');}
  await fs.writeFile(input,pdf({pages:100}));assert.equal((await processor.run('pdf',input,output)).pageCount,100);
  await fs.copyFile(path.join(__dirname,'fixtures/room-encrypted.pdf'),input);await assert.rejects(processor.run('pdf',input,output),e=>e.code==='ENCRYPTED_PDF');
  await fs.copyFile(path.join(__dirname,'fixtures/room-encrypted-empty-password.pdf'),input);await assert.rejects(processor.run('pdf',input,output),e=>e.code==='ENCRYPTED_PDF');
  await fs.writeFile(input,pdf({pages:101}));await assert.rejects(processor.run('pdf',input,output),e=>e.code==='TOO_MANY_PAGES');
  await fs.writeFile(input,pdf({width:999999}));await assert.rejects(processor.run('pdf',input,output),e=>e.code==='INVALID_PDF');
  await fs.writeFile(input,'bad');await assert.rejects(processor.run('pdf',input,output),e=>e.code==='INVALID_PDF');
  await sharp({create:{width:3000,height:2000,channels:3,background:'#ff0000'}}).jpeg().withMetadata({orientation:6}).toFile(input);
  const image=await processor.run('image',input,output),meta=await sharp(output).metadata();
  assert.equal(image.pageCount,1);assert.equal(meta.format,'webp');assert(meta.width<meta.height);assert(meta.width*meta.height<=4000000);assert(meta.height<=2560);assert.equal(meta.exif,undefined);
  await sharp({create:{width:4100,height:4100,channels:3,background:'#ff0000'}}).png().toFile(input);await assert.rejects(processor.run('image',input,output),e=>e.code==='INVALID_IMAGE');
  await fs.copyFile(path.join(__dirname,'fixtures/room-animated.webp'),input);await assert.rejects(processor.run('image',input,output),e=>e.code==='INVALID_IMAGE');
  await fs.copyFile(path.join(__dirname,'fixtures/room-animated.png'),input);await assert.rejects(processor.run('image',input,output),e=>e.code==='INVALID_IMAGE');
  // The real supervisor kills both a stuck process and native/external allocations.
  const stuck=path.join(temp,'stuck.cjs');await fs.writeFile(stuck,'setInterval(()=>{},1000);');
  const timeout=createRoomMediaProcessor({worker:stuck,checkMs:100});
  try{await assert.rejects(timeout.run('pdf',input,output),e=>e.code==='PROCESSOR_TIMEOUT');}finally{timeout.close();}
  const queued=createRoomMediaProcessor({worker:stuck,checkMs:1000}),controllers=Array.from({length:5},()=>new AbortController());
  const jobs=controllers.map(c=>queued.run('pdf',input,output,c.signal).catch(e=>e.code));
  assert.equal(queued.available(),false);await assert.rejects(queued.run('pdf',input,output),e=>e.code==='PROCESSOR_BUSY');
  controllers.forEach(c=>c.abort());assert((await Promise.all(jobs)).every(code=>code==='UPLOAD_CANCELLED'));queued.close();
  const memory=path.join(temp,'memory.cjs');await fs.writeFile(memory,'global.buffers=[];setInterval(()=>{buffers.push(Buffer.alloc(8*1024*1024,1));},5);');
  const rss=createRoomMediaProcessor({worker:memory,rssBytes:80*1024**2});
  try{await assert.rejects(rss.run('pdf',input,output),e=>e.code==='PROCESSOR_MEMORY_LIMIT');}finally{rss.close();}
  const controller=new AbortController(),cancelled=processor.run('pdf',input,output,controller.signal);controller.abort();await assert.rejects(cancelled,e=>e.code==='UPLOAD_CANCELLED');
  console.log('Media processor: real PDF parser/pages/rotation/encryption, image EXIF/normalization/pixel cap, timeout/RSS kill and cancellation OK on '+process.version);
 }finally{processor.close();await fs.rm(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
