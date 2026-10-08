/* Account avatars use their own loader, independent of legacy RPG templates. */
(() => {
  function dispose(root) {
    const textures=new Set(),skeletons=new Set(),geometries=new Set(),materials=new Set();
    root?.traverse(node=>{
      // THREE.Sprite geometry is shared by all sprites, including other participants.
      if(node.geometry && !node.isSprite)geometries.add(node.geometry);
      if(node.skeleton)skeletons.add(node.skeleton);
      for(const material of [].concat(node.material||[])){
        for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
        materials.add(material);
      }
    });
    geometries.forEach(geometry=>geometry.dispose());
    materials.forEach(material=>material.dispose());
    textures.forEach(texture=>texture.dispose());
    skeletons.forEach(skeleton=>skeleton.dispose());
  }
  function normalize(model,target){
    model.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());
    const dimension=target==='head'?Math.max(size.x,size.y,size.z):size.y;
    if(!Number.isFinite(dimension)||dimension<1e-6)throw new Error('INVALID_GLB');
    model.scale.multiplyScalar((target==='head'?.8:2.8)/dimension);
    model.updateMatrixWorld(true);
    const fitted=new THREE.Box3().setFromObject(model),center=fitted.getCenter(new THREE.Vector3());
    model.position.sub(center);
  }
  async function apply(group,config){
    const data=group.userData;
    const signature=JSON.stringify(config);
    if(data.accountAvatarSignature===signature)return;
    data.accountAvatarSignature=signature;
    const ticket=(data.accountAvatarTicket||0)+1;data.accountAvatarTicket=ticket;
    data.accountAvatarConfig=config;
    data.accountAvatarError=null;
    if(data.accountAvatarRoot){group.remove(data.accountAvatarRoot);dispose(data.accountAvatarRoot);}
    delete data.glbModel;delete data.roomSeatRig;
    data.seatFallbackParts?.forEach(part=>{part.visible=true;});
    if(data.defaultSeatHead){
      data.seatHead=data.defaultSeatHead;data.defaultSeatHead.visible=true;
      if(data.seatFallbackParts)data.seatFallbackParts[1]=data.defaultSeatHead;
    }
    if(!config||config.mode!=='full'&&config.mode!=='standard')return;
    const root=new THREE.Group();data.accountAvatarRoot=root;group.add(root);
    try{
      if(config.mode==='full'){
        const gltf=await new THREE.GLTFLoader().loadAsync(config.asset.path);
        if(data.accountAvatarTicket!==ticket||!root.parent){dispose(gltf.scene);return;}
        normalize(gltf.scene,'body');gltf.scene.rotation.y=(config.bodyYaw||0)*Math.PI/180;
        root.add(gltf.scene);data.glbModel=root;data.boneMap=config.asset.boneMap||{};
        data.seatFallbackParts?.forEach(part=>{part.visible=false;});
        return;
      }
      // Paint only the original body, never recolor a loaded head's materials.
      for(const part of data.seatFallbackParts||[])if(part!==data.defaultSeatHead)part.traverse(node=>{
        for(const material of [].concat(node.material||[]))material.color?.set(config.bodyColor);
      });
      root.position.set(0,1.2+(config.headOffset||0),0);
      const content=new THREE.Group();root.add(content);content.scale.setScalar(config.headScale||1);content.rotation.y=(config.headYaw||0)*Math.PI/180;
      const material=new THREE.MeshStandardMaterial({color:config.headColor||'#ffaa99',roughness:.8});
      if(config.headType==='model'){
        const gltf=await new THREE.GLTFLoader().loadAsync(config.asset.path);
        if(data.accountAvatarTicket!==ticket||!root.parent){material.dispose();dispose(gltf.scene);return;}
        normalize(gltf.scene,'head');content.add(gltf.scene);material.dispose();
      }else{
        const geometry=config.headType==='image'?new THREE.PlaneGeometry(.8,.8):config.headType==='cube'?new THREE.BoxGeometry(.7,.7,.7):new THREE.SphereGeometry(.4,24,16);
        content.add(new THREE.Mesh(geometry,material));
        if(config.headType==='image')material.side=THREE.DoubleSide;
        if(config.asset?.path){
          const texture=await new THREE.TextureLoader().loadAsync(config.asset.path);
          if(data.accountAvatarTicket!==ticket||!root.parent){texture.dispose();return;}
          texture.colorSpace=THREE.SRGBColorSpace;
          // A photograph stays on a front-facing plane rather than wrapping
          // around a sphere or repeating on the cube's six faces.
          if(config.headType==='image'){material.map=texture;material.color.set('#ffffff');material.needsUpdate=true;}
          else{
            const faceMaterial=new THREE.MeshStandardMaterial({map:texture,side:THREE.DoubleSide});
            const face=new THREE.Mesh(new THREE.PlaneGeometry(.56,.56),faceMaterial);face.position.z=config.headType==='cube'?.356:.405;content.add(face);
          }
        }
      }
      data.defaultSeatHead.visible=false;data.seatHead=root;
      if(data.nameSprite)data.nameSprite.position.y=root.position.y+.4*(config.headScale||1)+.25;
      if(data.seatFallbackParts)data.seatFallbackParts[1]=root;
    }catch(error){
      if(data.accountAvatarTicket!==ticket)return;
      group.remove(root);dispose(root);data.accountAvatarRoot=null;
      data.seatHead=data.defaultSeatHead;if(data.seatFallbackParts)data.seatFallbackParts[1]=data.defaultSeatHead;
      data.seatFallbackParts?.forEach(part=>{part.visible=true;});
      data.accountAvatarError=error.message;
      console.error('[Avatar] Failed to load saved avatar',error);
      window.dispatchEvent(new CustomEvent('avatar-load-error',{detail:{group,error}}));
    }
  }
  window.UserAvatarRenderer={apply,dispose,normalize};
})();
