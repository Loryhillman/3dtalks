/** Static office admission; never rewrites geometry, textures or creates LODs. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { inspect, LIMITS } = require('./roomEnvironmentAsset');
const { modelPath } = require('./roomTemplateLayout');
const problem = (code,status=422) => Object.assign(new Error(code),{code,status});
async function inspectModel(pool,id,{stat=fs.stat,readFile=fs.readFile}={}) {
  if (!Number.isSafeInteger(id) || id<1) throw problem('ENVIRONMENT_MODEL_NOT_FOUND',404);
  const model=(await pool.query('SELECT * FROM uploaded_models WHERE id=$1',[id])).rows[0];
  if (!model || !modelPath(model.path) || model.file_type?.toLowerCase()!=='glb') throw problem('ENVIRONMENT_MODEL_NOT_FOUND',404);
  const file=path.join(__dirname,'../../public',model.path);
  try {
    const info=await stat(file);
    if (!info.isFile()) throw problem('ENVIRONMENT_MODEL_NOT_FOUND',404);
    if (info.size>LIMITS.bytes) throw problem('ENVIRONMENT_FILE_TOO_LARGE');
    return {model,inspection:await inspect(await readFile(file))};
  } catch(error) {
    if(error.code==='ENOENT') throw problem('ENVIRONMENT_MODEL_NOT_FOUND',404);
    throw error;
  }
}
async function store(pool,file,body,{readFile=fs.readFile,unlink=fs.unlink}={}) {
  if(!file)throw problem('INVALID_ENVIRONMENT_GLB');
  try {
    const inspection=await inspect(await readFile(file.path));
    const name=String(body.display_name||file.originalname.replace(/\.glb$/i,'')).trim().slice(0,120);
    const model=(await pool.query(`INSERT INTO uploaded_models
      (file_name,saved_file_name,path,file_type,file_size,display_name,created_at)
      VALUES ($1,$2,$3,'glb',$4,$5,NOW()) RETURNING *`,
      [file.originalname,file.filename,'/models/uploaded/'+file.filename,file.size,name])).rows[0];
    return {model,inspection};
  } catch(error) {
    await unlink(file.path).catch(e=>console.error('[roomEnvironmentImport] File cleanup failed:',e.code));
    throw error;
  }
}
module.exports={inspectModel,store};
