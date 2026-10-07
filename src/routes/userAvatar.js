const router=require('express').Router();
const multer=require('multer');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {pool}=require('../database/db');
const {authenticateToken}=require('../middleware/auth');
const {LIMITS,inspectGlb,fail}=require('../services/avatarValidation');
const service=require('../services/userAvatars').createUserAvatarService(pool, {
  assetInUse: id => [...require('../websocket/wsServer').getPlayerPositions().values()].some(player => player.avatarConfig?.asset?.id === id)
});
const directory=path.join(__dirname,'../../public/uploads/user-avatars');
router.use(authenticateToken);
function errorResponse(res,error){
  if(!error.status && !(error instanceof multer.MulterError))console.error('[Avatar]',error);
  const code=error.code==='LIMIT_FILE_SIZE'?'FILE_TOO_LARGE':error.status?error.code:error instanceof multer.MulterError?'INVALID_FILE':'SERVICE_ERROR';
  res.status(error.status|| (error instanceof multer.MulterError?400:500)).json({errorKey:'avatar.'+code});
}
router.get('/',async(req,res)=>{try{res.json(await service.get(req.user.userId));}catch(e){errorResponse(res,e);}});
router.put('/',async(req,res)=>{try{res.json(await service.save(req.user.userId,req.body));}catch(e){errorResponse(res,e);}});
// Disk storage bounds memory use on small servers. At most one upload per account
// in this process; the database transaction additionally serializes quota checks.
const active=new Set();
const upload=multer({storage:multer.diskStorage({
  destination:async(req,file,cb)=>{try{await fs.mkdir(directory,{recursive:true});cb(null,directory);}catch(e){cb(e);}},
  filename:(req,file,cb)=>cb(null,randomUUID()+'.pending')
}),limits:{fileSize:LIMITS.body,files:1,fields:0},fileFilter:(req,file,cb)=>{
  const ext=path.extname(file.originalname).toLowerCase();
  cb(null,req.params.kind==='image'?['.png','.jpg','.jpeg','.webp'].includes(ext):ext==='.glb');
}}).single('file');
router.post('/assets/:kind',async(req,res)=>{
  const userId=req.user.userId,kind=req.params.kind;
  if(!Object.hasOwn(LIMITS,kind))return errorResponse(res,Object.assign(new Error(),{status:400,code:'INVALID_FILE'}));
  if(active.has(userId))return errorResponse(res,Object.assign(new Error(),{status:429,code:'UPLOAD_BUSY'}));
  active.add(userId);let pending,output;
  try{
    const existing=await service.get(userId);
    if(existing.assets.length>=12 || existing.assets.reduce((sum,asset)=>sum+asset.byte_size,0)>=100*1024*1024)fail('ASSET_QUOTA',409);
    await new Promise((resolve,reject)=>upload(req,res,e=>e?reject(e):resolve()));
    pending=req.file?.path;
    if(!pending)fail('INVALID_FILE');
    if(req.file.size>LIMITS[kind])fail('FILE_TOO_LARGE');
    const id=randomUUID();let metadata;
    output=path.join(directory,id+(kind==='image'?'.webp':'.glb'));
    if(kind==='image'){
      const sharp=require('sharp');
      try{
        const image=sharp(pending,{limitInputPixels:16000000,animated:false});
        const info=await image.metadata();
        if(!['png','jpeg','webp'].includes(info.format)|| (info.pages||1)>1)fail('INVALID_IMAGE');
        await image.rotate().resize(1024,1024,{fit:'cover'}).webp({quality:85}).toFile(output);
        metadata={width:1024,height:1024};
      }catch(e){if(e.status)throw e;fail('INVALID_IMAGE');}
      await fs.unlink(pending);pending=null;
    }else{
      const buffer=await fs.readFile(pending);metadata=inspectGlb(buffer,kind);
      // Decode embedded images to reject decompression bombs and broken textures.
      const sharp=require('sharp');
      const jsonSize=buffer.readUInt32LE(12),json=JSON.parse(buffer.subarray(20,20+jsonSize).toString());
      const binStart=20+jsonSize+8;
      let texturePixels=0;
      for(const image of json.images||[]){
        const view=json.bufferViews?.[image.bufferView];if(!view)fail('INVALID_GLB');
        try{
          const info=await sharp(buffer.subarray(binStart+(view.byteOffset||0),binStart+(view.byteOffset||0)+view.byteLength),{limitInputPixels:16000000}).metadata();
          texturePixels+=info.width*info.height;
          if(texturePixels>16777216||info.width>4096||info.height>4096||(info.pages||1)>1)fail('MODEL_TOO_COMPLEX');
        }catch(e){if(e.status)throw e;fail('INVALID_IMAGE');}
      }
      await fs.rename(pending,output);pending=null;
    }
    const asset={id,kind,path:'/uploads/user-avatars/'+path.basename(output),byte_size:(await fs.stat(output)).size,metadata};
    await service.addAsset(userId,asset);output=null;res.status(201).json({asset});
  }catch(e){errorResponse(res,e);}finally{
    await Promise.all([pending,output].filter(Boolean).map(file=>fs.unlink(file).catch(()=>{})));
    active.delete(userId);
  }
});
router.delete('/assets/:id',async(req,res)=>{
  try{const url=await service.removeAsset(req.user.userId,req.params.id);await fs.unlink(path.join(directory,path.basename(url))).catch(e=>{if(e.code!=='ENOENT')console.error('[Avatar] Asset cleanup failed',e);});res.json({success:true});}catch(e){errorResponse(res,e);}
});
module.exports=router;
