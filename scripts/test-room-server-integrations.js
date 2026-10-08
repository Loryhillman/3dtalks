const assert=require('node:assert/strict'),http=require('node:http'),Module=require('node:module');
const express=require('express');
const integrations=require('../src/services/worldIntegrations');
const originalMode=process.env.APP_MODE;
let server;
async function serve(app) {server=http.createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
async function close(){await new Promise(r=>server.close(r));server=null;}
(async()=>{
 process.env.APP_MODE='rooms';let imports=0;
 const neverLoad=()=>{imports++;throw Error('An optional world module must not load in rooms mode');};
 const app=express();integrations.registerWorldIntegrations(app,neverLoad);integrations.registerLegacyGameRoutes(app,neverLoad);
 await integrations.initializeWorldFederation(neverLoad);integrations.startWorldBackgroundServices(neverLoad);
 const base=await serve(app);
 for(const route of ['/api/world/objects','/api/shop','/api/plot','/api/skills','/api/monster','/api/portal','/api/inventory','/api/npc','/api/custom-npc','/api/character-templates','/api/public/character-templates','/api/federation/info','/api/federation/teleport','/api/agent/v1/session','/api/agent/federation/handoff','/.well-known/virtual-world-agent.json']){
  for(const method of ['GET','POST']){const response=await fetch(base+route,{method});assert.equal(response.status,404);assert.equal((await response.json()).code,'FEATURE_UNAVAILABLE');}
 }
 assert.equal(imports,0,'disabled HTTP routes and services do not import legacy modules');await close();
 process.env.APP_MODE='world';const calls=[];
 const router=express.Router();router.use((_req,res)=>res.json({success:true}));
 const load=name=>{
  calls.push(name);
  if(name==='../middleware/worldWriteGuard')return {worldWriteGuard:(_req,_res,next)=>next()};
  if(name==='../routes/federation')return {router,initFederation:async()=>calls.push('federation started')};
  if(name==='../routes/agent/meta')return {buildWellKnown:async()=>({enabled:true})};
  if(name==='../websocket/agentWsServer')return {start:()=>calls.push('agent started')};
  if(name==='./chatArchiveService')return {startArchiveLoop:()=>calls.push('archive started')};
  return router;
 };
 const legacy=express();integrations.registerWorldIntegrations(legacy,load);integrations.registerLegacyGameRoutes(legacy,load);await integrations.initializeWorldFederation(load);integrations.startWorldBackgroundServices(load);
 const legacyBase=await serve(legacy);assert.equal((await fetch(legacyBase+'/api/federation/info')).status,200);assert.equal((await fetch(legacyBase+'/api/world/objects')).status,200);assert.equal((await fetch(legacyBase+'/api/npc')).status,200);assert.deepEqual(await(await fetch(legacyBase+'/.well-known/virtual-world-agent.json')).json(),{enabled:true});
 for(const label of ['federation started','agent started','archive started'])assert(calls.includes(label));await close();
 // Verify protocol routing: disabled agent sockets must never fall through to
 // the human server; root and /ws human paths remain supported in both modes.
 let agentUpgrades=0,humanUpgrades=0;
 const original=Module._load;
 Module._load=function(name,parent,...args){
  if(parent?.filename.endsWith('/websocket/upgradeRouter.js')){
   if(name==='./agentWsServer')return {handleUpgrade:()=>agentUpgrades++};
   if(name==='./wsServer')return {getWss:()=>({handleUpgrade(_r,_s,_h,fn){humanUpgrades++;fn({});},emit(){}})};
  }
  return original(name,parent,...args);
 };
 const upgrade=require('../src/websocket/upgradeRouter');
 try{
  process.env.APP_MODE='rooms';let response='',destroyed=false;
  upgrade({url:'/ws/agent'},{write:text=>response+=text,destroy:()=>destroyed=true},Buffer.alloc(0));
  assert(response.startsWith('HTTP/1.1 404'));assert(destroyed);assert.equal(agentUpgrades,0);
  for(const url of ['/','/ws','/ws?room=fixture'])upgrade({url},{destroy(){throw Error('Human WS rejected');}},Buffer.alloc(0));
  assert.equal(humanUpgrades,3);
  process.env.APP_MODE='world';upgrade({url:'/ws/agent'},{},Buffer.alloc(0));assert.equal(agentUpgrades,1);
 }finally{Module._load=original;}
 // Room character loading keeps the client response shape without querying RPG tables.
 const queries=[];
 Module._load=function(name,parent,...args){
  if(parent?.filename.endsWith('/routes/users.js')||parent?.filename.endsWith('/middleware/auth.js')){
   if(name==='../database/db')return {query:async sql=>{queries.push(sql);return {rows:sql.includes('SELECT c.*')?[{id:'character',name:'Fixture'}]:sql.includes('character_appearance')?[]:sql.includes('equipment')?[{equipment_name:'Sword'}]:[{skill_name:'Attack'}]};}};
  }
  return original(name,parent,...args);
 };
 let users;
 try { users=require('../src/routes/users'); } finally {Module._load=original;}
 const characterApp=express();characterApp.use('/api/users',users);const characterBase=await serve(characterApp);
 process.env.APP_MODE='rooms';let response=await fetch(characterBase+'/api/users/character/character');assert.equal(response.status,200);
 let data=await response.json();assert.deepEqual(data.equipment,[]);assert.deepEqual(data.skills,[]);assert(!queries.some(sql=>/FROM (equipment|skills)/.test(sql)));
 process.env.APP_MODE='world';response=await fetch(characterBase+'/api/users/character/character');data=await response.json();assert.equal(data.equipment[0].equipment_name,'Sword');assert.equal(data.skills[0].skill_name,'Attack');await close();
 console.log('Room server: disabled integration HTTP/WS endpoints and lazy imports; preserved human sockets and legacy world services OK');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(server)await close();if(originalMode===undefined)delete process.env.APP_MODE;else process.env.APP_MODE=originalMode;});
