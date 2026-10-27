const express=require('express');
const COOKIE='room_video';
function readCookie(header){
 if(typeof header!=='string'||header.length>8192)return null;
 const matches=header.split(';').map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+'='));
 return matches.length===1?matches[0].slice(COOKIE.length+1):null;
}
function createRoomVideoRouter(service,authenticate,{secure=process.env.NODE_ENV==='production'}={}){
 const router=express.Router({mergeParams:true});
 router.use((_req,res,next)=>{res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Vary':'Cookie, Authorization'});next();});
 const route=fn=>async(req,res)=>{try{await fn(req,res);}catch(e){if(!res.headersSent&&!res.destroyed)res.status(e.status||500).json({success:false,code:e.status?e.code:'VIDEO_SERVICE_ERROR'});else if(!res.destroyed)res.destroy();}};
 router.post('/grant',authenticate,route(async(req,res)=>{
  if(req.body&&(!require('../../public/js/roomPresentationProtocol').keys(req.body,[])))throw Object.assign(Error('INVALID_COMMAND'),{status:400,code:'INVALID_COMMAND'});
  const grant=await service.issueVideoGrant(req.user.userId,req.params.id,req.params.assetId);
  res.cookie(COOKIE,grant.token,{httpOnly:true,secure:secure||req.secure,sameSite:'strict',path:req.baseUrl+'/content',maxAge:grant.ttlMs});
  res.json({success:true,expiresInMs:grant.ttlMs});
 }));
 router.get('/content',route(async(req,res)=>{
  const content=await service.readVideoGrant(readCookie(req.get('Cookie')),req.params.id,req.params.assetId);
  await require('./roomMediaContent').sendRoomMediaContent(res,content,{method:req.method,range:req.get('Range'),video:true});
 }));
 return router;
}
module.exports={createRoomVideoRouter};
