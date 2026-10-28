const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
const Screen=require('../public/js/roomScreen');
const {validLayout}=require('../src/services/roomTemplateLayout');
const {publicationErrors}=require('../src/services/roomTemplateEditor');
const {check}=require('../public/js/roomPlacementCheck');
const clone=v=>JSON.parse(JSON.stringify(v));
const screen=Screen.create();
assert(Screen.validItem(screen));assert(validLayout([screen]));assert(!validLayout([screen,clone(screen)]));
const browser={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/roomScreen'),'utf8'),browser);
for(const change of [i=>i.scale.x=2,i=>i.rotation.x=.1,i=>i.collision=true,i=>i.model_id=1,
 i=>i.geometry_data={},i=>i.screen.width=.49,i=>i.screen.height=4.51,i=>i.screen.height=Infinity,
 i=>i.position.x=10001,i=>i.screen.extra=true,i=>i.position.extra=0,i=>i.seats=[{}],i=>delete i.rotation]){
 const i=clone(screen);change(i);assert.equal(Screen.validItem(i),false);assert.equal(browser.window.RoomScreen.validItem(i),false);assert(!validLayout([i]));
}
function dto(i){return {id:2,type:i.type,name:i.name,has_collision:i.collision,presentation_screen:i.screen,...Object.fromEntries(['position','rotation','scale'].flatMap(p=>['x','y','z'].map(a=>[p+'_'+a,i[p][a]])))};}
assert(Screen.validRuntime(dto(screen)));assert(!Screen.validRuntime({...dto(screen),model_path:'/bad.glb'}));
assert(!Screen.validRuntime({...dto(screen),geometry_data:{components:[{type:'box'}]}}));
const env={version:1,bounds:{min:{x:-4,y:0,z:-3},max:{x:4,y:3,z:3}}};
const room={type:'room_environment',kind:'room',name:'Office',collision:false,model_id:1,model_path:'/models/uploaded/office.glb',
 environment:env,position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1}};
const roomDTO={id:1,is_room_environment:true,room_environment:env,...Object.fromEntries(['position','rotation','scale'].flatMap(p=>['x','y','z'].map(a=>[p+'_'+a,room[p][a]])))};
for(const [x,y,yaw,outside] of [[0,1.5,0,false],[3,1.5,0,true],[3,1.5,Math.PI/2,false],[0,2.9,0,true],[2.405,1.5,0,false],[2.42,1.5,0,true]]){
 const i=clone(screen);i.position.x=x;i.position.y=y;i.rotation.y=yaw;
 assert.equal(check([roomDTO,dto(i)],[],()=>{}).some(e=>e.type==='objectOutside'),outside);
 assert.equal(publicationErrors([room,i],'office').some(e=>e.startsWith('Предмет находится')),outside);
}
assert.throws(()=>require('../public/js/roomObjectScale').apply([{...screen,editor_id:1},{...screen,editor_id:2}], [1,2],2));
assert(check([roomDTO,dto(screen)],[{object_id:2,enabled:true}],()=>({position:{x:0,y:1,z:0}})).some(e=>e.type==='invalidSeat'));
console.log('Screen contract: strict Node/browser validation, transforms, count, rotated corners, 1cm tolerance, scaling and seat-parent protection OK');
