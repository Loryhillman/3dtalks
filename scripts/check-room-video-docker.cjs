/** Isolated release gate. Requires an already built image; never uses Compose,
 * the working database, host ports or repository mounts. Copies only test scripts into the disposable
 * app container; production source and dependencies come from the built image. Removes only containers
 * and the network created by this invocation, including their anonymous volumes.
 */
const {execFileSync,execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomBytes}=require('node:crypto');
const run=promisify(execFile),docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function main(){
 const image=process.env.ROOM_VIDEO_TEST_IMAGE||'3dtalks:video-release-gate';docker('image','inspect',image);
 const id='3dtalks-video-gate-'+randomBytes(5).toString('hex'),pg=id+'-pg',app=id+'-app',password=randomBytes(20).toString('hex');
 let network=false,postgres=false,application=false,monitor,busy=false,peak=0;
 try{
  docker('network','create',id);network=true;
  docker('create','--name',pg,'--network',id,'--network-alias','db','--memory','256m','--pids-limit','128','-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=media_release_test','postgres:18','-c','shared_buffers=64MB','-c','max_connections=60','-c','work_mem=2MB');postgres=true;docker('start',pg);
  for(let i=0;i<60;i++){try{docker('exec',pg,'pg_isready','-U','postgres','-d','media_release_test');break;}catch(e){if(i===59)throw Error('Disposable PostgreSQL did not start');await new Promise(r=>setTimeout(r,500));}}
  const scripts=['test-room-media-v2-contract.js','test-room-video-timeline.js','test-room-video-grants.js','test-room-video-processor.js','check-room-media-v2-postgres.js','check-room-startup-postgres.js','check-room-video.js','check-room-media.js','check-room-presentation.js','check-room-video-presentation.js'];
  const code=String.raw`
   const c=require('node:child_process'),fs=require('node:fs');
   console.log('Target runtime:',process.version,c.execFileSync('ffprobe',['-version'],{encoding:'utf8'}).split('\n')[0]);
   for(const script of ${JSON.stringify(scripts)}){console.log('Checking',script);c.execFileSync(process.execPath,['scripts/'+script],{stdio:'inherit'});}
   try{console.log('Kernel cgroup memory peak:',(Number(fs.readFileSync('/sys/fs/cgroup/memory.peak','utf8'))/1024**2).toFixed(1),'MiB');}catch(_){console.log('Kernel memory.peak unavailable; sampled measurement only.');}
  `;
  docker('create','--name',app,'--network',id,'--memory','512m','--memory-swap','768m','--pids-limit','256','-e','ROOM_VIDEO_BROWSER_CHECK=0','-e','ROOM_TEST_DATABASE_URL=postgresql://postgres:'+password+'@db/media_release_test',image,'node','-e',code);application=true;docker('cp',__dirname+'/.',app+':/app/scripts');
  monitor=setInterval(async()=>{if(busy)return;busy=true;try{const {stdout}=await run('docker',['stats','--no-stream','--format','{{.MemUsage}}',app]);const m=/([\d.]+)([KMG]iB)/.exec(stdout);if(m)peak=Math.max(peak,Number(m[1])*({KiB:1/1024,MiB:1,GiB:1024}[m[2]]));}catch(_){}finally{busy=false;}},750);
  const {stdout,stderr}=await run('docker',['start','-a',app],{maxBuffer:4*1024*1024,timeout:180000});process.stdout.write(stdout);process.stderr.write(stderr);
  const state=JSON.parse(docker('inspect','--format','{{json .State}}',app));if(state.ExitCode!==0||state.OOMKilled)throw Error('Target runtime tests failed; exit '+state.ExitCode+', OOM='+state.OOMKilled);
  console.log('Target container peak sampled cgroup usage:',peak.toFixed(1),'MiB; limit 512 MiB. Browser decoding is outside this container.');
 }finally{
  clearInterval(monitor);if(application)docker('rm','-f','-v',app);if(postgres)docker('rm','-f','-v',pg);if(network)docker('network','rm',id);
  console.log('Disposable Docker containers, volumes and network removed.');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
