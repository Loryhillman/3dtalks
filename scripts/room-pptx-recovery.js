/** Real converter restart/OOM with an importer surviving in the application. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto'),{setTimeout:delay}=require('node:timers/promises');
async function control(action,jobId,extra={}){
 const root=process.env.ROOM_PPTX_SPOOL;const wait=async fn=>{const end=Date.now()+30000;while(Date.now()<end){const value=await fn();if(value)return value;await delay(40);}throw Error('Control timed out');};
  const id=randomUUID();await fs.writeFile(path.join(root,'gate-control.tmp'),JSON.stringify({id,action,jobId,...extra}));await fs.rename(path.join(root,'gate-control.tmp'),path.join(root,'gate-control.json'));
  const ack=await wait(async()=>{try{const a=JSON.parse(await fs.readFile(path.join(root,'gate-control-ack.json'),'utf8'));return a.id===id?a:null;}catch(e){if(e.code==='ENOENT')return null;throw e;}});assert(ack.ok,JSON.stringify(ack));return ack.data;
 }
async function check(directory){
 const root=process.env.ROOM_PPTX_SPOOL,importer=require('../src/services/roomPptxImport').createRoomPptxImport({directory:root}),processor=require('../src/services/roomMediaProcessor').createRoomMediaProcessor();
 const wait=async(fn)=>{const end=Date.now()+25000;while(Date.now()<end){const value=await fn();if(value)return value;await delay(40);}throw Error('Recovery fixture timed out');};

 try{
  console.log(JSON.stringify({normalWorkloadPeakMiB:await control('measure')}));
  for(const action of ['restart','oom']){
   await wait(()=>importer.available());const id=randomUUID(),output=path.join(directory,action+'.pdf'),controller=new AbortController();
   const pending=importer.run(path.join(process.env.ROOM_PPTX_STRESS_FIXTURES,'trial-images.pptx'),output,id,controller.signal).then(()=>({ok:true}),e=>({error:e.code}));
   try{await wait(async()=>{try{return JSON.parse(await fs.readFile(path.join(root,'heartbeat.json'),'utf8')).busy===id;}catch(_){return false;}});
   const injected=await control(action,id),result=await pending;
   if(action==='restart')assert(result.ok,JSON.stringify(result));
   else assert.equal(result.error,'PPTX_CONVERSION_FAILED',JSON.stringify(result));
   if(result.ok){const data=await processor.run('pdf',output,path.join(directory,'unused'));assert.equal(data.pageCount,20,'restart never published the deliberately stale partial PDF');}
   else assert(['PPTX_CONVERSION_FAILED','PPTX_TIMEOUT'].includes(result.error),JSON.stringify(result));
   await wait(()=>importer.available());
   const fresh=path.join(directory,'fresh-'+action+'.pdf');await importer.run(path.join(__dirname,'fixtures/room-pptx/valid.pptx'),fresh,randomUUID());assert.equal((await processor.run('pdf',fresh,'unused')).pageCount,2);
   console.log(JSON.stringify({fault:action,injected,result,nextJob:'passed'}));
   }finally{controller.abort();await pending;}
  }
 }finally{importer.close();processor.close();}
}
module.exports={check,control};
