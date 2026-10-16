const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { publicationErrors } = require('./roomTemplateEditor');
const { inspect } = require('./roomEnvironmentAsset');

const bundleDirectory = path.resolve(__dirname, '../../database/seeds/meeting-six-v1');
const publicDirectory = path.resolve(__dirname, '../../public');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function readBundle(directory) {
  const bytes = await fs.readFile(path.join(directory, 'manifest.json'));
  const manifest = JSON.parse(bytes);
  if (manifest.bundle !== 'meeting-six-v1' || manifest.templateKey !== 'meeting-six' ||
      typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 120 ||
      !Array.isArray(manifest.assets) || manifest.assets.length !== 3 ||
      new Set(manifest.assets.map(asset => asset.key)).size !== 3 || !Array.isArray(manifest.layout)) {
    throw new Error('Invalid built-in meeting manifest');
  }
  const assets = [];
  for (const asset of manifest.assets) {
    if (!['chair', 'table', 'office'].includes(asset.key) || asset.file !== asset.key + '.glb' ||
        !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) ||
        asset.bytes < 28 || asset.bytes > 100 * 1024 * 1024) throw new Error('Invalid built-in model manifest');
    const data = await fs.readFile(path.join(directory, asset.file));
    if (data.length !== asset.bytes || digest(data) !== asset.sha256) {
      throw new Error('Built-in model checksum mismatch: ' + asset.key);
    }
    assets.push({ ...asset, data,
      runtimePath: '/models/uploaded/default-' + manifest.bundle + '-' + asset.key + '-' + asset.sha256 + '.glb' });
  }
  const layout = manifest.layout.map(({ asset: key, ...item }) => {
    const asset = assets.find(asset => asset.key === key);
    if (!asset) throw new Error('Unknown built-in model: ' + key);
    return { ...item, model_id: 1, model_path: asset.runtimePath };
  });
  const errors = publicationErrors(layout, manifest.templateKey);
  if (errors.length) throw new Error('Invalid built-in meeting layout: ' + errors.join('; '));
  await inspect(assets.find(asset => asset.key === 'office').data);
  return { manifest, assets, layout, sha256: digest(bytes) };
}

// The source lives outside public/models: Docker's persistent model volume
// masks files baked into that directory, even after an image rebuild.
async function installFiles(assets, publicDir) {
  const directory = path.join(publicDir, 'models/uploaded');
  await fs.mkdir(directory, { recursive: true });
  for (const asset of assets) {
    const target = path.join(directory, path.basename(asset.runtimePath));
    try {
      await verifyFile(target, asset);
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = target + '.' + randomUUID() + '.tmp';
    try {
      await fs.writeFile(temporary, asset.data, { flag: 'wx' });
      // Publish a complete file without replacing one written by another process.
      try { await fs.link(temporary, target); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await verifyFile(target, asset);
    } finally { await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}

async function verifyFile(target, asset) {
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.size !== asset.bytes || digest(await fs.readFile(target)) !== asset.sha256) {
    throw new Error('Built-in model differs from the shipped file: ' + asset.key);
  }
}

async function ensureBuiltinMeeting(pool, { directory = bundleDirectory, publicDir = publicDirectory } = {}) {
  const bundle = await readBundle(directory);
  const { manifest, assets, layout } = bundle;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Use the editor's lock too: installation cannot race a draft/publication.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('room-template-editor'), hashtext($1))", [manifest.templateKey]);
    const receipt = (await client.query('SELECT * FROM room_builtin_bundles WHERE bundle_key=$1', [manifest.bundle])).rows[0];
    if (receipt) {
      if (receipt.manifest_sha256 !== bundle.sha256) throw new Error('Built-in bundle changed without a new version');
      await installFiles(assets, publicDir);
      await client.query('COMMIT');
      return { status: 'present', templateId: receipt.template_id };
    }
    const existing = (await client.query(`SELECT
      EXISTS (SELECT 1 FROM room_templates WHERE template_key=$1 AND version > 3) OR
      EXISTS (SELECT 1 FROM room_template_drafts WHERE template_key=$1) OR
      EXISTS (SELECT 1 FROM rooms WHERE template_key=$1) AS customized`, [manifest.templateKey])).rows[0];
    if (existing.customized) {
      await client.query('COMMIT');
      return { status: 'preserved' };
    }
    await installFiles(assets, publicDir);
    const models = new Map();
    for (const asset of assets) {
      const rows = (await client.query('SELECT id,file_type,file_size FROM uploaded_models WHERE path=$1 ORDER BY id FOR SHARE', [asset.runtimePath])).rows;
      if (rows.length > 1 || rows.length && (rows[0].file_type !== 'glb' || Number(rows[0].file_size) !== asset.bytes)) {
        throw new Error('Conflicting built-in model record: ' + asset.key);
      }
      const model = rows[0] || (await client.query(`INSERT INTO uploaded_models
        (file_name,saved_file_name,display_name,path,file_type,file_size,category)
        VALUES ($1,$2,$3,$4,'glb',$5,'uploaded') RETURNING id`,
      [asset.file, path.basename(asset.runtimePath), asset.name, asset.runtimePath, asset.bytes])).rows[0];
      models.set(asset.runtimePath, model.id);
    }
    for (const item of layout) item.model_id = models.get(item.model_path);
    const template = (await client.query(`INSERT INTO room_templates (template_key,version,name,layout)
      VALUES ($1,4,$2,$3::jsonb) RETURNING id`, [manifest.templateKey, manifest.name, JSON.stringify(layout)])).rows[0];
    for (const modelId of models.values()) await client.query(
      'INSERT INTO room_template_model_refs(template_id,model_id) VALUES ($1,$2)', [template.id, modelId]);
    await client.query('INSERT INTO room_builtin_bundles(bundle_key,manifest_sha256,template_id) VALUES ($1,$2,$3)',
      [manifest.bundle, bundle.sha256, template.id]);
    await client.query('COMMIT');
    return { status: 'installed', templateId: template.id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

module.exports = { ensureBuiltinMeeting, readBundle };
