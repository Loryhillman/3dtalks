function createRoomPresentationRouter(presentation,media,authenticate=require('../middleware/auth').authenticateToken){
  const router=require('express').Router({mergeParams:true});
  router.use((_req,res,next)=>{res.set({'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Authorization, X-Room-Session'});next();});
  router.use('/materials/:assetId/video',require('./roomVideo').createPresentationVideoRouter(presentation,media,authenticate));
  router.use(authenticate);
  router.get('/materials/:assetId/content',async(req,res)=>{
    try{
      const content=await presentation.authorizeContent(req.user.userId,req.params.slug,req.params.assetId,req.get('X-Room-Session'),media);
      await require('./roomMediaContent').sendRoomMediaContent(res,content);
    }catch(e){if(!res.headersSent&&!res.destroyed)res.status(e.status||500).json({success:false,code:e.status?e.code:'PRESENTATION_ERROR'});}
  });return router;
}
module.exports={createRoomPresentationRouter};
