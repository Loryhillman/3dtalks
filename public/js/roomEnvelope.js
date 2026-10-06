// One parameter schema and geometry compiler for server snapshots and editor preview.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RoomEnvelope=factory();})(typeof window!=='undefined'?window:globalThis,()=>{
  const surfaces=['north','south','west','east','floor','ceiling'];
  const number=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
  const imagePath=p=>typeof p==='string'&&/^\/uploads\/room-surfaces\/[a-f0-9]{64}\.webp$/.test(p);
  function valid(e){
    return !!e && e.version===1 && number(e.width,1,200) && number(e.length,1,200) && number(e.height,2,30) &&
      ['x','z','floor','ceiling'].every(k=>number(e.thickness?.[k],.01,2)) && surfaces.every(k=>{
        const s=e.surfaces?.[k];return s && ['color','texture','image'].includes(s.mode) && /^#[a-f0-9]{6}$/i.test(s.color||'') &&
          (!s.image || imagePath(s.image)) && (s.mode==='color' || imagePath(s.image)) && ['stretch','cover'].includes(s.fit) &&
          number(s.tileWidth,.05,100) && number(s.tileHeight,.05,100);
      });
  }
  const appearance=color=>({mode:'color',color:color||'#d7d3ca',image:null,fit:'cover',tileWidth:2,tileHeight:2});
  function components(e){
    if(!valid(e))throw new Error('INVALID_ROOM_ENVELOPE');
    const w=e.width,l=e.length,h=e.height,t=e.thickness;
    const box=(key,width,height,depth,x,y,z,face,uvWidth,uvHeight)=>({type:'box',width,height,depth,position:{x,y,z},
      color:e.surfaces[key].color,surface:{key,face,width:uvWidth,height:uvHeight,appearance:{...e.surfaces[key]}}});
    return [box('floor',w+t.x,t.floor,l+t.z,0,-t.floor/2,0,2,w+t.x,l+t.z),
      box('north',w+t.x,h,t.z,0,h/2,-(l+t.z)/2,4,w+t.x,h),
      box('south',w+t.x,h,t.z,0,h/2,(l+t.z)/2,5,w+t.x,h),
      box('west',t.x,h,l+t.z,-(w+t.x)/2,h/2,0,0,l+t.z,h),
      box('east',t.x,h,l+t.z,(w+t.x)/2,h/2,0,1,l+t.z,h),
      box('ceiling',w+t.x,t.ceiling,l+t.z,0,h+t.ceiling/2,0,3,w+t.x,l+t.z)];
  }
  function fromLegacy(item){
    if(item.type==='room_shell')return item;
    if(item.kind!=='room'||item.type&&item.type!=='geometry_building'||item.components?.length!==6)return null;
    const c=item.components;
    if(c.some(v=>v.type!=='box'||v.rotation&&Object.values(v.rotation).some(n=>n!==0)||v.scale&&Object.values(v.scale).some(n=>n!==1)))return null;
    const floor=c.find(v=>v.position?.y<0),ceiling=c.find(v=>v.height<1&&v.position?.y>1);
    const walls=c.filter(v=>v!==floor&&v!==ceiling);
    if(!floor||!ceiling||walls.length!==4||floor.position.x!==0||floor.position.z!==0||Math.abs(floor.position.y+floor.height/2)>1e-6)return null;
    const by={north:walls.find(v=>v.depth<1&&v.position.z<0),south:walls.find(v=>v.depth<1&&v.position.z>0),west:walls.find(v=>v.width<1&&v.position.x<0),east:walls.find(v=>v.width<1&&v.position.x>0),floor,ceiling};
    if(surfaces.some(k=>!by[k]))return null;
    const scale=item.scale||{x:1,y:1,z:1};
    const e={version:1,width:(by.east.position.x-by.west.position.x-by.west.width)*scale.x,
      length:(by.south.position.z-by.north.position.z-by.north.depth)*scale.z,height:by.north.height*scale.y,
      thickness:{x:by.west.width*scale.x,z:by.north.depth*scale.z,floor:floor.height*scale.y,ceiling:ceiling.height*scale.y},
      surfaces:Object.fromEntries(surfaces.map(k=>[k,appearance(by[k].color)]))};
    if(!valid(e))return null;
    const generated=components(e);
    // Only convert a recognized rectangle. Never reshape a custom shell silently.
    for(const part of generated){const old=by[part.surface.key];for(const [dim,a] of [['width','x'],['height','y'],['depth','z']]){
      if(Math.abs(part[dim]-old[dim]*scale[a])>1e-6 || Math.abs(part.position[a]-old.position[a]*scale[a])>1e-6)return null;
    }}
    const result={...item,type:'room_shell',envelope:e,scale:{x:1,y:1,z:1},collision:true};delete result.components;return result;
  }
  function localPoint(point,item){
    let [x,y,z]=['x','y','z'].map(a=>point[a]-(item.position?.[a]||0));
    const r=item.rotation||{x:0,y:item.rotation_y||0,z:0};
    [y,z]=[y*Math.cos(r.x)+z*Math.sin(r.x),-y*Math.sin(r.x)+z*Math.cos(r.x)];
    [x,z]=[x*Math.cos(r.y)-z*Math.sin(r.y),x*Math.sin(r.y)+z*Math.cos(r.y)];
    [x,y]=[x*Math.cos(r.z)+y*Math.sin(r.z),-x*Math.sin(r.z)+y*Math.cos(r.z)];
    return {x:x/(item.scale?.x||1),y:y/(item.scale?.y||1),z:z/(item.scale?.z||1)};
  }
  function contains(point,item){const p=localPoint(point,item),e=item.envelope;return Math.abs(p.x)<=e.width/2+.01&&Math.abs(p.z)<=e.length/2+.01&&p.y>=-.01&&p.y<=e.height+.01;}
  return {surfaces,valid,imagePath,components,fromLegacy,localPoint,contains};
});
