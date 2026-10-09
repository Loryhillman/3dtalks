/** Bounded import policy for static, self-contained offices. Not a general glTF validator. */
const LIMITS = Object.freeze({ bytes: 100 * 1024 * 1024, json: 4 * 1024 * 1024,
  nodes: 4096, meshes: 1024, primitives: 4096, triangles: 300000, materials: 128,
  images: 64, textureSide: 4096, texturePixels: 32 * 1024 * 1024 });
const extensions = new Set(['KHR_materials_unlit','KHR_materials_transmission','KHR_materials_volume',
  'KHR_materials_ior','KHR_materials_clearcoat','KHR_materials_sheen','KHR_materials_specular',
  'KHR_materials_emissive_strength','KHR_texture_transform','EXT_texture_webp']);
const fail = code => { throw Object.assign(new Error(code), { code, status: 422 }); };
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const reference = (array, id) => integer(id) && id < array.length;

async function inspectData(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length > LIMITS.bytes) fail('ENVIRONMENT_FILE_TOO_LARGE');
  if (buffer.length < 28 || buffer.readUInt32LE(0) !== 0x46546c67 || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) fail('INVALID_ENVIRONMENT_GLB');
  let offset = 12, json, binary;
  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) fail('INVALID_ENVIRONMENT_GLB');
    const length = buffer.readUInt32LE(offset), type = buffer.readUInt32LE(offset + 4); offset += 8;
    if (!length || length % 4 || offset + length > buffer.length) fail('INVALID_ENVIRONMENT_GLB');
    if (type === 0x4e4f534a && offset === 20 && length <= LIMITS.json) {
      json = JSON.parse(buffer.subarray(offset, offset + length).toString('utf8'));
    } else if (type === 0x004e4942 && json && !binary) binary = buffer.subarray(offset, offset + length);
    else fail('INVALID_ENVIRONMENT_GLB');
    offset += length;
  }
  if (!json || !binary || json.asset?.version !== '2.0') fail('INVALID_ENVIRONMENT_GLB');
  for (const key of ['nodes','meshes','materials','images','buffers','bufferViews','accessors','scenes','textures','skins','animations','extensionsUsed','extensionsRequired']) {
    if (json[key] !== undefined && !Array.isArray(json[key])) fail('INVALID_ENVIRONMENT_GLB');
  }
  if (json.buffers?.length !== 1 || json.buffers[0].uri !== undefined || !integer(json.buffers[0].byteLength, 1) ||
      json.buffers[0].byteLength > binary.length || binary.length - json.buffers[0].byteLength > 3) fail('ENVIRONMENT_EXTERNAL_RESOURCE');
  if ([...(json.extensionsUsed || []), ...(json.extensionsRequired || [])].some(name => !extensions.has(name))) fail('UNSUPPORTED_ENVIRONMENT_EXTENSION');
  // Inspect actual extension usage too; declarations in uploaded JSON are not trusted.
  function checkExtensions(value, depth = 0) {
    if (depth > 64) fail('INVALID_ENVIRONMENT_GLB');
    if (!value || typeof value !== 'object') return;
    if (value.extensions && Object.keys(value.extensions).some(name => !extensions.has(name))) fail('UNSUPPORTED_ENVIRONMENT_EXTENSION');
    for (const [key, child] of Object.entries(value)) if (key !== 'extras') checkExtensions(child, depth + 1);
  }
  checkExtensions(json);
  if ((json.skins || []).length || (json.animations || []).length) fail('ENVIRONMENT_MUST_BE_STATIC');
  const nodes = json.nodes || [], meshes = json.meshes || [], images = json.images || [], views = json.bufferViews || [], accessors = json.accessors || [];
  if (!nodes.length || !meshes.length || nodes.length > LIMITS.nodes || meshes.length > LIMITS.meshes ||
      (json.materials || []).length > LIMITS.materials || images.length > LIMITS.images || views.length > 16384 || accessors.length > 16384) fail('ENVIRONMENT_TOO_COMPLEX');
  for (const view of views) if (view.buffer !== 0 || !integer(view.byteOffset ?? 0) || !integer(view.byteLength, 1) ||
      (view.byteOffset ?? 0) + view.byteLength > json.buffers[0].byteLength) fail('INVALID_ENVIRONMENT_GLB');
  const component = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  for (const accessor of accessors) {
    if (!reference(views, accessor.bufferView) || accessor.sparse) fail('UNSUPPORTED_ENVIRONMENT_ACCESSOR');
    const view = views[accessor.bufferView], size = component[accessor.componentType] * dimensions[accessor.type];
    const stride = view.byteStride ?? size, start = accessor.byteOffset ?? 0;
    if (!size || !integer(accessor.count, 1) || !integer(start) || !integer(stride, size) ||
        (start + (view.byteOffset ?? 0)) % component[accessor.componentType] || stride % component[accessor.componentType] ||
        start + (accessor.count - 1) * stride + size > view.byteLength) fail('INVALID_ENVIRONMENT_GLB');
  }
  let primitives = 0;
  let sourceVertices = 0;
  const checkedPositions = new Set(), checkedIndices = new Set();
  const meshTriangles = meshes.map(mesh => {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) fail('INVALID_ENVIRONMENT_GLB');
    return mesh.primitives.reduce((sum, primitive) => {
      if (++primitives > LIMITS.primitives) fail('ENVIRONMENT_TOO_COMPLEX');
      if (primitive.mode !== undefined && primitive.mode !== 4 || primitive.targets) fail('ENVIRONMENT_MUST_BE_STATIC_TRIANGLES');
      const position = accessors[primitive.attributes?.POSITION];
      if (!reference(accessors, primitive.attributes?.POSITION) || position.type !== 'VEC3' || position.componentType !== 5126) fail('INVALID_ENVIRONMENT_GLB');
      if (![position.min, position.max].every(values => Array.isArray(values) && values.length === 3 && values.every(n => typeof n === 'number' && Number.isFinite(n))) ||
          position.min.some((n, axis) => n > position.max[axis])) fail('INVALID_ENVIRONMENT_GLB');
      if (!checkedPositions.has(primitive.attributes.POSITION)) {
        sourceVertices += position.count;
        if (sourceVertices > LIMITS.triangles * 3) fail('ENVIRONMENT_TOO_COMPLEX');
        const view = views[position.bufferView], start = (view.byteOffset ?? 0) + (position.byteOffset ?? 0), stride = view.byteStride ?? 12;
        for (let i = 0; i < position.count; i++) for (let axis = 0; axis < 3; axis++) if (!Number.isFinite(binary.readFloatLE(start + i * stride + axis * 4))) fail('INVALID_ENVIRONMENT_GLB');
        checkedPositions.add(primitive.attributes.POSITION);
      }
      for (const id of Object.values(primitive.attributes)) if (!reference(accessors, id)) fail('INVALID_ENVIRONMENT_GLB');
      if (primitive.material !== undefined && !reference(json.materials || [], primitive.material)) fail('INVALID_ENVIRONMENT_GLB');
      let count = position.count;
      if (primitive.indices !== undefined) {
        if (!reference(accessors, primitive.indices)) fail('INVALID_ENVIRONMENT_GLB');
        const index = accessors[primitive.indices];
        if (index.type !== 'SCALAR' || ![5121,5123,5125].includes(index.componentType)) fail('INVALID_ENVIRONMENT_GLB');
        count = index.count;
        if (count > LIMITS.triangles * 3) fail('ENVIRONMENT_TOO_COMPLEX');
        const key = primitive.indices + ':' + position.count;
        if (!checkedIndices.has(key)) {
          const view = views[index.bufferView], start = (view.byteOffset ?? 0) + (index.byteOffset ?? 0);
          const width = component[index.componentType], stride = view.byteStride ?? width;
          for (let i = 0; i < count; i++) if (binary.readUIntLE(start + i * stride, width) >= position.count) fail('INVALID_ENVIRONMENT_GLB');
          checkedIndices.add(key);
        }
      }
      if (count % 3) fail('INVALID_ENVIRONMENT_GLB');
      return sum + count / 3;
    }, 0);
  });
  const parents = new Map();
  let triangles = 0;
  nodes.forEach((node, index) => {
    if (node.skin !== undefined || node.weights) fail('ENVIRONMENT_MUST_BE_STATIC');
    for (const [key, length] of [['matrix',16],['translation',3],['rotation',4],['scale',3]]) if (node[key] !== undefined &&
        (!Array.isArray(node[key]) || node[key].length !== length || node[key].some(n => typeof n !== 'number' || !Number.isFinite(n)))) fail('INVALID_ENVIRONMENT_GLB');
    if (node.mesh !== undefined) {
      if (!reference(meshes, node.mesh)) fail('INVALID_ENVIRONMENT_GLB');
      triangles += meshTriangles[node.mesh];
    }
    if (node.children !== undefined && !Array.isArray(node.children)) fail('INVALID_ENVIRONMENT_GLB');
    for (const child of node.children || []) {
      if (!reference(nodes, child) || child === index || parents.has(child)) fail('INVALID_ENVIRONMENT_GLB');
      parents.set(child, index);
    }
  });
  if (!triangles || triangles > LIMITS.triangles) fail('ENVIRONMENT_TOO_COMPLEX');
  for (let index = 0; index < nodes.length; index++) {
    let depth = 0;
    for (let parent = index; parent !== undefined; parent = parents.get(parent)) if (++depth > 128) fail('INVALID_ENVIRONMENT_GLB');
  }
  if (json.scenes?.length !== 1 || json.scene !== undefined && json.scene !== 0 || !Array.isArray(json.scenes[0].nodes)) fail('ENVIRONMENT_SINGLE_SCENE_REQUIRED');
  const reachable = new Set();
  function visit(id) {
    if (!reference(nodes, id) || reachable.has(id)) fail('INVALID_ENVIRONMENT_GLB');
    reachable.add(id); for (const child of nodes[id].children || []) visit(child);
  }
  for (const id of json.scenes[0].nodes) { if (parents.has(id)) fail('INVALID_ENVIRONMENT_GLB'); visit(id); }
  if (![...reachable].some(id => nodes[id].mesh !== undefined)) fail('INVALID_ENVIRONMENT_GLB');
  let pixels = 0;
  for (const image of images) {
    if (image.uri !== undefined || !reference(views, image.bufferView) || !['image/png','image/jpeg','image/webp'].includes(image.mimeType)) fail('ENVIRONMENT_EXTERNAL_RESOURCE');
    const view = views[image.bufferView], start = view.byteOffset ?? 0;
    const bytes = binary.subarray(start, start + view.byteLength);
    const format = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[image.mimeType];
    const signature = format === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) :
      format === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
        bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!signature) fail('INVALID_ENVIRONMENT_GLB');
    const metadata = await require('sharp')(bytes, { limitInputPixels: LIMITS.texturePixels }).metadata();
    if (metadata.format !== format) fail('INVALID_ENVIRONMENT_GLB');
    if (!metadata.width || !metadata.height || metadata.pages > 1 || metadata.width > LIMITS.textureSide || metadata.height > LIMITS.textureSide) fail('ENVIRONMENT_TEXTURE_TOO_LARGE');
    pixels += metadata.width * metadata.height;
    if (pixels > LIMITS.texturePixels) fail('ENVIRONMENT_TEXTURE_TOO_LARGE');
  }
  for (const texture of json.textures || []) {
    const source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    if (!reference(images, source)) fail('INVALID_ENVIRONMENT_GLB');
  }
  return { triangles, nodes: nodes.length, meshes: meshes.length, materials: (json.materials || []).length, images: images.length, pixels };
}
async function inspect(buffer) {
  try { return await inspectData(buffer); }
  catch (error) { if (error.status) throw error; fail('INVALID_ENVIRONMENT_GLB'); }
}
module.exports = { LIMITS, inspect };
