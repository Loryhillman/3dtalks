const {constants}=require('node:fs'),fs=require('node:fs/promises'),{pipeline}=require('node:stream/promises');
function parseRange(header,size){
  if(header===undefined)return {start:0,end:size-1,partial:false};
  if(typeof header!=='string'||header.length>100||!/^bytes=(\d*)-(\d*)$/.test(header))return null;
  const [,a,b]=/^bytes=(\d*)-(\d*)$/.exec(header);
  if(!a&&!b)return null;
  if(a){const start=Number(a),end=b?Math.min(Number(b),size-1):size-1;
    return Number.isSafeInteger(start)&&Number.isSafeInteger(Number(b||0))&&start>=0&&start<size&&end>=start?{start,end,partial:true}:null;}
  const count=Number(b);return Number.isSafeInteger(count)&&count>0?{start:Math.max(0,size-count),end:size-1,partial:true}:null;
}
async function sendRoomMediaContent(res,content,{method='GET',range,video=false}={}){
  let handle;
  try{
    try{
      handle=await fs.open(content.path,constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();if(!stat.isFile()||stat.size!==content.bytes)throw Error('Invalid file');
    }catch(_){throw Object.assign(new Error('MATERIAL_NOT_FOUND'),{status:404,code:'MATERIAL_NOT_FOUND'});}
    let selected={start:0,end:content.bytes-1,partial:false};
    if(video){
      res.set({'Accept-Ranges':'bytes','Content-Disposition':'inline; filename="material.mp4"'});
      selected=method==='HEAD'?selected:parseRange(range,content.bytes);
      if(!selected){res.status(416).set('Content-Range','bytes */'+content.bytes).end();return;}
      if(selected.partial)res.status(206).set('Content-Range',`bytes ${selected.start}-${selected.end}/${content.bytes}`);
    }
    res.set({'Content-Type':content.mime,'Content-Length':String(selected.end-selected.start+1),...(!video?{'Content-Disposition':'attachment; filename="material.'+(content.mime==='application/pdf'?'pdf':content.mime==='video/mp4'?'mp4':'webp')+'"'}:{}),
      'Content-Security-Policy':"sandbox; default-src 'none'"});
    if(method==='HEAD'){res.end();return;}
    try{await pipeline(handle.createReadStream({start:selected.start,end:selected.end}),res,{signal:content.signal});}catch(e){if(!res.destroyed)throw e;}
  }finally{await handle?.close().catch(()=>{});content.release();}
}
module.exports={sendRoomMediaContent,parseRange};
