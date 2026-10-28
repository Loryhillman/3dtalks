const assert=require('node:assert/strict'),{parseRange}=require('../src/routes/roomMediaContent'),{createRoomVideoGrants}=require('../src/services/roomVideoGrants');
(async()=>{
 assert.deepEqual(parseRange('bytes=0-9',100),{start:0,end:9,partial:true});assert.deepEqual(parseRange('bytes=90-',100),{start:90,end:99,partial:true});assert.deepEqual(parseRange('bytes=-10',100),{start:90,end:99,partial:true});assert.deepEqual(parseRange('bytes=0-1000',100),{start:0,end:99,partial:true});
 for(const value of ['bytes=100-','bytes=10-9','bytes=-0','bytes=-','bytes=0-1,2-3','bytes=0-9007199254740992','bytes=Infinity-','items=0-1','bytes='+('1'.repeat(110))+'-'])assert.equal(parseRange(value,100),null,value);
 let now=100,aborts=0,releases=0,authorized=0,resolve;const actor={userId:'owner',roomId:'room',assetId:'asset'};
 const store=createRoomVideoGrants(async()=>{authorized++;return {mime:'video/mp4',abort:()=>aborts++,release:()=>releases++};},{now:()=>now,ttlMs:1000});
 try{
  const grant=await store.issue(actor),first=await store.read(grant.token,actor);assert.equal(authorized,2);
  now=500;assert.equal((await store.issue(actor)).token,grant.token);assert.equal(aborts,0,'renewal does not interrupt current video');
  await assert.rejects(store.read(grant.token,{...actor,roomId:'other'}),e=>e.status===403);
  now=1501;await assert.rejects(store.read(grant.token,actor),e=>e.code==='VIDEO_GRANT_EXPIRED');assert.equal(aborts,1);first.release();
  const other=await store.issue(actor);const lease=await store.read(other.token,actor);store.revokeAsset(actor.assetId);assert.equal(aborts,2);lease.release();await assert.rejects(store.read(other.token,actor),e=>e.status===403);
  const retry=await store.issue(actor);for(let i=0;i<119;i++)(await store.read(retry.token,actor)).release();(await store.read(retry.token,actor)).release();await assert.rejects(store.read(retry.token,actor),e=>e.status===429);
 }finally{store.close();}
 const raced=createRoomVideoGrants(async()=>{if(!resolve)return {abort(){},release(){}};await new Promise(r=>resolve=r);return {abort:()=>aborts++,release:()=>releases++};});
 try{const grant=await raced.issue(actor);resolve=true;const pending=raced.read(grant.token,actor);await new Promise(r=>setImmediate(r));raced.revokeRoom(actor.roomId);resolve();await assert.rejects(pending,e=>e.status===403);}finally{raced.close();}
 console.log('Video grants/ranges: bounded ranges, scope/expiry/renewal/revocation/rate and late authorization cleanup passed.');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
