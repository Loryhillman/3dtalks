// Small real GLB files for parser, upload and browser rendering tests.
function glb(kind='head') {
  const positions=new Float32Array([-1,-1,0,1,-1,0,0,1,0]);
  const binary=Buffer.alloc(kind==='body'?96:36);Buffer.from(positions.buffer).copy(binary);
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],buffers:[{byteLength:binary.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}]};
  if(kind==='body'){
    json.nodes=[{name:'Root',children:[1,9]},{name:'mixamorig:Hips',translation:[0,1,0],children:[2,3,6]},{name:'mixamorig:Head',translation:[0,1,0]},
      {name:'mixamorig:LeftUpLeg',translation:[-.2,0,0],children:[4]},{name:'mixamorig:LeftLeg',translation:[0,-.5,0],children:[5]},{name:'mixamorig:LeftFoot',translation:[0,-.5,.1]},
      {name:'mixamorig:RightUpLeg',translation:[.2,0,0],children:[7]},{name:'mixamorig:RightLeg',translation:[0,-.5,0],children:[8]},{name:'mixamorig:RightFoot',translation:[0,-.5,.1]}, {mesh:0,skin:0}];
    json.skins=[{joints:[1,2,3,4,5,6,7,8]}];
    json.bufferViews.push({buffer:0,byteOffset:36,byteLength:12},{buffer:0,byteOffset:48,byteLength:48});
    json.accessors.push({bufferView:1,componentType:5121,count:3,type:'VEC4'},{bufferView:2,componentType:5126,count:3,type:'VEC4'});
    json.meshes[0].primitives[0].attributes={POSITION:0,JOINTS_0:1,WEIGHTS_0:2};
    Buffer.from(new Float32Array([1,0,0,0,1,0,0,0,1,0,0,0]).buffer).copy(binary,48);
  }
  return encode(json,binary);
}
function encode(json,binary){
  let string=JSON.stringify(json);while(Buffer.byteLength(string)%4)string+=' ';
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+Buffer.byteLength(string)+binary.length,8);header.writeUInt32LE(Buffer.byteLength(string),12);header.writeUInt32LE(0x4e4f534a,16);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(binary.length);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,Buffer.from(string),binHeader,binary]);
}
function mutate(buffer,fn){const n=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+n));fn(json);return encode(json,buffer.subarray(28+n));}
module.exports={glb,mutate};
