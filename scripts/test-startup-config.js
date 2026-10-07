const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {ConfigurationError,validateStartupConfiguration,adminConfigurationIssues,logStartupError}=require('../src/services/startupConfig');
const valid={DB_PASSWORD:'Fixture-private-password',WORLD_URL:'http://localhost:3002',ADMIN_USERNAME:'admin',ADMIN_PASSWORD:'Fixture-admin-password',PORT:'3002',DB_PORT:'5432',TRUST_PROXY:'false',BIND_ADDRESS:'127.0.0.1'};
validateStartupConfiguration(valid);
// Aggregate errors, so the operator can fix the configuration in one edit.
let missing;
try{validateStartupConfiguration({});}catch(error){missing=error;}
assert.equal(missing.code,'CONFIG_INVALID');
assert.deepEqual(missing.issues.map(issue=>issue.key),['DB_PASSWORD','WORLD_URL','ADMIN_USERNAME','ADMIN_PASSWORD']);
for(const value of ['not-a-url','ftp://example.org','http://user:PRIVATE_PASSWORD@example.org','https://example.org/path','https://example.org/?token=PRIVATE_TOKEN','https://example.org/#x']){
 assert.throws(()=>validateStartupConfiguration({...valid,WORLD_URL:value}),error=>error.issues.some(issue=>issue.key==='WORLD_URL'));
}
for(const key of ['PORT','HTTP_PORT','DB_PORT'])for(const value of ['0','65536','abc','3002.5','-1']){
 assert.throws(()=>validateStartupConfiguration({...valid,[key]:value}),error=>error.issues.some(issue=>issue.key===key));
}
assert.throws(()=>validateStartupConfiguration({...valid,BIND_ADDRESS:'wrong-host'}),ConfigurationError);
assert.throws(()=>validateStartupConfiguration({...valid,TRUST_PROXY:'maybe'}),ConfigurationError);
for (const value of ['true', 'false', '1', '2', '0', 'OFF']) validateStartupConfiguration({...valid,TRUST_PROXY:value});
assert.equal(adminConfigurationIssues(valid).length,0);
assert.equal(adminConfigurationIssues({...valid,ADMIN_PASSWORD:'short'}).length,1);
assert.equal(adminConfigurationIssues({...valid,ADMIN_PASSWORD:'😀'.repeat(11)}).length,1);
assert.equal(adminConfigurationIssues({...valid,ADMIN_PASSWORD:'😀'.repeat(12)}).length,0);
assert.equal(adminConfigurationIssues({...valid,ADMIN_PASSWORD:'я'.repeat(40)}).length,1);
assert.equal(adminConfigurationIssues({...valid,ADMIN_USERNAME:'x'.repeat(51)}).length,1);
// A bootstrap password is ignored once administrators already exist.
validateStartupConfiguration({...valid,ADMIN_PASSWORD:'short'});
for(const [code,key]of [['28P01','DB_PASSWORD'],['28000','DB_USER'],['3D000','DB_NAME'],['ECONNREFUSED','DB_HOST'],['ENOTFOUND','DB_HOST']]){
 const lines=[];logStartupError(Object.assign(new Error('PRIVATE_PASSWORD'),{code}),(...args)=>lines.push(args.join(' ')));
 assert(lines.join('\n').includes('[CONFIG] '+(key==='DB_USER'?'DB_PASSWORD':key)));
 assert(!lines.join('\n').includes('PRIVATE_PASSWORD'));
}
const startup=path.resolve(__dirname,'local-start.js');
let result=spawnSync(process.execPath,[startup],{encoding:'utf8',env:{...process.env,...valid,SIMPLE_DEPLOYMENT:'true',WORLD_URL:'https://user:PRIVATE_PASSWORD@example.org/path',DB_PORT:'wrong-port'}});
assert.equal(result.status,1);
assert(result.stderr.includes('[CONFIG] WORLD_URL:'));
assert(result.stderr.includes('[CONFIG] DB_PORT:'));
assert(!result.stderr.includes('PRIVATE_PASSWORD'));
assert(!result.stderr.includes('at Object.'));
// A corrupt persisted secrets file must never print its contents or be replaced.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'startup-config-check-'));
try{
 const file=path.join(dir,'secrets.json');const content='{"JWT_SECRET":"PRIVATE_SAVED_SECRET", BROKEN}';
 fs.writeFileSync(file,content);
 result=spawnSync(process.execPath,[startup],{encoding:'utf8',env:{...process.env,...valid,SIMPLE_DEPLOYMENT:'true',LOCAL_STATE_DIR:dir}});
 assert.equal(result.status,1);
 assert(result.stderr.includes('[CONFIG] LOCAL_STATE_DIR:'));
 assert(!result.stderr.includes('PRIVATE_SAVED_SECRET'));
 assert.equal(fs.readFileSync(file,'utf8'),content);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('Startup configuration: aggregate errors, safe logs, URL/port validation, bootstrap constraints and corrupt state handling: OK');
