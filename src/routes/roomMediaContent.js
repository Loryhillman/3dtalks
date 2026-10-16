const {constants}=require('node:fs'),fs=require('node:fs/promises'),{pipeline}=require('node:stream/promises');
async function sendRoomMediaContent(res,content){
  let handle;
  try{
    try{
      handle=await fs.open(content.path,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();if(!stat.isFile()||stat.size!==content.bytes)throw Error('Invalid file');
    }catch(_){throw Object.assign(new Error('MATERIAL_NOT_FOUND'),{status:404,code:'MATERIAL_NOT_FOUND'});}
    res.set({'Content-Type':content.mime,'Content-Length':String(content.bytes),'Content-Disposition':'attachment; filename="material.'+(content.mime==='application/pdf'?'pdf':'webp')+'"',
      'Content-Security-Policy':"sandbox; default-src 'none'"});
    try{await pipeline(handle.createReadStream(),res,{signal:content.signal});}catch(e){if(!res.destroyed)throw e;}
  }finally{await handle?.close().catch(()=>{});content.release();}
}
module.exports={sendRoomMediaContent};
