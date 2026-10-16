// Untrusted decoders run only in this short-lived, supervised process.
const fs=require('node:fs/promises'),crypto=require('node:crypto');
const limits=require('./roomMediaLimits');
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function inspect(kind,input,output){
  const stat=await fs.stat(input);
  if(!stat.isFile()||stat.size<1||stat.size>(kind==='pdf'?limits.pdfBytes:limits.imageBytes))fail('FILE_TOO_LARGE');
  if(kind==='pdf'){
    const buffer=await fs.readFile(input);
    if(buffer.subarray(0,5).toString()!=='%PDF-')fail('INVALID_PDF');
    const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task=pdfjs.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,enableXfa:false,
      stopAtErrors:true,disableFontFace:true,useSystemFonts:false,useWasm:false,verbosity:0});
    task.onPassword=()=>{task.destroy();};
    try{
      const doc=await task.promise;
      if((await doc.getMetadata()).info.EncryptFilterName)fail('ENCRYPTED_PDF');
      if(doc.numPages<1||doc.numPages>limits.pages)fail('TOO_MANY_PAGES');
      for(let n=1;n<=doc.numPages;n++){
        const page=await doc.getPage(n),v=page.getViewport({scale:1});
        if(![v.width,v.height].every(x=>Number.isFinite(x)&&x>=.01&&x<=14400)||Math.max(v.width/v.height,v.height/v.width)>1000)fail('INVALID_PDF');
        page.cleanup();
      }
      return {pageCount:doc.numPages,bytes:stat.size,mime:'application/pdf',checksum:crypto.createHash('sha256').update(buffer).digest('hex')};
    }catch(e){if(e.name==='PasswordException'||/password|destroyed/i.test(e.message))fail('ENCRYPTED_PDF');throw e;}
    finally{await task.destroy();}
  }
  const sharp=require('sharp');sharp.cache(false);sharp.concurrency(1);
  // Some PNG decoders expose only APNG's first frame, without metadata.pages.
  // Inspect container chunks too, then always re-encode the decoded image.
  const container=await fs.readFile(input);
  const png=container.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp=container.subarray(0,4).toString()==='RIFF'&&container.subarray(8,12).toString()==='WEBP';
  if(png||webp){
    let offset=png?8:12;
    while(offset+(png?12:8)<=container.length){
      const length=png?container.readUInt32BE(offset):container.readUInt32LE(offset+4);
      const type=container.subarray(offset+(png?4:0),offset+(png?8:4)).toString();
      const end=offset+(png?12:8)+length;if(end>container.length)fail('INVALID_IMAGE');
      if(type==='acTL'||type==='ANIM'||type==='ANMF'||type==='VP8X'&&length>0&&(container[offset+8]&2))fail('INVALID_IMAGE');
      if(type==='IEND')break;offset=end+(webp?(length%2):0);
    }
  }
  const options={limitInputPixels:limits.inputPixels,failOn:'warning',sequentialRead:true};
  const meta=await sharp(input,options).metadata();
  if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)!==1||!meta.width||!meta.height||meta.width*meta.height>limits.inputPixels)fail('INVALID_IMAGE');
  const swapped=meta.orientation>=5&&meta.orientation<=8,w=swapped?meta.height:meta.width,h=swapped?meta.width:meta.height;
  const ratio=Math.min(1,limits.outputSide/w,limits.outputSide/h,Math.sqrt(limits.outputPixels/(w*h)));
  await sharp(input,options).rotate().resize({width:Math.max(1,Math.floor(w*ratio)),height:Math.max(1,Math.floor(h*ratio)),fit:'inside',withoutEnlargement:true}).webp({quality:85,effort:3}).toFile(output);
  await fs.chmod(output,0o600);
  const result=await fs.readFile(output);if(result.length>limits.imageBytes)fail('FILE_TOO_LARGE');
  return {pageCount:1,bytes:result.length,mime:'image/webp',checksum:crypto.createHash('sha256').update(result).digest('hex')};
}
const [kind,input,output]=process.argv.slice(2);
process.once('disconnect',()=>process.exit(1));
const finish=message=>process.send(message,()=>process.exit(0));
inspect(kind,input,output).then(result=>finish({result}),error=>finish({error:
  ['FILE_TOO_LARGE','ENCRYPTED_PDF','TOO_MANY_PAGES'].includes(error.code)?error.code:kind==='pdf'?'INVALID_PDF':'INVALID_IMAGE'}));
