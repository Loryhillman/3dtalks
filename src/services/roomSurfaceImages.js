const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const sharp=require('sharp');
const directory=path.resolve(__dirname,'../../public/uploads/room-surfaces');
async function storeImage(buffer) {
  const reject=()=>{throw Object.assign(new Error('Загрузите PNG, JPEG или WebP до 10 МБ и 16 млн пикселей'),{status:400});};
  if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>10*1024*1024)reject();
  let output;
  try {
    const image=sharp(buffer,{limitInputPixels:16000000,failOn:'warning'});
    const meta=await image.metadata();
    if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)>1)reject();
    output=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).webp({quality:90}).toBuffer({resolveWithObject:true});
  }catch(_){reject();}
  const name=createHash('sha256').update(output.data).digest('hex')+'.webp';
  await fs.mkdir(directory,{recursive:true});
  const temporary=path.join(directory,'.'+randomUUID()+'.tmp');
  try {await fs.writeFile(temporary,output.data,{flag:'wx'});await fs.rename(temporary,path.join(directory,name));}
  finally{await fs.rm(temporary,{force:true});}
  return {path:'/uploads/room-surfaces/'+name,width:output.info.width,height:output.info.height};
}
module.exports={storeImage};
