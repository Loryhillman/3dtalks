/** Host-only fault injection into explicitly named disposable test containers. */
const {execFile}=require('node:child_process'),{promisify}=require('node:util');const run=promisify(execFile);
function start({app,worker,pg}){
 let busy=false,closed=false,seen=null,pending=Promise.resolve();
 const docker=async(...args)=>(await run('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:1024**2})).stdout.trim();
 const metrics=async()=>{const values=await Promise.all([app,worker,pg].map(n=>docker('exec',n,'cat','/sys/fs/cgroup/memory.peak')));return Object.fromEntries(['app','worker','postgres'].map((n,i)=>[n,Number(values[i])/1024**2]));};
 async function poll(){
  if(busy||closed)return;busy=true;
  let request;try{
   try{request=JSON.parse(await docker('exec',app,'cat','/app/pptx-spool/gate-control.json'));}catch(_){return;}
   if(request.id===seen)return;seen=request.id;
   if(!/^[a-f0-9-]{36}$/.test(request.id)||!['measure','restart','oom','backup'].includes(request.action)||['restart','oom'].includes(request.action)&&!/^[a-f0-9-]{36}$/.test(request.jobId))throw Error('Invalid fault fixture');
   let data={};
   if(request.action==='measure')data=await metrics();
   if(request.action==='backup'){
    if(!/^pptx_[a-f0-9]{32}$/.test(request.schema))throw Error('Invalid test backup schema');
    await docker('exec',pg,'pg_dump','-U','postgres','-d','pptx_gate','--schema',request.schema,'--file','/tmp/pptx-gate-backup.sql');
    await docker('exec',pg,'createdb','-U','postgres','pptx_restore_gate');
    await docker('exec',pg,'psql','-U','postgres','-d','pptx_restore_gate','-v','ON_ERROR_STOP=1','-f','/tmp/pptx-gate-backup.sql');
   }
   if(request.action==='restart'){
    await docker('kill','--signal','KILL',worker);
    // Deliberately preserve a partial output from the crashed attempt.
    await docker('exec',app,'node','-e',"const fs=require('fs'),p='/app/pptx-spool/'+process.argv[1];fs.writeFileSync(p+'/input.pdf','%PDF-stale-incomplete');",request.jobId);
    await docker('start',worker);
   }
   if(request.action==='oom'){
    const pressure=String.raw`import mmap,ctypes,time,os,signal
from pathlib import Path
end=time.time()+12
found=False
while time.time()<end and not found:
 for p in Path('/proc').glob('[0-9]*/cmdline'):
  try:
   if p.read_bytes().split(bytes([0]))[0].endswith(b'soffice.bin'):
    (p.parent/'oom_score_adj').write_text('1000');os.kill(int(p.parent.name),signal.SIGSTOP);found=True;break
  except FileNotFoundError: pass
 if not found: time.sleep(.05)
assert found,'No active LibreOffice process'
a=mmap.mmap(-1,600*1024*1024)
c=ctypes.CDLL(None);c.mlock.argtypes=[ctypes.c_void_p,ctypes.c_size_t]
assert c.mlock(ctypes.addressof(ctypes.c_char.from_buffer(a)),len(a))==0
`;
    let killed=false;try{await docker('exec',worker,'python3','-c',pressure);}catch(e){killed=e.code===137;if(!killed)console.log('Pressure subprocess exit:',e.code,e.stderr?.slice(-200));}
    const state=JSON.parse(await docker('inspect','--format','{{json .State}}',worker));
    if(!state.Running){killed ||= state.OOMKilled;await docker('start',worker);}
    const events=await docker('exec',worker,'cat','/sys/fs/cgroup/memory.events');
    const oom=Number(/^oom_kill (\d+)$/m.exec(events)?.[1]||0);if(!killed&&!oom)throw Error('OOM injection did not reach cgroup limit');data={injectedExit137:killed,oomKills:oom};
   }
   await docker('exec',app,'node','-e',"const fs=require('fs');fs.writeFileSync('/app/pptx-spool/gate-control-ack.tmp',process.argv[1]);fs.renameSync('/app/pptx-spool/gate-control-ack.tmp','/app/pptx-spool/gate-control-ack.json');",JSON.stringify({id:request.id,ok:true,data}));
  }catch(e){
   if(request?.id)await docker('exec',app,'node','-e',"const fs=require('fs');fs.writeFileSync('/app/pptx-spool/gate-control-ack.json',process.argv[1]);",JSON.stringify({id:request.id,ok:false,error:e.message}));
   throw e;
  }finally{busy=false;}
 }
 const timer=setInterval(()=>{if(busy||closed)return;pending=poll().catch(e=>{console.error('Disposable fault injection failed:',e.message);});},400);
 return {async stop(){closed=true;clearInterval(timer);await pending;}};
}
module.exports={start};
