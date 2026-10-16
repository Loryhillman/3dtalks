/** Opt-in live acceptance. Uploads demo materials to the supplied owner room.
 * Auth JSON: {room,owner:{token,userId,characterId},participant:{token,userId,characterId}}.
 * Use a dedicated temporary participant account. Tokens are never printed.
 */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),{randomUUID}=require('node:crypto');
const sharp=require('sharp'),{chromium}=require('playwright'),{pdf}=require('./room-media-fixtures');
let browser;
let stage='upload';
async function main(){
 const authFile=process.env.ROOM_LIVE_ACCEPTANCE_AUTH_FILE,base=process.env.ROOM_LIVE_ACCEPTANCE_URL;
 if(!authFile||!base)throw Error('Set ROOM_LIVE_ACCEPTANCE_AUTH_FILE and ROOM_LIVE_ACCEPTANCE_URL explicitly');
 const auth=JSON.parse(await fs.readFile(authFile,'utf8')),{room,owner,participant}=auth;
 const api=async(url,{actor=owner,method='GET',body,expected=200}={})=>{
  const form=body instanceof FormData;
  const response=await fetch(base+url,{method,headers:{Authorization:'Bearer '+actor.token,...(body&&!form?{'Content-Type':'application/json'}:{})},body:form?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify({url,status:response.status,code:data.code}));return data;
 };
 const prefix='/api/my/rooms/'+room.id+'/materials';
 const upload=async(bytes,kind,name)=>{
  const {upload}=await api(prefix+'/uploads',{method:'POST',expected:201,body:{requestId:randomUUID(),kind,name,bytes:bytes.length}});
  const form=new FormData();form.append('file',new Blob([bytes]),name);
  return (await api(prefix+'/uploads/'+upload.id+'/file',{method:'POST',body:form})).material;
 };
 const pdfAsset=await upload(pdf(),'pdf','Образец презентации — 2 слайда.pdf');
 const svg=Buffer.from('<svg width="1280" height="720"><rect width="1280" height="720" fill="#149fdc"/><rect x="70" y="70" width="1140" height="580" rx="24" fill="#183454"/><text x="150" y="290" fill="white" font-family="sans-serif" font-size="110">3DTalks</text><text x="150" y="430" fill="white" font-family="sans-serif" font-size="64">Image presentation</text></svg>');
 const imageBytes=await sharp(svg).png().toBuffer();const imageAsset=await upload(imageBytes,'image','Образец изображения.png');
 let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();try{await fs.access(executable);}catch(_){for(const n of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(n))executable='/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome';}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const errors=[],states={};
 async function pageFor(actor,key){
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.addInitScript(actor=>{for(const k of ['token','userId','characterId'])localStorage.setItem(k,actor[k]);},actor);
  const page=await context.newPage();page.on('pageerror',e=>errors.push({key,message:e.message}));
  page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(30000);
  page.on('websocket',socket=>socket.on('framereceived',event=>{try{const m=JSON.parse(event.payload);if(m.type==='ROOM_PRESENTATION_STATE')states[key]=m.payload;}catch(_){}}));
  return page;
 }
 const host=await pageFor(owner,'owner'),viewer=await pageFor(participant,'participant');
 stage='opening room';console.log('Live acceptance: materials uploaded; opening two browsers');
 const play=base+'/play?room='+room.slug;
 await host.goto(play);await viewer.goto(play);
 const ready=page=>page.waitForFunction(()=>window.RoomSeating?.active&&window.gameWorld&&[...gameWorld.generatedBuildings.values()].some(e=>e.data.type==='presentation_screen'));
 await ready(host);await ready(viewer);await host.locator('#presentation-manage').waitFor({state:'visible'});
 assert(await viewer.locator('#presentation-manage').isHidden());
 stage='show PDF';console.log('Live acceptance: both participants seated; starting PDF');
 const waitColor=(page,rgb)=>page.waitForFunction(rgb=>{
  const c=[...gameWorld.generatedBuildings.values()].find(e=>e.data.type==='presentation_screen')?.model.userData.screenCanvas;
  if(!c)return false;const p=c.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data;return rgb.every((v,i)=>Math.abs(p[i]-v)<15);
 },rgb,{timeout:30000});
 await host.locator('#presentation-manage').click();await host.locator('dialog select').selectOption(pdfAsset.id);await host.locator('dialog [data-command=show]').click();
 await Promise.all([waitColor(host,[255,0,0]),waitColor(viewer,[255,0,0])]);
 await host.locator('dialog [data-command=next]').click();await Promise.all([waitColor(host,[0,0,255]),waitColor(viewer,[0,0,255])]);
 await viewer.locator('#meeting-screen-preview').click();assert(await viewer.locator('dialog').isVisible());
 await host.locator('dialog [data-command=previous]').click();await waitColor(viewer,[255,0,0]);
 await viewer.waitForFunction(()=>{const c=document.querySelector('dialog canvas');return c?.getContext('2d').getImageData(c.width/2,c.height/2,1,1).data[0]===255;});await viewer.keyboard.press('Escape');
 await host.locator('dialog [data-command=next]').click();await waitColor(host,[0,0,255]);
 await viewer.reload();await ready(viewer);await waitColor(viewer,[0,0,255]);
 stage='authorization';console.log('Live acceptance: shared PDF pages and late join passed');
 const denied=await viewer.evaluate(({epoch,revision})=>new Promise((resolve,reject)=>{
  const requestId=crypto.getRandomValues(new Uint8Array(16));requestId[6]=(requestId[6]&15)|64;requestId[8]=(requestId[8]&63)|128;
  const hex=[...requestId].map(n=>n.toString(16).padStart(2,'0')).join(''),id=hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
  const timer=setTimeout(()=>{WSClient.ws.removeEventListener('message',receive);reject(Error('No RPC answer'));},10000);
  function receive(event){const m=JSON.parse(event.data);if(m.type==='ROOM_PRESENTATION_RESULT'&&m.payload.requestId===id){clearTimeout(timer);WSClient.ws.removeEventListener('message',receive);resolve(m.payload);}}
  WSClient.ws.addEventListener('message',receive);WSClient.ws.send(JSON.stringify({type:'ROOM_PRESENTATION_COMMAND',payload:{requestId:id,expectedEpoch:epoch,expectedRevision:revision,command:{type:'stop'}}}));
 }),states.owner);assert.equal(denied.code,'PRESENTATION_FORBIDDEN');
 await api('/api/rooms/'+room.slug+'/presentation/materials/'+pdfAsset.id+'/content',{actor:participant,expected:403});
 await host.locator('dialog select').selectOption(imageAsset.id);await host.locator('dialog [data-command=show]').click();
 stage='image';
 await host.waitForFunction(id=>document.querySelector('#presentation-status').textContent.includes('изображения'),imageAsset.id);
 await viewer.waitForFunction(()=>document.querySelector('#presentation-status').textContent.includes('изображения'));
 const active=await api(prefix+'/'+imageAsset.id,{method:'DELETE',expected:409});assert.equal(active.code,'MATERIAL_IN_USE');
 await api(prefix+'/'+imageAsset.id,{method:'DELETE',body:{stopShowing:true,requestId:randomUUID(),expectedEpoch:active.state.epoch,expectedRevision:active.state.revision}});
 await viewer.waitForFunction(()=>document.querySelector('#presentation-status').textContent===i18n.t('roomPresentation.idle'));
 const keptImage=await upload(imageBytes,'image','Образец изображения.png');
 await host.locator('dialog select').selectOption(pdfAsset.id);await host.locator('dialog [data-command=show]').click();await waitColor(host,[255,0,0]);
 await host.keyboard.press('Escape');
 const other=(await api('/api/my/rooms',{actor:participant,method:'POST',expected:201,body:{name:'Temporary presentation acceptance',capacity:6,request_key:randomUUID()}})).room;
 await viewer.goto(base+'/play?room='+other.slug);await ready(viewer);
 await viewer.waitForFunction(()=>document.querySelector('#presentation-status').textContent===i18n.t('roomPresentation.idle'));
 assert.equal(states.participant.roomId,other.id);assert.equal(states.participant.asset,null);
 await api('/api/rooms/'+other.slug+'/presentation/materials/'+pdfAsset.id+'/content',{actor:participant,expected:403});
 await api('/api/my/rooms/'+other.id,{actor:participant,method:'DELETE',body:{revision:other.revision}});
 await host.locator('#meeting-screen-preview').click();
 if(process.env.ROOM_LIVE_ACCEPTANCE_SCREENSHOT)await host.screenshot({path:process.env.ROOM_LIVE_ACCEPTANCE_SCREENSHOT});
 await host.keyboard.press('Escape');
 assert.deepEqual(errors,[]);
 const result={roomId:room.id,slug:room.slug,pdfId:pdfAsset.id,imageId:keptImage.id,qaRoomId:other.id};
 if(process.env.ROOM_LIVE_ACCEPTANCE_RESULT)await fs.writeFile(process.env.ROOM_LIVE_ACCEPTANCE_RESULT,JSON.stringify(result));
 console.log('Live site: two real browser accounts + HTTP/WS/PostgreSQL, upload PDF/image, shared pages, live preview, reload/late join, owner authorization, confirmed active deletion and second-room isolation OK');
 console.log(JSON.stringify(result));
}
main().catch(e=>{console.error('Live acceptance failed at '+stage);console.error(e);process.exitCode=1;}).finally(()=>browser?.close());
