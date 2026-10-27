const {spawn}=require('node:child_process');
const fs=require('node:fs/promises'),path=require('node:path');
const limits=require('./roomMediaLimits');
const error=code=>Object.assign(new Error(code),{code,status:['PROCESSOR_BUSY','PROCESSOR_UNAVAILABLE'].includes(code)?503:422});
function createRoomMediaProcessor({executable=process.execPath,worker=path.join(__dirname,'roomMediaWorker.cjs'),checkMs=limits.checkMs,rssBytes=limits.rssBytes}={}){
  const queue=[];let active=null,closed=false;
  function pump(){
    if(active||!queue.length)return;
    const job=queue.shift();active=job;
    if(job.signal?.aborted){job.reject(error('UPLOAD_CANCELLED'));active=null;pump();return;}
    const child=spawn(executable,['--max-old-space-size='+limits.heapMB,worker,job.kind,job.input,job.output],{
      detached:process.platform==='linux',stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,NODE_ENV:'production'}});
    let result,failure,reading=false,finished=false;
    const kill=()=>{try{if(process.platform==='linux'&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch(e){if(e.code!=='ESRCH')child.kill('SIGKILL');}};
    const stop=code=>{if(finished)return;failure ||= error(code);kill();};
    const abort=()=>stop('UPLOAD_CANCELLED');job.signal?.addEventListener('abort',abort,{once:true});
    const timeout=setTimeout(()=>stop('PROCESSOR_TIMEOUT'),checkMs);
    // Heap flags do not constrain native decoder memory or ArrayBuffers.
    const monitor=setInterval(async()=>{
      if(reading||!child.pid)return;reading=true;
      try{const pending=[child.pid],seen=new Set();let bytes=0;
        while(pending.length){
          const pid=pending.pop();if(seen.has(pid))continue;seen.add(pid);
          if(seen.size>32){stop('PROCESSOR_MEMORY_LIMIT');break;}
          // A native child can exit between the status and children reads.
          try{
            const data=await fs.readFile('/proc/'+pid+'/status','utf8'),match=/^VmRSS:\s+(\d+) kB/m.exec(data);
            bytes+=match?Number(match[1])*1024:0;
            const children=await fs.readFile('/proc/'+pid+'/task/'+pid+'/children','utf8');
            pending.push(...children.trim().split(/\s+/).filter(Boolean).map(Number));
          }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e;}
        }
        if(bytes>rssBytes)stop('PROCESSOR_MEMORY_LIMIT');
      }catch(e){if(!['ENOENT','ESRCH'].includes(e.code))stop('PROCESSOR_UNAVAILABLE');}finally{reading=false;}
    },40);
    child.on('message',message=>{if(message?.error)failure=error(message.error);else if(message?.result)result=message.result;});
    child.once('error',()=>{failure=error('PROCESSOR_UNAVAILABLE');});
    child.once('close',code=>{
      kill();finished=true; // A finished worker must not leave native descendants behind.
      clearTimeout(timeout);clearInterval(monitor);job.signal?.removeEventListener('abort',abort);
      if(failure)job.reject(failure);else if(code!==0||!result)job.reject(error('PROCESSOR_FAILED'));else job.resolve(result);
      active=null;pump();
    });
    job.stop=abort;
  }
  return {
    available:()=>!closed&&process.platform==='linux'&&queue.length<limits.queue,
    run(kind,input,output,signal){
      if(closed||process.platform!=='linux'||queue.length>=limits.queue)return Promise.reject(error('PROCESSOR_BUSY'));
      return new Promise((resolve,reject)=>{queue.push({kind,input,output,signal,resolve,reject});pump();});
    },
    close(){closed=true;for(const job of queue.splice(0))job.reject(error('PROCESSOR_UNAVAILABLE'));active?.stop?.();}
  };
}
module.exports={createRoomMediaProcessor};
