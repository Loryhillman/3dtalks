(function(root,factory){
  const value=factory();
  if(typeof module==='object'&&module.exports)module.exports=value;else root.RoomObjectScale=value;
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  // Validate the whole operation before replacing any item in the draft.
  function apply(layout,ids,factor){
    const selection=new Set(ids);
    if(selection.size<2||!Number.isFinite(factor)||factor<=0)throw new Error('groupScaleInvalid');
    const items=layout.filter(item=>selection.has(item.editor_id));
    if(items.length!==selection.size||items.some(item=>item.kind==='room'||item.type==='seat'))throw new Error('groupScaleInvalid');
    const center={};
    for(const axis of ['x','y','z'])center[axis]=items.reduce((sum,item)=>sum+item.position[axis],0)/items.length;
    const replacements=new Map();
    for(const item of items){
      const position={},scale={};
      for(const axis of ['x','y','z']){
        position[axis]=center[axis]+(item.position[axis]-center[axis])*factor;
        scale[axis]=(item.scale?.[axis]??1)*factor;
        if(!Number.isFinite(position[axis])||Math.abs(position[axis])>10000||!Number.isFinite(scale[axis])||scale[axis]<.01||scale[axis]>100)throw new Error('groupScaleRange');
      }
      replacements.set(item.editor_id,{...item,position,scale});
    }
    return layout.map(item=>replacements.get(item.editor_id)||item);
  }
  return {apply};
});
