const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let response, request, calls = 0;
class FormData { constructor() { this.fields = new Map(); } append(k,v) { this.fields.set(k,v); } }
const context = { window: { i18n: { t: key => key === 'server.failure' ? 'Translated server error' : key } }, FormData,
 localStorage: { getItem: key => key === 'adminToken' ? 'admin-token' : null },
 async fetch(url, options) { calls++; request = {url, options}; return response; } };
vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/roomModelUpload.js'), 'utf8'), context);
(async () => {
 const upload = context.window.RoomModelUpload.upload;
 await assert.rejects(upload({name:'chair.obj',size:1}), /glbRequired/);
 await assert.rejects(upload({name:'chair.glb',size:104857601}), /modelTooLarge/);
 assert.equal(calls,0);
 response = {ok:true,json:async()=>({success:true,model:{id:42,display_name:'Office chair',file_name:'chair.glb'}})};
 const file = {name:'chair.GLB',size:2000};
 const model = await upload(file);
 assert.equal(model.name,'Office chair');
 assert.equal(request.url,'/api/admin/rooms/models/upload');
 assert.equal(request.options.headers.Authorization,'Bearer admin-token');
 assert.equal(request.options.headers['Content-Type'],undefined,'Browser supplies multipart boundary');
 assert.equal(request.options.body.fields.get('model'),file);
 assert.equal(request.options.body.fields.get('display_name'),'chair');
 response={ok:false,json:async()=>({errorKey:'server.failure'})};
 await assert.rejects(upload(file),/Translated server error/);
 response={ok:false,json:async()=>{throw new Error('HTML error page');}};
 await assert.rejects(upload(file),/modelUploadFailed/);
 console.log('Room GLB upload: file validation, multipart request, admin credentials and localized failures: OK');
})().catch(error=>{console.error(error);process.exitCode=1;});
