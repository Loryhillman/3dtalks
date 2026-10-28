const assert = require('node:assert/strict');
const sharp = require('sharp');
const { inspect } = require('../src/services/roomEnvironmentAsset');
const { officeGlb, rewriteGlb } = require('./room-environment-fixtures');
(async () => {
  const fixture = officeGlb();
  assert.equal((await inspect(fixture)).triangles, 96, 'count repeated furniture meshes, not just distinct meshes');
  assert.equal((await inspect(officeGlb({ units: 1000 }))).nodes, 8);
  for (const [change, code] of [
    [json => { json.buffers[0].uri = 'https://example.test/buffer.bin'; }, 'ENVIRONMENT_EXTERNAL_RESOURCE'],
    [json => { json.images = [{ uri: 'data:image/png;base64,AAAA' }]; }, 'ENVIRONMENT_EXTERNAL_RESOURCE'],
    [json => { json.extensionsRequired = ['KHR_texture_basisu']; }, 'UNSUPPORTED_ENVIRONMENT_EXTENSION'],
    [json => { json.extensionsRequired = ['KHR_materials_pbrSpecularGlossiness']; }, 'UNSUPPORTED_ENVIRONMENT_EXTENSION'],
    [json => { json.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: {} }; }, 'UNSUPPORTED_ENVIRONMENT_EXTENSION'],
    [json => { json.animations = [{}]; }, 'ENVIRONMENT_MUST_BE_STATIC'],
    [json => { json.nodes[0].children = [0]; }, 'INVALID_ENVIRONMENT_GLB'],
    [json => { json.nodes[0].children = [1]; json.nodes[1].children = [0]; }, 'INVALID_ENVIRONMENT_GLB'],
    [json => { json.scenes.push({ nodes: [0] }); }, 'ENVIRONMENT_SINGLE_SCENE_REQUIRED'],
    [json => { json.bufferViews[0].byteLength = 999999; }, 'INVALID_ENVIRONMENT_GLB'],
    [json => { json.accessors[0].count = 999999; }, 'INVALID_ENVIRONMENT_GLB'],
    [json => { json.meshes[0].primitives[0].mode = 1; }, 'ENVIRONMENT_MUST_BE_STATIC_TRIANGLES'],
    [json => { json.nodes = Array.from({ length: 4097 }, () => ({ mesh: 0 })); }, 'ENVIRONMENT_TOO_COMPLEX']
  ]) await assert.rejects(inspect(rewriteGlb(fixture, change)), { code });
  await assert.rejects(inspect(fixture.subarray(0, fixture.length - 1)), { code: 'INVALID_ENVIRONMENT_GLB' });
  await assert.rejects(inspect(rewriteGlb(fixture, (_json, binary) => { const copy = Buffer.from(binary); copy.writeFloatLE(NaN, 0); return copy; })), { code: 'INVALID_ENVIRONMENT_GLB' });
  await assert.rejects(inspect(rewriteGlb(fixture, (_json, binary) => { const copy = Buffer.from(binary); copy.writeUInt16LE(99, 96); return copy; })), { code: 'INVALID_ENVIRONMENT_GLB' });
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
  function withImage(image) {
    return rewriteGlb(fixture, (json, binary) => {
      json.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: image.length });
      json.images = [{ bufferView: 2, mimeType: 'image/png' }]; json.textures = [{ source: 0 }];
      json.buffers[0].byteLength = binary.length + image.length;
      return Buffer.concat([binary, image]);
    });
  }
  assert.equal((await inspect(withImage(png))).pixels, 6, 'decode embedded texture metadata');
  const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#000000' } }).png().toBuffer();
  await assert.rejects(inspect(withImage(wide)), { code: 'ENVIRONMENT_TEXTURE_TOO_LARGE' });
  const large = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: '#000000' } }).png().toBuffer();
  const manyImages = rewriteGlb(withImage(large), json => { json.images.push({ ...json.images[0] }, { ...json.images[0] }); });
  await assert.rejects(inspect(manyImages), { code: 'ENVIRONMENT_TEXTURE_TOO_LARGE' }, 'aggregate pixels are limited even when every image fits the side limit');
  console.log('Environment assets: static self-contained GLB, topology, draw counts, malformed files and embedded texture limits OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
