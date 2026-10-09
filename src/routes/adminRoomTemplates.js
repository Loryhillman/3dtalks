function registerRoomTemplateRoutes(router, pool, logAdminAction) {
  const upload=require('multer')({storage:require('multer').memoryStorage(),limits:{fileSize:10*1024*1024,files:1}}).single('image');
  router.post('/surface-images',(req,res)=>upload(req,res,async error=>{
    try {
      if(error)throw Object.assign(new Error('Не удалось загрузить изображение. Лимит — 10 МБ'),{status:400});
      const image=await require('../services/roomSurfaceImages').storeImage(req.file?.buffer);
      res.status(201).json({success:true,image});
    }catch(e){res.status(e.status||500).json({success:false,error:e.status?e.message:'Не удалось сохранить изображение'});}
  }));
  router.post('/models/:modelId/environment-inspection',async(req,res)=>{
    try {
      const result=await require('../services/roomEnvironmentImport').inspectModel(pool,Number(req.params.modelId));
      res.json({success:true,...result});
    }catch(error){
      if(!error.status)console.error('[roomEnvironmentImport] Inspection failed:',error);
      res.status(error.status||500).json({success:false,code:error.code||'ENVIRONMENT_IMPORT_FAILED',
        errorKey:'roomEnvironmentErrors.'+(error.status?error.code:'ENVIRONMENT_IMPORT_FAILED')});
    }
  });
  const service = require('../services/roomTemplateEditor').createRoomTemplateEditor(pool);
  const handle = operation => async (req, res) => {
    try { res.json({ success: true, ...await operation(req) }); }
    catch (error) {
      if (!error.status) console.error('[roomTemplates]', error);
      res.status(error.status || 500).json({ success: false, code: error.code || 'TEMPLATE_ERROR',
        error: error.status ? error.message : 'Не удалось сохранить шаблон' });
    }
  };
  router.post('/templates/:key/draft', handle(async req => ({ draft: await service.getDraft(req.params.key, req.adminUser.id) })));
  router.put('/templates/:key/draft', handle(async req => {
    const draft = await service.save(req.params.key, req.body, req.adminUser.id);
    await logAdminAction(req.adminUser.id, 'SAVE_ROOM_TEMPLATE', 'room_templates', null, req.params.key + ' revision ' + draft.revision, req.ip);
    return { draft };
  }));
  router.post('/templates/:key/publish', handle(async req => {
    const result = await service.publish(req.params.key, req.body?.revision);
    await logAdminAction(req.adminUser.id, 'PUBLISH_ROOM_TEMPLATE', 'room_templates', null, req.params.key + ' v' + result.version, req.ip);
    return result;
  }));
}
module.exports = { registerRoomTemplateRoutes };
