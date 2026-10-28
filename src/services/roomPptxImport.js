/** One process, one converter. Shared spool contains only private, bounded jobs.
 * Never invokes Docker/LibreOffice from the application or trusts result paths.
 */
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path');
const {setTimeout:delay}=require('node:timers/promises');
const Contract=require('../../public/js/roomMediaContract');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODES=new Set(['INVALID_PPTX','UNSUPPORTED_PPTX','PPTX_LIMIT_EXCEEDED','FILE_TOO_LARGE','TOO_MANY_PAGES','PPTX_CONVERSION_FAILED','PPTX_TIMEOUT','UPLOAD_CANCELLED']);
const error=code=>Object.assign(Error(code),{code,status:['PPTX_UNAVAILABLE','PPTX_BUSY'].includes(code)?503:422});
async function small(file,max=1024){
 let fd;try{fd=await fs.open(file,sync.constants.O_RDONLY|sync.constants.O_NOFOLLOW);const stat=await fd.stat();if(!stat.isFile()||stat.size>max)throw error('PPTX_CONVERSION_FAILED');return JSON.parse(await fd.readFile('utf8'));}finally{await fd?.close();}
}
function createRoomPptxImport({directory=process.env.ROOM_PPTX_SPOOL||null,timeoutMs=120000,pollMs=100}={}){
 let active=false,closed=false;
 const root=directory?path.resolve(directory):null;
 const job=id=>{if(!UUID.test(id||''))throw error('INVALID_PPTX');return path.join(root,id);};
 function available(){
  if(!root||closed||active)return false;
  let fd;try{fd=sync.openSync(path.join(root,'heartbeat.json'),sync.constants.O_RDONLY|sync.constants.O_NOFOLLOW);const s=sync.fstatSync(fd);if(!s.isFile()||s.size>512)return false;
   const h=JSON.parse(sync.readFileSync(fd,'utf8'));return h.version===1&&typeof h.at==='number'&&Math.abs(Date.now()-h.at)<5000&&(h.busy===null||UUID.test(h.busy)&&!sync.existsSync(path.join(root,h.busy)));
  }catch(_){return false;}finally{if(fd!==undefined)sync.closeSync(fd);}
 }
 async function cancel(folder){await fs.writeFile(path.join(folder,'cancel'),'',{flag:'wx',mode:0o600}).catch(e=>{if(!['ENOENT','EEXIST'].includes(e.code))throw e;});}
 async function discard(id){
  if(!root)return false;const folder=job(id);let s;
  try{s=await fs.lstat(folder);}catch(e){if(e.code==='ENOENT')return true;throw e;}
  if(!s.isDirectory()||s.isSymbolicLink())throw error('PPTX_CONVERSION_FAILED');
  await cancel(folder);
  const terminal=await small(path.join(folder,'result.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  if(!terminal){
   // A manifest-less directory was never admitted to the worker. Single app
   // ownership and roomMedia's transfer map exclude a concurrent publisher.
   try{await fs.lstat(path.join(folder,'request.json'));return false;}catch(e){if(e.code!=='ENOENT')throw e;}
  }else if(terminal.id!==id||terminal.version!==1||typeof terminal.ok!=='boolean')throw error('PPTX_CONVERSION_FAILED');
  await fs.rm(folder,{recursive:true,force:true});return true;
 }
 async function run(input,output,id,signal){
  if(!available())throw error('PPTX_UNAVAILABLE');active=true;const folder=job(id);let created=false;
  try{
   signal?.throwIfAborted();await fs.mkdir(folder,{mode:0o700});created=true;
   const source=await fs.open(input,sync.constants.O_RDONLY|sync.constants.O_NOFOLLOW);
   try{const s=await source.stat();if(!s.isFile()||!s.size||s.size>Contract.importLimits.pptx.bytes)throw error('FILE_TOO_LARGE');
    const dest=await fs.open(path.join(folder,'input.pptx'),'wx',0o600);
    try{await require('node:stream/promises').pipeline(source.createReadStream(),dest.createWriteStream(),{signal});}finally{await dest.close();}
   }finally{await source.close();}
   signal?.throwIfAborted();
   await fs.writeFile(path.join(folder,'request.tmp'),JSON.stringify({version:1,id,deadlineMs:Date.now()+timeoutMs}),{flag:'wx',mode:0o600});
   await fs.rename(path.join(folder,'request.tmp'),path.join(folder,'request.json'));
   let deadline=Date.now()+timeoutMs+5000,cancelled=false;
   while(Date.now()<deadline){
    if(signal?.aborted&&!cancelled){cancelled=true;deadline=Math.min(deadline,Date.now()+5000);await cancel(folder);}
    const result=await small(path.join(folder,'result.json')).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    if(result){
     if(result.version!==1||result.id!==id||typeof result.ok!=='boolean')throw error('PPTX_CONVERSION_FAILED');
     if(cancelled)throw error('UPLOAD_CANCELLED');
     if(!result.ok)throw error(CODES.has(result.code)?result.code:'PPTX_CONVERSION_FAILED');
     const prepared=await fs.open(path.join(folder,'output.pdf'),sync.constants.O_RDONLY|sync.constants.O_NOFOLLOW);
     try{const s=await prepared.stat();if(!s.isFile()||s.size<1||s.size>Contract.pptx.outputBytes)throw error('FILE_TOO_LARGE');
      const target=await fs.open(output,'wx',0o600);
      try{await require('node:stream/promises').pipeline(prepared.createReadStream(),target.createWriteStream(),{signal});}finally{await target.close();}
     }finally{await prepared.close();}
     return;
    }
    await delay(pollMs);
   }
   throw error('PPTX_TIMEOUT');
  }catch(e){if(signal?.aborted)throw error('UPLOAD_CANCELLED');throw e;}finally{
   // No quota is released until the worker acknowledged process-group teardown.
   try{if(created){await cancel(folder);await discard(id);}}finally{active=false;}
  }
 }
 return {available,run,discard,close(){closed=true;}};
}
module.exports={createRoomPptxImport};
