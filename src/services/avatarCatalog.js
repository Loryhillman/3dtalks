// Server-owned preset IDs and paths. User input never supplies built-in asset metadata.
const bundles = ['valid-business-v1','meeting-human-v1'];
const models = bundles.flatMap(bundle => require('../../public/assets/avatars/'+bundle+'/catalog.json').models.map(entry => ({...entry,bundle})));
const presets = new Map(models.map(entry => [entry.id, entry]));
const DEFAULT_ID = 'valid-business-v1';
const LEGACY_DEFAULT = {version:1,mode:'standard',headType:'sphere',headAssetId:null,bodyColor:'#4a90e2',headColor:'#ffaa99',headScale:1,headOffset:0,headYaw:0};
function presetConfig(id) {
  const preset = presets.get(id);
  if (!preset) return null;
  return { version:1, mode:'builtin', builtinId:id, bodyYaw:0,
    asset:{kind:'body',path:'/assets/avatars/'+preset.bundle+'/'+preset.file,boneMap:{...preset.boneMap}} };
}
function listPresets() {
  return models.map(entry => ({id:entry.id,label:entry.label,labelKey:entry.labelKey||'avatar.'+(entry.id==='male-asian-v1'?'builtinMale':'builtinFemale'),config:presetConfig(entry.id)}));
}
function resolveConfig(stored) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !Object.keys(stored).length) return presetConfig(DEFAULT_ID);
  if (stored.mode === 'builtin') return presetConfig(stored.builtinId) || presetConfig(DEFAULT_ID);
  // Upgrade only the exact old default. Any custom head, image, color or calibration survives.
  if (Object.keys(stored).every(key => Object.hasOwn(LEGACY_DEFAULT,key)) &&
      Object.entries(LEGACY_DEFAULT).every(([key,value]) => stored[key] === value)) return presetConfig(DEFAULT_ID);
  return {...stored};
}
module.exports = {DEFAULT_ID,LEGACY_DEFAULT,presetConfig,listPresets,resolveConfig};
