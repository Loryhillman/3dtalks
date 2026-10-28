/** Explicit isolated Docker gate; never touches the working Compose stack. */
const {execFileSync,execFile}=require('node:child_process'),{promisify}=require('node:util'),{randomBytes}=require('node:crypto');
const run=promisify(execFile),docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function main(){
 const stress=process.argv.includes('--stress');
 const id='3dtalks-pptx-gate-'+randomBytes(5).toString('hex'),pg=id+'-pg',app=id+'-app',worker=id+'-worker',password=randomBytes(20).toString('hex');
 let network=false,volume=false,faults;const created=[];
 try{
  console.log('Docker memory/swap limit support:',docker('info','--format','{{.MemoryLimit}} {{.SwapLimit}}'));
  docker('image','inspect','3dtalks:pptx-gate-app');docker('image','inspect','3dtalks:pptx-worker');
  docker('network','create',id);network=true;
  docker('volume','create','--driver','local','--opt','type=tmpfs','--opt','device=tmpfs','--opt','o=size=128m,uid=1000,gid=1000,mode=0700',id);volume=true;
  docker('create','--name',pg,'--network',id,'--network-alias','db','--memory','256m','--pids-limit','128','-e','POSTGRES_PASSWORD='+password,'-e','POSTGRES_DB=pptx_gate','postgres:18');created.push(pg);docker('start',pg);
  for(let n=0;n<60;n++){try{docker('exec',pg,'pg_isready','-U','postgres','-d','pptx_gate');break;}catch(e){if(n===59)throw Error('Temporary PostgreSQL unavailable');await new Promise(r=>setTimeout(r,300));}}
  docker('create','--name',worker,'--user','1000:1000','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','384m','--memory-swap','384m','--cpus','.75','--pids-limit','64',...(stress?['--ulimit','memlock=671088640:671088640']:[]),'--tmpfs','/tmp:size=128m,mode=1777','--mount','type=volume,source='+id+',target=/spool','3dtalks:pptx-worker');created.push(worker);docker('start',worker);
  const security=JSON.parse(docker('inspect',worker))[0];if(security.HostConfig.NetworkMode!=='none'||!security.HostConfig.ReadonlyRootfs||security.Config.User!=='1000:1000'||security.HostConfig.Memory!==384*1024**2||security.HostConfig.PidsLimit!==64||!security.HostConfig.CapDrop.includes('ALL')||!security.HostConfig.SecurityOpt.includes('no-new-privileges:true'))throw Error('Converter isolation mismatch');
  const code=String.raw`const c=require('node:child_process');for(const name of ['check-room-pptx.js','check-room-media.js','check-room-media-v2-postgres.js','check-room-presentation.js'])c.execFileSync(process.execPath,['scripts/'+name],{stdio:'inherit'});console.log('App cgroup peak MiB:',Number(require('fs').readFileSync('/sys/fs/cgroup/memory.peak','utf8'))/1024**2);`;
  docker('create','--name',app,'--memory','512m','--memory-swap','768m','--pids-limit','256','--network',id,'--mount','type=volume,source='+id+',target=/app/pptx-spool','-e','ROOM_PPTX_STRESS_CHECK='+(stress?'1':'0'),'-e','ROOM_PPTX_STRESS_FIXTURES=/tmp/pptx-stress','-e','ROOM_PPTX_SPOOL=/app/pptx-spool','-e','ROOM_TEST_DATABASE_URL=postgresql://postgres:'+password+'@db/pptx_gate','3dtalks:pptx-gate-app','node','-e',code);created.push(app);
  // Test scripts only. Runtime modules/dependencies always come from the image.
  docker('cp',__dirname+'/.',app+':/app/scripts');
  if(stress)docker('cp',process.env.ROOM_PPTX_STRESS_FIXTURES||'/tmp/3dtalks-pptx-stress-fixtures',app+':/tmp/pptx-stress');
  if(stress)faults=require('./room-pptx-fault-control.cjs').start({app,worker,pg});
  const result=await run('docker',['start','-a',app],{maxBuffer:4*1024**2,timeout:240000});process.stdout.write(result.stdout);process.stderr.write(result.stderr);
  const state=JSON.parse(docker('inspect','--format','{{json .State}}',app));if(state.ExitCode||state.OOMKilled)throw Error('Application gate failed');
  if(process.env.ROOM_PPTX_TEST_ARTIFACT)docker('cp',app+':/tmp/pptx-converted-fixture.pdf',process.env.ROOM_PPTX_TEST_ARTIFACT);
  console.log('Worker cgroup peak MiB:',Number(docker('exec',worker,'cat','/sys/fs/cgroup/memory.peak'))/1024**2);
  docker('exec',worker,'python3','-c',`from pathlib import Path
active=[]
for p in Path('/proc').glob('[0-9]*/cmdline'):
 try:
  a=p.read_bytes().split(bytes([0]))
  if a[0].endswith(b'soffice.bin') or len(a)>2 and a[1].endswith(b'worker.py') and a[2]==b'--job': active.append(p.parent.name)
 except FileNotFoundError: pass
assert not active, active
profiles=Path('/tmp/pptx-jobs')
assert not profiles.exists() or not list(profiles.iterdir())
print('No converter descendants or per-job profiles remained after success/rejection/cancel.')`);
  console.log('Converter isolation: nonroot, network=none, read-only root, no capabilities/privilege escalation, bounded tmpfs/memory/pids/CPU; passed.');
 }finally{
  await faults?.stop();
  for(const name of created.reverse())docker('rm','-f','-v',name);
  if(volume)docker('volume','rm',id);if(network)docker('network','rm',id);
  console.log('Only temporary PPTX gate containers, volumes and network removed.');
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
