(() => {
  const $=id=>document.getElementById(id),form=$('avatar-form');
  const t=(key,params)=>window.i18n.tp('avatar.'+key,params||{});
  let assets=[],revision=0,ready=false,busy=false,group,scene,camera,renderer,raf,previewSequence=0;
  const defaults={mode:'standard',headType:'sphere',bodyColor:'#4a90e2',headColor:'#ffaa99',headScale:1,headOffset:0,headYaw:0,bodyYaw:0};
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
    const result=Object.fromEntries(['mode','headType','bodyColor','headColor'].map(key=>[key,form.elements[key].value]));
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
    const full=form.elements.mode.value==='full';$('avatar-standard').hidden=full;$('avatar-full').hidden=!full;
    for(const input of $('avatar-standard').querySelectorAll('input,select'))input.disabled=full||busy;
    form.elements.bodyYaw.disabled=!full||busy;
    $('avatar-file').accept=kind()==='image'?'.png,.jpg,.jpeg,.webp':'.glb';
    $('avatar-file-hint').textContent=t(kind()==='image'?'imageHint':kind()==='head'?'headHint':'bodyHint');
    $('avatar-delete').disabled=busy||!form.elements.assetId.value;
    $('avatar-save').disabled=busy||!ready;
  }
  async function preview(){
    const sequence=++previewSequence,c=config();
    ready=false;controls();
    if(!group)return;
    const required=c.mode==='full'||['image','model'].includes(c.headType);
    if(required&&!c.asset){status(t('ASSET_REQUIRED'));return;}
    status(t('loading'));
    await window.UserAvatarRenderer.apply(group,c);
    if(sequence!==previewSequence)return;
    if(group.userData.accountAvatarError){status(t('previewFailed'));return;}
    group.position.set(0,0,0);window.RoomSeatAvatar.apply(group,{yaw:0,pitch:0});
    if(c.mode==='full'&&!group.userData.roomSeatRig?.supported){status(t('UNSUPPORTED_RIG'));return;}
    ready=true;controls();status();
  }
  function populate(c){
    for(const [key,value] of Object.entries({...defaults,...c}))if(form.elements[key]&&key!=='asset')form.elements[key].value=String(value);
    selectAssets(c.mode==='full'?c.bodyAssetId:c.headAssetId);controls();return preview();
  }
  async function action(fn){
    if(busy)return;busy=true;for(const element of form.elements)element.disabled=true;
    try{await fn();}catch(error){status(error.message);}finally{busy=false;for(const element of form.elements)element.disabled=false;controls();}
  }
  function buildPreview(){
    renderer=new THREE.WebGLRenderer({canvas:$('avatar-canvas'),antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    scene=new THREE.Scene();scene.background=new THREE.Color('#202936');
    scene.add(new THREE.HemisphereLight(0xffffff,0x657183,2));const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(3,5,4);scene.add(light);
    camera=new THREE.PerspectiveCamera(40,1,.01,100);camera.position.set(4,2.5,6);camera.lookAt(0,.6,0);
    group=window.AvatarBase.create().characterGroup;scene.add(group);
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshStandardMaterial({color:'#354052'}));
    floor.position.y=-.95;floor.rotation.x=-Math.PI/2;scene.add(floor);
    const resize=()=>{const canvas=$('avatar-canvas');renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);camera.aspect=canvas.clientWidth/canvas.clientHeight;camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe($('avatar-canvas'));resize();
    const frame=()=>{group.position.set(0,0,0);window.RoomSeatAvatar.apply(group,{yaw:Number($('avatar-look').value),pitch:0});renderer.render(scene,camera);raf=requestAnimationFrame(frame);};frame();
    window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);observer.disconnect();window.UserAvatarRenderer.dispose(scene);renderer.dispose();},{once:true});
  }
  form.addEventListener('change',event=>{
    if(['mode','headType'].includes(event.target.name))selectAssets();
    if(event.target.id==='avatar-file')return;
    preview().catch(error=>status(error.message));
  });
  form.onsubmit=event=>{event.preventDefault();if(!ready)return;action(async()=>{
    const result=await request('',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:config(),revision})});revision=result.revision;status(t('saved'));
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
  $('avatar-reset').onclick=()=>action(()=>populate(defaults));
  window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
  (async()=>{
    await window.i18n.init();document.documentElement.lang=window.i18n.currentLocale;
    for(const element of document.querySelectorAll('[data-avatar-t]'))element.textContent=t(element.dataset.avatarT);
    if(!localStorage.getItem('token')){location.assign('/rooms');return;}
    buildPreview();const data=await request('');assets=data.assets;revision=data.revision;await populate(data.config);
  })().catch(error=>{ready=false;controls();status(error.message);});
})();
