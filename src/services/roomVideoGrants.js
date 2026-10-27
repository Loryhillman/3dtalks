const {randomBytes}=require('node:crypto');
const fail=(code,status=403)=>{throw Object.assign(new Error(code),{code,status});};
function createRoomVideoGrants(authorize,{ttlMs=60000,maxGrants=1000,now=Date.now}={}){
 const grants=new Map();let timer,closed=false;
 const scope=(a,b)=>a.roomId===b.roomId&&a.assetId===b.assetId;
 function revoke(token,g){grants.delete(token);for(const lease of g.leases)lease.abort();g.leases.clear();}
 function sweep(){for(const [token,g] of grants)if(g.expires<=now())revoke(token,g);}
 async function issue(actor){
  if(closed)fail('VIDEO_UNAVAILABLE',503);sweep();
  const lease=await authorize(actor);lease.release();
  if(closed)fail('VIDEO_UNAVAILABLE',503);
  // Authenticated renewal preserves the existing stream and cookie token.
  let prior=[...grants.entries()].find(([,g])=>g.userId===actor.userId&&scope(g,actor));
  if(prior){const g=prior[1];if(now()-g.issueWindow>=60000){g.issueWindow=now();g.issues=0;}if(++g.issues>30)fail('VIDEO_GRANT_BUSY',429);g.expires=now()+ttlMs;return {token:prior[0],ttlMs};}
  if(grants.size>=maxGrants||[...grants.values()].filter(g=>g.userId===actor.userId).length>=20)fail('VIDEO_GRANT_BUSY',429);
  const token=randomBytes(32).toString('base64url');grants.set(token,{...actor,expires:now()+ttlMs,leases:new Set(),issueWindow:now(),issues:1,readWindow:now(),reads:0});
  if(!timer){timer=setInterval(sweep,Math.min(ttlMs,1000));timer.unref();}
  return {token,ttlMs};
 }
 async function read(token,actor){
  sweep();const g=typeof token==='string'&&/^[a-zA-Z0-9_-]{43}$/.test(token)&&grants.get(token);
  if(closed||!g||!scope(g,actor))fail('VIDEO_GRANT_EXPIRED');
  if(now()-g.readWindow>=60000){g.readWindow=now();g.reads=0;}if(++g.reads>120)fail('VIDEO_GRANT_BUSY',429);
  const lease=await authorize(g);
  if(closed||grants.get(token)!==g||g.expires<=now()){lease.abort();lease.release();fail('VIDEO_GRANT_EXPIRED');}
  const release=lease.release;lease.release=()=>{g.leases.delete(lease);release();};g.leases.add(lease);return lease;
 }
 return {issue,read,revokeAsset(assetId){for(const [t,g] of grants)if(g.assetId===assetId)revoke(t,g);},
  revokeRoom(roomId){for(const [t,g] of grants)if(g.roomId===roomId)revoke(t,g);},
  close(){closed=true;clearInterval(timer);for(const [t,g] of grants)revoke(t,g);}};
}
module.exports={createRoomVideoGrants};
