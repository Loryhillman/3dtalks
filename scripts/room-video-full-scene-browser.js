/** Full shipped /play and GLB scene; HTTP/session metadata are explicit fixtures.
 * Real SQL/JWT/WS authorization is covered separately by check-room-video-presentation.
 */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {video}=require('./room-video-fixtures'),{parseRange}=require('../src/routes/roomMediaContent');
async function check(page){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'video-full-scene-'));
 try{
  const clip=await fs.readFile(video(dir,{duration:12,width:1920,height:1080,preset:'ultrafast'}));
  await page.route('**/api/rooms/fixture/presentation/materials/**/video/**',async route=>{
   const req=route.request();if(req.url().endsWith('/grant'))return route.fulfill({json:{contentPath:new URL(req.url()).pathname.replace('/grant','/content'),expiresInMs:60000}});
   const range=parseRange(req.headers().range,clip.length);if(!range)return route.fulfill({status:416,headers:{'Content-Range':'bytes */'+clip.length}});
   await route.fulfill({status:range.partial?206:200,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes',...(range.partial?{'Content-Range':`bytes ${range.start}-${range.end}/${clip.length}`}:{})},body:clip.subarray(range.start,range.end+1)});
  });
  await page.evaluate(()=>{
   window.fixtureVideos=[];const create=document.createElement.bind(document);
   document.createElement=(name,...args)=>{const el=create(name,...args);if(name.toLowerCase()==='video')fixtureVideos.push(el);return el;};
   const roomId=ACTIVE_ROOM.id,epoch='b1000000-0000-4000-8000-000000000001';
   RoomPresentation.message('ROOM_PRESENTATION_SESSION',{roomId,epoch,token:'a'.repeat(43),canControl:false});
   RoomPresentation.message('ROOM_PRESENTATION_CAPABILITIES_RESULT',{protocolVersion:2,features:{videoUpload:true,videoPlayback:true,pptxImport:false}});
   window.fixtureVideoState={protocolVersion:2,roomId,epoch,revision:'1',pageIndex:0,asset:{id:'c1000000-0000-4000-8000-000000000001',name:'Full scene video.mp4',kind:'video',durationMs:12000,width:1920,height:1080},playback:{status:'playing',positionMs:0,anchorServerTimeMs:Date.now()}};
   RoomPresentation.message('ROOM_PRESENTATION_STATE',fixtureVideoState);
  });
  await page.waitForFunction(()=>fixtureVideos.some(v=>v.readyState>=2&&!v.paused&&v.currentTime>.3));
  const pixels=()=>page.evaluate(()=>{const c=gameWorld.generatedBuildings.get(100).model.userData.screenCanvas;return [...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data];});
  const frame=await pixels();assert(frame[2]>frame[0]+50,JSON.stringify(frame));
  const frames=await page.evaluate(()=>gameWorld.frameCount);await page.waitForTimeout(400);assert(await page.evaluate(n=>gameWorld.frameCount>n,frames));
  await page.locator('#meeting-screen-preview').click();
  assert.equal(await page.locator('dialog .presentation-video-local').count(),1);
  const enlarged=await page.locator('dialog canvas').evaluate(c=>[...c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data]);assert(enlarged[2]>enlarged[0]+50);
  assert.equal(await page.evaluate(()=>fixtureVideos.filter(v=>v.getAttribute('src')).length),1);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{fixtureVideoState={...fixtureVideoState,revision:'2',playback:{status:'paused',positionMs:3000,anchorServerTimeMs:null}};RoomPresentation.message('ROOM_PRESENTATION_STATE',fixtureVideoState);});
  await page.waitForFunction(()=>fixtureVideos.some(v=>v.paused&&Math.abs(v.currentTime-3)<.15));
  await page.screenshot({path:'/tmp/meeting-full-scene-video.png'});
  console.log('Full GLB /play: 1080p native video, real office/avatars/render loop, screen/enlarged pixels, single decoder and pause/seek passed.');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
}
module.exports={check};
