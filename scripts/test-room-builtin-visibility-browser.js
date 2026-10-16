/** Actual shipped GLB triangles and screen, viewed from all six seated eye positions. */
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const express=require('express'),{chromium}=require('playwright');
const {readBundle}=require('../src/services/roomBuiltinBundle'),{roomSeatPose}=require('../src/services/roomSeatPose');
let browser,server;
(async()=>{try{
 const bundle=await readBundle(),app=express();
 for(const asset of bundle.assets)app.get(asset.runtimePath,(_q,s)=>s.type('model/gltf-binary').send(asset.data));
 app.get('/fixture',(_q,s)=>s.send(`<!doctype html><body style="margin:0;background:#111;color:white;font:16px sans-serif">
 <script src="/js/lib/three.min.js"></script><script src="/js/lib/GLTFLoader.js"></script>
 <script src="/js/roomScreen.js"></script><script src="/js/roomScreenRenderer.js"></script></body>`));
 app.use(express.static(path.resolve(__dirname,'../public')));server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 let executable=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath();try{await fs.access(executable);}catch(_){for(const n of await fs.readdir('/root/.cache/ms-playwright'))if(/^chromium-\d+$/.test(n))executable='/root/.cache/ms-playwright/'+n+'/chrome-linux64/chrome';}
 browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1200,height:1170}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/fixture');
 const seats=bundle.layout.flatMap(item=>(item.seats||[]).map(seat=>({label:seat.label,...roomSeatPose(seat,Object.fromEntries(['position','rotation','scale'].flatMap(p=>['x','y','z'].map(a=>[p+'_'+a,item[p][a]]))))})));
 const result=await page.evaluate(async({layout,seats})=>{
  const scene=new THREE.Scene();scene.background=new THREE.Color('#9bb6c8');scene.add(new THREE.AmbientLight(0xffffff,2));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,6,3);scene.add(light);
  const loader=new THREE.GLTFLoader(),meshes=[];let screen;
  for(const item of layout){
   const model=item.type==='presentation_screen'?RoomScreenRenderer.create(item.screen):(await loader.loadAsync(item.model_path)).scene;
   model.position.set(...['x','y','z'].map(a=>item.position[a]));model.rotation.set(...['x','y','z'].map(a=>item.rotation[a]));model.scale.set(...['x','y','z'].map(a=>item.scale[a]));scene.add(model);
   model.traverse(m=>{if(m.isMesh){m.userData.fixtureName=item.name;if(item.type!=='presentation_screen')meshes.push(m);}});
   if(item.type==='presentation_screen')screen=model;
  }
  scene.updateMatrixWorld(true);
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(600,360);renderer.setPixelRatio(1);
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#183454';ctx.font='bold 100px sans-serif';ctx.fillText('3DTalks',140,200);
  ctx.font='70px sans-serif';ctx.fillText('PDF / Images',140,350);ctx.fillText('1  2  3  4  5  6',140,510);
  screen.userData.presentation.draw(canvas);
  const metadata=layout.find(i=>i.type==='presentation_screen').screen;
  const target=screen.position.clone(),normal=new THREE.Vector3(0,0,1).applyQuaternion(screen.quaternion);
  const rows=[];document.body.style.display='grid';document.body.style.gridTemplateColumns='600px 600px';
  for(const seat of seats){
   // Runtime first-person camera fallback is seat.position + (0,1.6,0).
   const eye=new THREE.Vector3(seat.position.x,seat.position.y+1.6,seat.position.z);
   const camera=new THREE.PerspectiveCamera(75,600/360,.1,1000);camera.position.copy(eye);camera.lookAt(target);camera.updateMatrixWorld(true);
   const occluded=[],ndc=[];let minDistance=Infinity;
   for(const x of [-.5,0,.5])for(const y of [-.5,0,.5]){
    const point=new THREE.Vector3(x*metadata.width,y*metadata.height,.026).applyMatrix4(screen.matrixWorld),direction=point.clone().sub(eye),distance=direction.length();minDistance=Math.min(minDistance,distance);
    const ray=new THREE.Raycaster(eye,direction.normalize(),.05,distance-.035);
    const hits=ray.intersectObjects(meshes,false).filter(hit=>{const material=Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex]:hit.object.material;return material.visible&&(!material.transparent||material.opacity>.9);});
    if(hits.length)occluded.push({point:[x,y],object:hits[0].object.userData.fixtureName,mesh:hits[0].object.name,distance:hits[0].distance});
    ndc.push(point.clone().project(camera).toArray());
   }
   renderer.render(scene,camera);const cell=document.createElement('div'),title=document.createElement('div'),copy=document.createElement('canvas');
   title.textContent='Seat '+seat.label+' · look towards screen';title.style.padding='8px';copy.width=600;copy.height=360;copy.getContext('2d').drawImage(renderer.domElement,0,0);cell.append(title,copy);document.body.append(cell);
   rows.push({label:seat.label,eye:eye.toArray(),front:eye.clone().sub(target).dot(normal)>0,occluded,ndc,minDistance});
  }
  renderer.dispose();return rows;
 },{layout:bundle.layout,seats});
 if(process.env.ROOM_SCREEN_V2_SCREENSHOT)await page.screenshot({path:process.env.ROOM_SCREEN_V2_SCREENSHOT,fullPage:true});
 for(const row of result){assert(row.front,'seat '+row.label+' faces the opaque back');assert.deepEqual(row.occluded,[],'screen occluded from seat '+row.label);assert(row.ndc.every(p=>Math.abs(p[0])<1&&Math.abs(p[1])<1&&p[2]>-1&&p[2]<1),'screen outside view at seat '+row.label);}
 assert.deepEqual(errors,[]);console.log('Built-in v2 Chromium: actual GLB scene, screen front and 9 visible canvas samples from all six seated eye positions OK');
 console.log(JSON.stringify(result.map(({label,eye,minDistance})=>({label,eye,minDistance}))));
}finally{await browser?.close();await new Promise(r=>server?server.close(r):r());}})().catch(e=>{console.error(e);process.exitCode=1;});
