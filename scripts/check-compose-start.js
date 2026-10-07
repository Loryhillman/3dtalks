// Default: validate Compose without starting services. --run: isolated Docker smoke check.
const {execFileSync}=require('node:child_process');
const {mkdtempSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {randomUUID,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
process.chdir(resolve(__dirname,'..'));
const dir=mkdtempSync(join(tmpdir(),'3dtalks-bootstrap-'));
const file=join(dir,'.env');
const project='bootstrapcheck-'+randomBytes(6).toString('hex');
const password=randomBytes(20).toString('hex');
const env={WORLD_URL:'http://localhost:3002',DB_PASSWORD:randomBytes(20).toString('hex'),ADMIN_USERNAME:'fixture-admin',ADMIN_PASSWORD:password,BIND_ADDRESS:'127.0.0.1',HTTP_PORT:'0'};
// Do not inherit deployment configuration or secrets from the caller's .env/shell.
const childEnv={...process.env};
for(const key of [...Object.keys(env),'COMPOSE_FILE','COMPOSE_PROJECT_NAME','COMPOSE_PROFILES','COMPOSE_ENV_FILES','COMPOSE_DISABLE_ENV_FILE','WORLD_NAME','TRUST_PROXY'])delete childEnv[key];
const dc=(args,options={})=>execFileSync('docker',['compose','--env-file',file,'-p',project,'-f','compose.yaml',...args],{env:childEnv,encoding:'utf8',...options});
function save(){writeFileSync(file,Object.entries(env).map(([k,v])=>k+'='+v).join('\n')+'\n',{mode:0o600});}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let started=false;
(async()=>{try{
 save();
 const config=JSON.parse(dc(['config','--format','json']));
 assert.deepEqual(Object.keys(config.services).sort(),['app','postgres']);
 assert.equal(config.services.app.environment.APP_MODE,'rooms');
 assert.equal(config.services.app.environment.DB_PASSWORD,config.services.postgres.environment.POSTGRES_PASSWORD);
 assert.equal(config.services.postgres.ports,undefined);
 assert.equal(config.services.app.volumes.length,8);
 for(const key of ['WORLD_URL','DB_PASSWORD','ADMIN_USERNAME','ADMIN_PASSWORD']){
  const value=env[key];env[key]='';save();
  let rejected=false;try{dc(['config','--quiet'],{stdio:'pipe'});}catch{rejected=true;}
  assert(rejected,'Compose must reject empty '+key);env[key]=value;
 }
 save();
 execFileSync('docker',['compose','--env-file',file,'-p',project,'-f','compose.yaml','-f','compose.dev.yaml','config','--quiet'],{env:childEnv,stdio:'pipe'});
 console.log('Compose: required settings, shared DB credentials, private database, data volumes and dev overlay: OK');
 if(!process.argv.includes('--run'))return;
 // All resources below belong exclusively to the randomly named test project.
 started=true;dc(['up','--build','-d'],{stdio:'inherit'});
 let base='http://'+dc(['port','app','3002']).trim();
 async function ready(){for(let i=0;i<90;i++){try{const r=await fetch(base+'/api/ready');if(r.ok)return;}catch{}await sleep(1000);}throw new Error('Isolated application did not become ready');}
 async function api(path,body,token){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert(response.ok,path+' returned '+response.status);return data;}
 await ready();
 const admin=await api('/api/admin-auth/login',{username:env.ADMIN_USERNAME,password});assert(admin.token);
 const {questions}=await api('/api/auth/security-questions');
 const user=await api('/api/auth/register',{username:'fixture-user',email:'fixture@example.invalid',password,securityQuestionId:questions[0].id,securityAnswer:'fixture'});
 const created=await api('/api/my/rooms',{name:'Fresh meeting',capacity:6,request_key:randomUUID()},user.token);
 assert.equal(created.room.status,'open');
 const before=await api('/api/my/rooms',null,user.token);assert.equal(before.quota.used,1);assert.equal(before.rooms[0].seat_count,6);
 // Recreating an app must preserve sessions, rooms and the original admin password.
 env.ADMIN_PASSWORD=randomBytes(20).toString('hex');save();
 dc(['up','-d','--no-deps','--force-recreate','app'],{stdio:'inherit'});base='http://'+dc(['port','app','3002']).trim();await ready();
 await api('/api/admin-auth/login',{username:env.ADMIN_USERNAME,password});
 const after=await api('/api/my/rooms',null,user.token);assert.equal(after.rooms[0].id,created.room.id);
 console.log('Fresh Docker installation: readiness, admin login, registration, six-seat room, retained data and secrets after recreation: OK');
}finally{
 try{if(started)dc(['down','-v','--remove-orphans'],{stdio:'inherit'});}finally{rmSync(dir,{recursive:true,force:true});}
}})().catch(error=>{console.error(error.message);process.exitCode=1;});
