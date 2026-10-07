const { normalizeConfig,fail } = require('./avatarValidation');
const DEFAULT = {version:1,mode:'standard',headType:'sphere',headAssetId:null,bodyColor:'#4a90e2',headColor:'#ffaa99',headScale:1,headOffset:0,headYaw:0};
function createUserAvatarService(pool, { assetInUse = () => false } = {}) {
  async function get(userId) {
    const user=(await pool.query('SELECT avatar_config,avatar_revision FROM users WHERE id=$1',[userId])).rows[0];
    if(!user)fail('ACCOUNT_NOT_FOUND',404);
    const assets=(await pool.query('SELECT id,kind,path,byte_size,metadata FROM user_avatar_assets WHERE user_id=$1 ORDER BY created_at DESC',[userId])).rows;
    return {config:Object.keys(user.avatar_config||{}).length?user.avatar_config:{...DEFAULT},revision:user.avatar_revision,assets};
  }
  async function transaction(userId,fn) {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      const user=(await client.query('SELECT avatar_config,avatar_revision FROM users WHERE id=$1 FOR UPDATE',[userId])).rows[0];
      if(!user)fail('ACCOUNT_NOT_FOUND',404);
      const result=await fn(client,user);
      await client.query('COMMIT');return result;
    }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
  }
  async function save(userId,input) {
    const config=normalizeConfig(input.config);
    return transaction(userId,async(client,user)=>{
      if(!Number.isInteger(input.revision)||input.revision!==user.avatar_revision)fail('REVISION_CONFLICT',409);
      const assetId=config.mode==='full'?config.bodyAssetId:config.headAssetId;
      if(assetId){
        const asset=(await client.query('SELECT id,kind,path,metadata FROM user_avatar_assets WHERE id=$1 AND user_id=$2',[assetId,userId])).rows[0];
        const kind=config.mode==='full'?'body':config.headType==='model'?'head':'image';
        if(!asset||asset.kind!==kind)fail('ASSET_NOT_FOUND',400);
        config.asset={id:asset.id,path:asset.path,kind:asset.kind,boneMap:asset.metadata?.boneMap||{}};
      }else if(config.mode==='full'||['model','image'].includes(config.headType))fail('ASSET_REQUIRED');
      const result=(await client.query('UPDATE users SET avatar_config=$2,avatar_revision=avatar_revision+1 WHERE id=$1 RETURNING avatar_revision',[userId,config])).rows[0];
      return {config,revision:result.avatar_revision};
    });
  }
  async function addAsset(userId,asset) {
    return transaction(userId,async client=>{
      const usage=(await client.query('SELECT COUNT(*)::int AS count,COALESCE(SUM(byte_size),0)::bigint AS bytes FROM user_avatar_assets WHERE user_id=$1',[userId])).rows[0];
      if(usage.count>=12||Number(usage.bytes)+asset.byte_size>100*1024*1024)fail('ASSET_QUOTA',409);
      await client.query('INSERT INTO user_avatar_assets(id,user_id,kind,path,byte_size,metadata) VALUES($1,$2,$3,$4,$5,$6)',[asset.id,userId,asset.kind,asset.path,asset.byte_size,asset.metadata]);
      return asset;
    });
  }
  async function removeAsset(userId,id) {
    if(typeof id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))fail('ASSET_NOT_FOUND',404);
    return transaction(userId,async(client,user)=>{
      if(assetInUse(id) || [user.avatar_config?.headAssetId,user.avatar_config?.bodyAssetId].includes(id))fail('ASSET_IN_USE',409);
      const asset=(await client.query('DELETE FROM user_avatar_assets WHERE user_id=$1 AND id=$2 RETURNING path',[userId,id])).rows[0];
      if(!asset)fail('ASSET_NOT_FOUND',404);return asset.path;
    });
  }
  return {get,save,addAsset,removeAsset};
}
module.exports={createUserAvatarService,DEFAULT};
