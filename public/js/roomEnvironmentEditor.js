/** Prepare an office independently; apply only after explicit bounds and replacement confirmation. */
(() => {
  const $=id=>document.getElementById(id), clone=value=>JSON.parse(JSON.stringify(value));
  const tr=key=>window.i18n.t('roomEnvironmentEditor.'+key);
  const display=n=>Number(n.toFixed(6));
  let candidate,controller,sequence=0,editing=false;
  const status=$('environment-import-status');
  function dispose(root){
    const geometries=new Set(),materials=new Set(),textures=new Set();
    root.traverse(n=>{if(n.geometry)geometries.add(n.geometry);for(const m of [].concat(n.material||[])){materials.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});
    for(const v of textures)v.dispose();for(const v of materials)v.dispose();for(const v of geometries)v.dispose();
  }
  function refreshModels(){
    const selected=$('environment-model').value;$('environment-model').replaceChildren();
    for(const m of window.RoomEditorEnvironment?.models()||[]){const option=document.createElement('option');option.value=m.id;option.textContent=m.name;$('environment-model').append(option);}
    if([...$('environment-model').options].some(o=>o.value===selected))$('environment-model').value=selected;
  }
  function fields(){
    $('environment-settings').hidden=!candidate;if(!candidate)return;
    const s=candidate.scale.x,b=candidate.environment.bounds;
    $('environment-source').textContent=candidate.name;
    $('environment-width').value=display((b.max.x-b.min.x)*s);$('environment-yaw').value=display(candidate.rotation.y*180/Math.PI);
    $('environment-floor').value=display(-candidate.position.y);
    $('environment-x').value=display(candidate.position.x);$('environment-z').value=display(candidate.position.z);
    for(const edge of ['min','max'])for(const a of ['x','y','z'])$('environment-'+edge+'-'+a).value=display(b[edge][a]*s);
    $('environment-confirm').checked=false;
  }
  function read(){
    if(!candidate)throw Error(tr('invalid'));
    const item=clone(candidate),old=item.scale.x;
    const value=id=>{const n=Number($(id).value);if($(id).value===''||!Number.isFinite(n))throw Error(tr('invalid'));return n;};
    for(const edge of ['min','max'])for(const a of ['x','y','z'])item.environment.bounds[edge][a]=value('environment-'+edge+'-'+a)/old;
    const b=item.environment.bounds,s=value('environment-width')/(b.max.x-b.min.x);
    item.scale={x:s,y:s,z:s};item.rotation={x:0,y:value('environment-yaw')*Math.PI/180,z:0};
    item.position={x:value('environment-x'),y:-value('environment-floor')*s/old,z:value('environment-z')};
    if(!RoomEnvironment.validItem(item))throw Error(tr('invalid'));
    return item;
  }
  function cancel(){
    sequence++;controller?.abort();controller=null;editing=false;
    window.RoomEditorEnvironment?.clearPreview();
    const current=window.RoomEditorEnvironment?.get();candidate=current?.type==='room_environment'?clone(current):null;fields();
    $('environment-cancel').hidden=true;status.textContent=tr('cancelled');
  }
  async function prepare(file){
    cancel();const seq=sequence;controller=new AbortController();const signal=controller.signal;
    $('environment-cancel').hidden=false;status.textContent=tr(file?'uploading':'checking');
    try {
      let model;
      if(file){
        model=await RoomModelUpload.upload(file,{profile:'room_environment',signal,onProgress:p=>{if(seq===sequence)status.textContent=p<100?tr('uploading')+' '+p+'%':tr('checking');}});
        if(seq!==sequence)return;
        window.RoomEditorEnvironment.register(model);
      }else{
        const id=Number($('environment-model').value);
        const response=await fetch('/api/admin/rooms/models/'+id+'/environment-inspection',{method:'POST',signal,headers:{Authorization:'Bearer '+localStorage.getItem('adminToken')}});
        const data=await response.json();
        if(!response.ok||!data.success){const translated=data.errorKey&&window.i18n.t(data.errorKey);throw Error(translated&&translated!==data.errorKey?translated:tr('failed'));}
        model={...data.model,name:data.model.display_name||data.model.name||data.model.file_name};
      }
      if(seq!==sequence)return;
      const response=await fetch(model.path,{signal});if(!response.ok)throw Error('HTTP '+response.status);
      const buffer=await response.arrayBuffer();if(seq!==sequence)return;
      const gltf=await new THREE.GLTFLoader().parseAsync(buffer,new URL('.',new URL(model.path,location.href)).href);
      if(seq!==sequence){dispose(gltf.scene);return;}
      const box=new THREE.Box3().setFromObject(gltf.scene);
      const size=box.getSize(new THREE.Vector3());
      if(box.isEmpty()||![size.x,size.y,size.z].every(n=>Number.isFinite(n)&&n>0)){dispose(gltf.scene);throw Error(tr('invalid'));}
      let s=1;
      if(size.x>200||size.z>200||size.y>30||size.x<1||size.z<1||size.y<2)s=12/size.x;
      candidate={type:'room_environment',kind:'room',name:model.name.slice(0,120),model_id:model.id,model_path:model.path,collision:false,seats:[],
        position:{x:-(box.min.x+box.max.x)*s/2,y:-box.min.y*s,z:-(box.min.z+box.max.z)*s/2},rotation:{x:0,y:0,z:0},scale:{x:s,y:s,z:s},
        environment:{version:1,bounds:{min:{...box.min},max:{...box.max}}}};
      editing=true;fields();window.RoomEditorEnvironment.preview(candidate,gltf.scene);status.textContent=tr('prepared');
    }catch(error){if(seq===sequence&&error.name!=='AbortError')status.textContent=error.message;}
    finally{if(seq===sequence){controller=null;$('environment-cancel').hidden=!editing;}}
  }
  function replacementWarning(){
    const current=window.RoomEditorEnvironment.get();
    const change=current?.type==='room_environment'?tr('replaceWarning'):tr('switchWarning');
    return confirm(change+'\n'+tr('keepWarning'));
  }
  $('environment-prepare').onclick=()=>prepare();
  $('environment-file').onchange=()=>{const file=$('environment-file').files[0];if(file)prepare(file);$('environment-file').value='';};
  $('environment-cancel').onclick=cancel;
  $('environment-settings').oninput=event=>{
    // Editing the service bounds never changes the model scale. Width is the
    // explicit resize command; its blur commits the new units to all fields.
    if(/^environment-(min|max)-/.test(event.target.id)){
      const width=Number($('environment-max-x').value)-Number($('environment-min-x').value);
      if(Number.isFinite(width)&&width>0)$('environment-width').value=display(width);
    }
    if(event.target.id!=='environment-confirm')$('environment-confirm').checked=false;
    editing=true;$('environment-cancel').hidden=false;
    try{window.RoomEditorEnvironment.preview(read());status.textContent=tr('prepared');}catch(e){status.textContent=e.message;}
  };
  $('environment-width').onchange=()=>{
    try{candidate=read();fields();window.RoomEditorEnvironment.preview(candidate);}catch(e){status.textContent=e.message;}
  };
  $('environment-center').onclick=()=>{
    try{const item=read(),b=item.environment.bounds,p=RoomEnvironment.toWorld({x:(b.min.x+b.max.x)/2,y:b.min.y,z:(b.min.z+b.max.z)/2},{...item,position:{x:0,y:0,z:0}});
      $('environment-x').value=-p.x;$('environment-z').value=-p.z;
      editing=true;$('environment-confirm').checked=false;$('environment-cancel').hidden=false;window.RoomEditorEnvironment.preview(read());
    }catch(e){status.textContent=e.message;}
  };
  $('environment-settings').onsubmit=async event=>{
    event.preventDefault();if(controller)return;
    try{const item=read();if(!replacementWarning())return;if(await window.RoomEditorEnvironment.apply(item)){editing=false;candidate=clone(window.RoomEditorEnvironment.get());fields();$('environment-cancel').hidden=true;status.textContent=tr('applied');}}
    catch(e){status.textContent=e.message;}
  };
  $('environment-shell').onclick=async()=>{
    if(window.RoomEditorEnvironment.get()?.type==='room_shell'){cancel();return;}
    if(controller)cancel();if(!replacementWarning())return;
    const savedShell=window.RoomEditorEnvironment.previousShell();
    const previous=savedShell?.type==='room_shell'?savedShell:null;
    const shell=previous ? {...clone(previous),rotation:previous.rotation||{x:0,y:previous.rotation_y||0,z:0},scale:{x:1,y:1,z:1}} : {type:'room_shell',kind:'room',name:tr('shell'),collision:true,seats:[],position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},
      envelope:{version:1,width:12,length:10,height:3.5,thickness:{x:.2,z:.2,floor:.2,ceiling:.2},
        surfaces:Object.fromEntries(RoomEnvelope.surfaces.map(k=>[k,{mode:'color',color:'#d7d3ca',image:null,fit:'cover',tileWidth:2,tileHeight:2}]))}};
    if(await window.RoomEditorEnvironment.apply(shell)){candidate=null;editing=false;fields();$('environment-cancel').hidden=true;status.textContent=tr('applied');}
  };
  window.addEventListener('room-editor-loaded',event=>{
    const template=window.RoomEditorEnvironment?.available();$('environment-import').hidden=!template;if(!template)return;
    refreshModels();const current=window.RoomEditorEnvironment?.get();
    if(!editing&&!controller){candidate=current?.type==='room_environment'?clone(current):null;fields();}
  });
  window.addEventListener('pagehide',()=>{sequence++;controller?.abort();});
  window.addEventListener('beforeunload',event=>{if(editing||controller){event.preventDefault();event.returnValue='';}});
  window.RoomEnvironmentEditor={refreshModels,isPending:()=>editing||!!controller};
})();
