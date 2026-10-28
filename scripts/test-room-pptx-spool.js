/** Spool client lifecycle with explicit worker acknowledgements, no converter. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {createRoomPptxImport}=require('../src/services/roomPptxImport'),{pdf}=require('./room-media-fixtures');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pptx-spool-test-')),spool=path.join(root,'spool');await fs.mkdir(spool);
 const input=path.join(root,'input');await fs.writeFile(input,'synthetic source; validation belongs to isolated worker');
 const importer=createRoomPptxImport({directory:spool,pollMs:10,timeoutMs:100});
 const heartbeat=busy=>fs.writeFile(path.join(spool,'heartbeat.json'),JSON.stringify({version:1,at:Date.now(),busy}));
 let timer;
 try{
  assert(!importer.available());await heartbeat(null);assert(importer.available());
  let id=randomUUID(),output=path.join(root,'out.pdf'),seen=false;
  timer=setInterval(async()=>{if(seen)return;try{await fs.stat(path.join(spool,id,'request.json'));seen=true;await fs.writeFile(path.join(spool,id,'output.pdf'),pdf());await fs.writeFile(path.join(spool,id,'result.json'),JSON.stringify({version:1,id,ok:true}));}catch(e){if(e.code!=='ENOENT')throw e;}},10);
  await importer.run(input,output,id);clearInterval(timer);assert((await fs.readFile(output)).equals(pdf()));await assert.rejects(fs.stat(path.join(spool,id)),{code:'ENOENT'});
  // No acknowledgement: retain the spool and refuse disposal, even after timeout.
  id=randomUUID();await heartbeat(null);
  await assert.rejects(importer.run(input,path.join(root,'timed.pdf'),id),e=>e.code==='PPTX_TIMEOUT');
  assert.equal(await importer.discard(id),false);await fs.stat(path.join(spool,id,'input.pptx'));
  await fs.writeFile(path.join(spool,id,'result.json'),JSON.stringify({version:1,id,ok:false,code:'PPTX_TIMEOUT'}));assert.equal(await importer.discard(id),true);
  // Cancellation waits for terminal acknowledgement before removing worker input.
  id=randomUUID();await heartbeat(null);const controller=new AbortController();seen=false;
  timer=setInterval(async()=>{if(seen)return;try{await fs.stat(path.join(spool,id,'request.json'));seen=true;controller.abort();await new Promise(r=>setTimeout(r,50));await fs.stat(path.join(spool,id,'input.pptx'));await fs.writeFile(path.join(spool,id,'result.json'),JSON.stringify({version:1,id,ok:false,code:'UPLOAD_CANCELLED'}));}catch(e){if(e.code!=='ENOENT')throw e;}},10);
  await assert.rejects(importer.run(input,path.join(root,'cancelled.pdf'),id,controller.signal),e=>e.code==='UPLOAD_CANCELLED');clearInterval(timer);await assert.rejects(fs.stat(path.join(spool,id)),{code:'ENOENT'});
  // A worker-supplied symlink cannot read a file outside its fixed output path.
  id=randomUUID();await heartbeat(null);seen=false;const sentinel=path.join(root,'private');await fs.writeFile(sentinel,'keep this sentinel');
  timer=setInterval(async()=>{if(seen)return;try{await fs.stat(path.join(spool,id,'request.json'));seen=true;await fs.symlink(sentinel,path.join(spool,id,'output.pdf'));await fs.writeFile(path.join(spool,id,'result.json'),JSON.stringify({version:1,id,ok:true}));}catch(e){if(e.code!=='ENOENT')throw e;}},10);
  await assert.rejects(importer.run(input,path.join(root,'escaped.pdf'),id),e=>e.code==='ELOOP');clearInterval(timer);assert.equal(await fs.readFile(sentinel,'utf8'),'keep this sentinel');await assert.rejects(fs.stat(path.join(root,'escaped.pdf')),{code:'ENOENT'});
  console.log('PPTX spool: readiness, bounded copies, terminal cleanup, timeout charge retention/recovery, cancellation acknowledgement and no-follow output passed.');
 }finally{clearInterval(timer);importer.close();await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
