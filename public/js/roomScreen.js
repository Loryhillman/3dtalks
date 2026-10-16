/** Shared template/runtime contract. Screen front faces local +Z. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RoomScreen=factory();
})(typeof window==='undefined'?globalThis:window,()=>{
  const axes=['x','y','z'];
  const keys=(v,allowed)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>allowed.includes(k));
  const vector=v=>keys(v,axes)&&axes.every(a=>Number.isFinite(v[a])&&Math.abs(v[a])<=10000);
  function metadata(s){return keys(s,['version','width','height'])&&s.version===1&&
    Number.isFinite(s.width)&&s.width>=.5&&s.width<=8&&Number.isFinite(s.height)&&s.height>=.3&&s.height<=4.5;}
  function validItem(i){return keys(i,['type','kind','name','collision','position','rotation','scale','screen','editor_id','seats'])&&
    i.type==='presentation_screen'&&i.kind==='screen'&&typeof i.name==='string'&&!!i.name.trim()&&i.name.length<=120&&
    i.collision===false&&vector(i.position)&&vector(i.rotation)&&i.rotation.x===0&&i.rotation.z===0&&
    keys(i.scale,axes)&&axes.every(a=>i.scale[a]===1)&&metadata(i.screen)&&
    (i.editor_id===undefined||Number.isSafeInteger(i.editor_id)&&i.editor_id>0)&&
    (i.seats===undefined||Array.isArray(i.seats)&&i.seats.length===0);}
  function fromRuntime(o){
    const i={type:o.type,kind:'screen',name:o.name,collision:o.has_collision,screen:o.presentation_screen};
    for(const p of ['position','rotation','scale'])i[p]=Object.fromEntries(axes.map(a=>[a,o[p+'_'+a]]));
    return i;
  }
  function validRuntime(o){return o.model_path==null&&o.model_id==null&&o.model_type==null&&o.geometry_data==null&&o.room_environment==null&&validItem(fromRuntime(o));}
  function points(i){
    const {position:p,rotation:r,screen:s}=i,c=Math.cos(r.y),n=Math.sin(r.y);
    return [{...p},...[-1,1].flatMap(x=>[-1,1].map(y=>({x:p.x+x*s.width/2*c,y:p.y+y*s.height/2,z:p.z-x*s.width/2*n})))];
  }
  function create(){return {type:'presentation_screen',kind:'screen',name:'Экран',collision:false,
    position:{x:0,y:1.8,z:0},rotation:{x:0,y:0,z:0},scale:{x:1,y:1,z:1},screen:{version:1,width:3.2,height:1.8}};}
  return {metadata,validItem,fromRuntime,validRuntime,points,create};
});
