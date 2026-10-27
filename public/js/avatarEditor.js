(() => {
  const $=id=>document.getElementById(id),form=$('avatar-form');
  const t=(key,params)=>window.i18n.tp('avatar.'+key,params||{});
  let assets=[],catalog=[],defaultConfig,revision=0,ready=false,busy=false,disposed=false,previewLoading=false,group,scene,camera,renderer,raf,previewSequence=0;
  const defaults={mode:'standard',headType:'sphere',bodyColor:'#4a90e2',headColor:'#ffaa99',headScale:1,headOffset:0,headYaw:0,bodyYaw:0};
  let orbit,voice,voiceAmount=0,view='seat';
  const mouthGain=()=>Number($('avatar-mouth-gain').value);
  function mouthTargets(){
    const targets=[];
    group?.userData.accountAvatarRoot?.traverse(mesh=>{
      const index=mesh.morphTargetDictionary?.viseme_aa??mesh.morphTargetDictionary?.jawOpen;
      if(Number.isInteger(index)&&mesh.morphTargetInfluences?.[index]!==undefined)targets.push({mesh,index});
    });
    return targets;
  }
  function voiceControls(){
    if(!voice)return;
    const state=voice.getState(),supported=ready&&mouthTargets().length>0,locked=['requesting','preparing','starting'].includes(state.phase);
    $('avatar-voice-record').disabled=!supported||busy||locked;
    $('avatar-voice-record').textContent=t(state.phase==='recording'?'voiceFinish':'voiceRecord');
    $('avatar-voice-play').disabled=!supported||busy||state.phase!=='ready';
    $('avatar-voice-stop').disabled=!['requesting','recording','preparing','starting','playing'].includes(state.phase);
    $('avatar-mouth-gain').disabled=!supported||busy;
    $('avatar-voice-status').textContent=t(!ready?'loading':!supported?'voiceNoMorph':state.error||'voicePhase_'+state.phase);
  }
  function setView(next=view){
    if(!orbit)return;view=next;group.updateWorldMatrix(true,true);
    const head=group.userData.roomSeatRig?.found?.head||group.userData.seatHead;
    const target=view==='face'&&head?head.getWorldPosition(new THREE.Vector3()):new THREE.Vector3(0,.3,0);
    orbit.target.copy(target);camera.position.copy(target).add(view==='face'?new THREE.Vector3(0,.04,1.2):new THREE.Vector3(0,1.2,5));
    orbit.minDistance=view==='face'?.45:2;orbit.maxDistance=view==='face'?3:8;orbit.update();
    for(const name of ['seat','face'])$('avatar-view-'+name).setAttribute('aria-pressed',String(view===name));
  }
  function status(message=''){$('avatar-status').textContent=message;}
  async function request(url,options={}){
    const headers={Authorization:'Bearer '+(localStorage.getItem('token')||''),...options.headers};
    const response=await fetch('/api/my/avatar'+url,{...options,headers});
    const renewed=response.headers.get('X-Renewed-Token');if(renewed)localStorage.setItem('token',renewed);
    const data=await response.json().catch(()=>({}));
    if(!response.ok){if([401,403].includes(response.status))location.assign('/rooms');throw new Error(data.errorKey?window.i18n.t(data.errorKey):t('SERVICE_ERROR'));}
    return data;
  }
  function kind(){return form.elements.mode.value==='full'?'body':form.elements.headType.value==='model'?'head':'image';}
  function config(){
    if(form.elements.mode.value==='builtin'){
      const preset=catalog.find(entry=>entry.id===form.elements.builtinId.value);
      return {...(preset? preset.config:{mode:'builtin',builtinId:form.elements.builtinId.value}),mouthGain:mouthGain()};
    }
    const result=Object.fromEntries(['mode','headType','bodyColor','headColor'].map(key=>[key,form.elements[key].value]));
    result.mouthGain=mouthGain();
    for(const key of ['headScale','headOffset','headYaw','bodyYaw'])result[key]=Number(form.elements[key].value);
    const id=form.elements.assetId.value||null;
    if(result.mode==='full')result.bodyAssetId=id;else result.headAssetId=id;
    const asset=assets.find(a=>a.id===id);
    if(asset)result.asset={id:asset.id,path:asset.path,kind:asset.kind,boneMap:asset.metadata?.boneMap||{}};
    return result;
  }
  function selectAssets(selected=''){
    const select=form.elements.assetId;select.replaceChildren(new Option(t('noAsset'),''));
    for(const asset of assets.filter(a=>a.kind===kind()))select.append(new Option(t('assetLabel',{kind:t(asset.kind==='body'?'full':asset.kind==='head'?'model':'image'),id:asset.id.slice(0,8)}),asset.id));
    select.value=selected;
  }
  function controls(){
    const full=form.elements.mode.value==='full',builtin=form.elements.mode.value==='builtin';
    $('avatar-standard').hidden=full||builtin;$('avatar-full').hidden=!full;$('avatar-builtin').hidden=!builtin;$('avatar-assets').hidden=builtin;
    for(const input of $('avatar-standard').querySelectorAll('input,select'))input.disabled=full||builtin||busy;
    form.elements.builtinId.disabled=!builtin||busy;
    form.elements.assetId.disabled=builtin||busy;$('avatar-file').disabled=builtin||busy;
    form.elements.bodyYaw.disabled=!full||busy;
    $('avatar-file').accept=kind()==='image'?'.png,.jpg,.jpeg,.webp':'.glb';
    $('avatar-file-hint').textContent=t(kind()==='image'?'imageHint':kind()==='head'?'headHint':'bodyHint');
    $('avatar-delete').disabled=busy||builtin||!form.elements.assetId.value;
    $('avatar-save').disabled=busy||!ready;
    $('avatar-preview-retry').disabled=busy||previewLoading;
    voiceControls();
  }
  async function preview(){
    const sequence=++previewSequence,c=config();
    voice?.stop();voiceAmount=0;
    ready=false;previewLoading=true;controls();
    if(!group||disposed){previewLoading=false;return;}
    const required=['full','builtin'].includes(c.mode)||['image','model'].includes(c.headType);
    if(required&&!c.asset){previewLoading=false;controls();status(t('ASSET_REQUIRED'));return;}
    status(t('loading'));
    await window.UserAvatarRenderer.apply(group,c);
    if(disposed||sequence!==previewSequence)return;
    previewLoading=false;controls();
    if(group.userData.accountAvatarError){status(t('previewFailed'));return;}
    group.position.set(0,0,0);window.RoomSeatAvatar.apply(group,{yaw:0,pitch:0});
    if(['full','builtin'].includes(c.mode)&&!group.userData.roomSeatRig?.supported){status(t('UNSUPPORTED_RIG'));return;}
    ready=true;controls();status();setView();
  }
  function populate(c){
    $('avatar-mouth-gain').value=String(c.mouthGain||1);$('avatar-mouth-value').textContent=mouthGain().toFixed(2)+'×';
    for(const [key,value] of Object.entries({...defaults,...c}))if(form.elements[key]&&key!=='asset')form.elements[key].value=String(value);
    selectAssets(c.mode==='full'?c.bodyAssetId:c.headAssetId);controls();return preview();
  }
  async function action(fn){
    if(busy)return;busy=true;for(const element of form.elements)element.disabled=true;
    try{await fn();}catch(error){status(error.message);}finally{busy=false;for(const element of form.elements)element.disabled=false;controls();}
  }
  function buildPreview(){
    renderer=new THREE.WebGLRenderer({canvas:$('avatar-canvas'),antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    scene=new THREE.Scene();scene.background=new THREE.Color('#e8efed');
    scene.add(new THREE.HemisphereLight(0xffffff,0x657183,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,4);scene.add(light);
    camera=new THREE.PerspectiveCamera(40,1,.01,100);
    orbit=new THREE.OrbitControls(camera,$('avatar-canvas'));orbit.enablePan=false;orbit.enableDamping=true;orbit.minPolarAngle=.2;orbit.maxPolarAngle=Math.PI-.2;
    group=window.AvatarBase.create().characterGroup;scene.add(group);
    const floor=new THREE.Mesh(new THREE.CircleGeometry(2.5,64),new THREE.MeshStandardMaterial({color:'#d4e2dc',roughness:1}));
    floor.position.y=-.95;floor.rotation.x=-Math.PI/2;scene.add(floor);
    const resize=()=>{const canvas=$('avatar-canvas');renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe($('avatar-canvas'));resize();
    voice=AvatarVoicePreview.create({onState:voiceControls,onMouth:value=>{voiceAmount=value;if(!value)for(const {mesh,index} of mouthTargets())mesh.morphTargetInfluences[index]=0;}});
    const frame=()=>{group.position.set(0,0,0);window.RoomSeatAvatar.apply(group,{yaw:0,pitch:0});
      const amount=AvatarAudioSignal.calibrate(voiceAmount,mouthGain());for(const {mesh,index} of mouthTargets())mesh.morphTargetInfluences[index]=amount;
      orbit.update();renderer.render(scene,camera);raf=requestAnimationFrame(frame);};setView();frame();
    $('avatar-canvas').addEventListener('keydown',event=>{
      if(event.key==='Home'){event.preventDefault();setView();return;}
      const angles={ArrowLeft:.15,ArrowRight:-.15,ArrowUp:.1,ArrowDown:-.1};if(!(event.key in angles))return;
      event.preventDefault();const offset=camera.position.clone().sub(orbit.target),spherical=new THREE.Spherical().setFromVector3(offset);
      if(event.key==='ArrowLeft'||event.key==='ArrowRight')spherical.theta+=angles[event.key];else spherical.phi=Math.max(.2,Math.min(Math.PI-.2,spherical.phi+angles[event.key]));
      camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(spherical));orbit.update();
    });
    window.addEventListener('pagehide',()=>{disposed=true;voice.dispose();orbit.dispose();++previewSequence;++group.userData.accountAvatarTicket;cancelAnimationFrame(raf);observer.disconnect();group.removeFromParent();window.UserAvatarRenderer.dispose(group);window.UserAvatarRenderer.dispose(scene);renderer.dispose();},{once:true});
    window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  }
  $('avatar-view-seat').onclick=()=>setView('seat');$('avatar-view-face').onclick=()=>setView('face');$('avatar-view-reset').onclick=()=>setView();
  $('avatar-mouth-gain').oninput=()=>{$('avatar-mouth-value').textContent=mouthGain().toFixed(2)+'×';};
  $('avatar-voice-record').onclick=()=>{if(voice.getState().phase==='recording')voice.finish();else voice.record();};
  $('avatar-voice-play').onclick=()=>voice.play();$('avatar-voice-stop').onclick=()=>voice.stop();
  form.addEventListener('change',event=>{
    if(['mode','headType'].includes(event.target.name))selectAssets();
    if(['avatar-file','avatar-mouth-gain'].includes(event.target.id))return;
    preview().catch(error=>status(error.message));
  });
  form.onsubmit=event=>{event.preventDefault();if(!ready)return;action(async()=>{
    const result=await request('',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:config(),revision})});revision=result.revision;await populate(result.config);status(t('saved'));
  });};
  $('avatar-file').onchange=()=>action(async()=>{
    const file=$('avatar-file').files[0];if(!file)return;
    const k=kind(),limit=({image:8,head:20,body:40})[k]*1024*1024;
    if(file.size>limit)throw new Error(t('FILE_TOO_LARGE'));
    status(t('uploading'));const body=new FormData();body.append('file',file);
    const result=await request('/assets/'+k,{method:'POST',body});assets.unshift(result.asset);selectAssets(result.asset.id);$('avatar-file').value='';await preview();
  });
  $('avatar-delete').onclick=()=>action(async()=>{
    const id=form.elements.assetId.value;if(!id||!confirm(t('confirmDelete')))return;
    await request('/assets/'+encodeURIComponent(id),{method:'DELETE'});assets=assets.filter(a=>a.id!==id);selectAssets();await preview();
  });
  $('avatar-reset').onclick=()=>action(()=>populate(defaultConfig||defaults));
  $('avatar-preview-retry').onclick=()=>preview().catch(error=>status(error.message));
  window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
  (async()=>{
    await window.i18n.init();document.documentElement.lang=window.i18n.currentLocale;
    for(const element of document.querySelectorAll('[data-avatar-t]'))element.textContent=t(element.dataset.avatarT);
    if(!localStorage.getItem('token')){location.assign('/rooms');return;}
    buildPreview();const data=await request('');assets=data.assets;revision=data.revision;catalog=data.catalog||[];defaultConfig=data.defaultConfig;
    for(const preset of catalog)form.elements.builtinId.add(new Option(preset.labelKey?window.i18n.t(preset.labelKey):preset.label,preset.id));
    await populate(data.config);
  })().catch(error=>{ready=false;controls();status(error.message);});
})();
