// Tiny self-contained static office fixture. Generated in memory, never uploaded to a real library.
function officeGlb({ units = 1 } = {}) {
  const positions = new Float32Array([- .5,- .5,- .5, .5,- .5,- .5, .5,.5,- .5, - .5,.5,- .5,
    - .5,- .5,.5, .5,- .5,.5, .5,.5,.5, - .5,.5,.5]);
  const indices = new Uint16Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]);
  const binary = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]);
  const box = (name, position, size) => ({ name, mesh: 0, translation: position.map(n => n * units), scale: size.map(n => n * units) });
  const nodes = [
    box('Floor', [0,-.05,0], [8.2,.1,6.2]),
    box('North wall', [0,1.5,-3.05], [8.2,3,.1]),
    box('South wall', [0,1.5,3.05], [8.2,3,.1]),
    box('West wall', [-4.05,1.5,0], [.1,3,6.2]),
    box('East wall', [4.05,1.5,0], [.1,3,6.2]),
    box('Ceiling', [0,3.05,0], [8.2,.1,6.2]),
    box('Table', [0,.75,0], [2,.1,1]),
    box('Chair', [0,.45,1], [.5,.1,.5])
  ];
  const document = { asset: { version: '2.0', generator: '3DTalks environment test fixture' }, scene: 0,
    scenes: [{ nodes: nodes.map((_, index) => index) }], nodes,
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-.5,-.5,-.5], max: [.5,.5,.5] },
      { bufferView: 1, componentType: 5123, count: indices.length, type: 'SCALAR' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [.7,.7,.7,1], metallicFactor: 0, roughnessFactor: 1 } }] };
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length + 8 + binary.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(binary.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, binHeader, binary]);
}
function rewriteGlb(buffer, update) {
  const length = buffer.readUInt32LE(12);
  const document = JSON.parse(buffer.subarray(20, 20 + length).toString('utf8'));
  const binLength = buffer.readUInt32LE(20 + length);
  let binary = buffer.subarray(28 + length, 28 + length + binLength);
  binary = update(document, binary) || binary;
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const bin = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + bin.length, 8);
  header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, binHeader, bin]);
}
module.exports = { officeGlb, rewriteGlb };
