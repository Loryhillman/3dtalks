const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = { console, URL, performance: { now: () => 0 } };context.window=context;
vm.createContext(context);
for(const file of ['lib/three.min.js','avatarBase.js','userAvatarRenderer.js','meetingParticipants.js']){
 vm.runInContext(fs.readFileSync(require.resolve('../public/js/'+file),'utf8'),context);
}
const THREE=context.THREE;
const world={scene:new THREE.Scene(),players:new Map(),createNameSprite:()=>new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.Texture()}))};
const manager=new context.MeetingParticipants(world);
function track(root){
 const resources=new Set();root.traverse(node=>{
  if(node.geometry&&!node.isSprite)resources.add(node.geometry);
  for(const material of [].concat(node.material||[])){
   resources.add(material);for(const value of Object.values(material))if(value?.isTexture)resources.add(value);
  }
 });
 const counts=new Map();for(const resource of resources){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
 return ()=>{for(const count of counts.values())assert.equal(count,1,'shared avatar resources released exactly once');};
}
(async()=>{
 const group=manager.add('me','Me',{x:1,y:2,z:3},{mode:'standard',headType:'sphere',bodyColor:'#445566',headColor:'#ffaa99'});
 assert.equal(world.players.get('me').health,undefined);
 assert.equal(group.userData.weaponConfig,undefined);
 assert.equal(group.userData.laserSword,undefined);
 assert.equal(group.userData.accountAvatarConfig.headType,'sphere');
 let sharedSpriteDisposals=0;world.players.get('me').nameSprite.geometry.addEventListener('dispose',()=>sharedSpriteDisposals++);
 const oldLabel=world.players.get('me').nameSprite,oldLabelCheck=track(oldLabel);
 oldLabel.position.y=3.5;manager.rename('me','Renamed');oldLabelCheck();
 assert.equal(world.players.get('me').nameSprite.position.y,3.5);
 assert.equal(sharedSpriteDisposals,0,'renaming one participant must preserve shared sprite geometry');
 const check=track(group);manager.remove('me');manager.remove('me');check();
 assert.equal(world.scene.children.length,0);assert.equal(sharedSpriteDisposals,0);
 // A GLB finishing after departure must be disposed, never restored to the scene.
 let finish;THREE.GLTFLoader=class {loadAsync(){return new Promise(resolve=>{finish=resolve;});}};
 const pending=manager.add('pending','Pending',{x:0,y:1,z:0});
 const apply=context.UserAvatarRenderer.apply(pending,{mode:'full',asset:{path:'/avatar.glb'}});
 const loaded=new THREE.Group();loaded.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));
 const lateCheck=track(loaded);
 manager.remove('pending');finish({scene:loaded});await apply;lateCheck();
 assert.equal(world.players.has('pending'),false);assert.equal(world.scene.children.length,0);
 // Reusing an ID releases the preceding participant and keeps only its replacement.
 const replaced=manager.add('peer','Peer',{x:0,y:1,z:0});const replacedCheck=track(replaced);
 manager.add('peer','New peer',{x:2,y:1,z:0});replacedCheck();
 assert.equal(world.players.size,1);assert.equal(world.scene.children.length,1);
 manager.clear();assert.equal(world.players.size,0);assert.equal(world.scene.children.length,0);
 console.log('Meeting participants: account avatar, name replacement, shared GPU disposal, late GLB, ID replacement and complete clear OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
