const express=require('express'),multer=require('multer');
const {createWriteStream}=require('node:fs'),fs=require('node:fs/promises');
const {pipeline}=require('node:stream/promises'),{Transform}=require('node:stream');
const limits=require('../services/roomMediaLimits');
function createRoomMediaRouter(service,authenticate=require('../middleware/auth').authenticateToken,{idleMs=limits.idleMs,uploadMs=limits.uploadMs}={}){
  const router=express.Router({mergeParams:true});
  router.use((_req,res,next)=>{res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization'});next();});
  // Cookie-authenticated video requests must be routed before JWT-only APIs.
  router.use('/:assetId/video',require('./roomVideo').createRoomVideoRouter(service,authenticate));
  router.use(authenticate);
  const sendError=(res,e)=>{
    const code=e.code==='LIMIT_FILE_SIZE'?'FILE_TOO_LARGE':e instanceof multer.MulterError?'INVALID_UPLOAD':e.code;
    if(!res.headersSent&&!res.destroyed)res.status(e.status||(e instanceof multer.MulterError?(code==='FILE_TOO_LARGE'?413:400):500)).json({success:false,code:e.status||e instanceof multer.MulterError?code:'MEDIA_SERVICE_ERROR',...(e.state?{state:e.state}:{})});
    if(!e.status&&!(e instanceof multer.MulterError))console.warn('[roomMedia] request failed',{code:code||'INTERNAL_ERROR'});
  };
  const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){sendError(res,e);}};
  router.get('/capabilities',route(async(req,res)=>res.json({success:true,features:await service.capabilities(req.user.userId,req.params.id)})));
  router.get('/',route(async(req,res)=>res.json({success:true,...await service.list(req.user.userId,req.params.id,{includeVideo:req.query.protocolVersion==='2'})})));
  router.post('/uploads',route(async(req,res)=>{const data=await service.reserve(req.user.userId,req.params.id,req.body);res.status(data.reused?200:201).json({success:true,...data});}));
  router.get('/uploads/:uploadId',route(async(req,res)=>res.json({success:true,upload:await service.get(req.user.userId,req.params.id,req.params.uploadId)})));
  router.delete('/uploads/:uploadId',route(async(req,res)=>res.json({success:true,upload:await service.cancel(req.user.userId,req.params.id,req.params.uploadId)})));
  router.post('/uploads/:uploadId/file',route(async(req,res)=>{
    const upload=await service.begin(req.user.userId,req.params.id,req.params.uploadId);
    const originalTimeout=req.socket.timeout;
    const abort=()=>upload.controller.abort();
    const abortRequest=()=>{if(!req.complete)req.destroy();};upload.controller.signal.addEventListener('abort',abortRequest,{once:true});
    const deadline=setTimeout(()=>{abort();req.destroy();},uploadMs);
    const onIdle=()=>{abort();req.destroy();};req.setTimeout(idleMs,onIdle);
    req.once('aborted',abort);const onClose=()=>{if(!res.writableEnded)abort();};res.once('close',onClose);
    try{
      const storage={
        _handleFile(request,file,callback){
          let bytes=0;
          const counter=new Transform({transform(chunk,_encoding,done){
            bytes+=chunk.length;
            if(bytes>Number(upload.row.declared_bytes))return done(Object.assign(new Error('FILE_TOO_LARGE'),{status:413,code:'FILE_TOO_LARGE'}));
            done(null,chunk);
          }});
          pipeline(file.stream,counter,createWriteStream(upload.paths.input,{flags:'wx',mode:0o600}),{signal:upload.controller.signal})
            .then(()=>callback(null,{path:upload.paths.input,size:bytes}),callback);
        },
        _removeFile(_request,_file,callback){fs.unlink(upload.paths.input).then(()=>callback(null),e=>callback(e.code==='ENOENT'?null:e));}
      };
      const receive=multer({storage,limits:{fileSize:Number(upload.row.declared_bytes)+1,files:1,fields:0,parts:2,headerPairs:40}}).single('file');
      await new Promise((resolve,reject)=>receive(req,res,e=>{
        if(e&&!e.code&&!e.status)Object.assign(e,{status:400,code:'INVALID_UPLOAD'});
        if(e?.code==='ENOSPC')Object.assign(e,{status:503,code:'MEDIA_STORAGE_FULL'});
        e?reject(e):resolve();
      }));
      clearTimeout(deadline);req.setTimeout(originalTimeout||0);req.removeListener('timeout',onIdle);
      if(!req.file||upload.controller.signal.aborted)throw Object.assign(new Error('INVALID_UPLOAD'),{code:'INVALID_UPLOAD',status:400});
      const material=await service.complete(req.user.userId,req.params.id,upload);
      res.json({success:true,material});
    }catch(e){
      await service.failed(req.user.userId,req.params.id,req.params.uploadId,
        e instanceof multer.MulterError?(e.code==='LIMIT_FILE_SIZE'?'FILE_TOO_LARGE':'INVALID_UPLOAD'):e.status?e.code:upload.controller.signal.aborted?'UPLOAD_CANCELLED':'UPLOAD_FAILED');
      throw e;
    }finally{
      clearTimeout(deadline);req.removeListener('aborted',abort);res.removeListener('close',onClose);req.removeListener('timeout',onIdle);
      upload.controller.signal.removeEventListener('abort',abortRequest);
      if(!req.destroyed)req.setTimeout(originalTimeout||0);
    }
  }));
  router.get('/:assetId/content',route(async(req,res)=>{
    const content=await service.content(req.user.userId,req.params.id,req.params.assetId);
    await require('./roomMediaContent').sendRoomMediaContent(res,content);
  }));
  router.delete('/:assetId',route(async(req,res)=>res.json({success:true,...await service.remove(req.user.userId,req.params.id,req.params.assetId,req.body||{})})));
  return router;
}
module.exports={createRoomMediaRouter};
