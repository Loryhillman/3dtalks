// Explicit local research server. Not registered in Express or included in public/.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectGlb, LIMITS } = require('../src/services/avatarValidation');
const root = path.resolve(__dirname, '..');

async function createAvatarLab(modelPath) {
  if ((await fs.stat(modelPath)).size > LIMITS.body) throw Error('Model exceeds existing body budget');
  const model = await fs.readFile(modelPath);
  const inspection = inspectGlb(model, 'body');
  const manifest = { ...inspection, bytes: model.length,
    sha256: crypto.createHash('sha256').update(model).digest('hex') };
  const assets = new Map([
    ['/', ['tools/avatar-lipsync-lab/index.html', 'text/html; charset=utf-8']],
    ['/lab.js', ['tools/avatar-lipsync-lab/lab.js', 'text/javascript; charset=utf-8']],
    ['/lab.css', ['tools/avatar-lipsync-lab/lab.css', 'text/css; charset=utf-8']],
    ...['lib/three.min.js', 'lib/GLTFLoader.js', 'avatarBase.js', 'avatarRig.js',
      'roomSeatAvatar.js', 'userAvatarRenderer.js'].map(file => ['/js/' + file,
      ['public/js/' + file, 'text/javascript; charset=utf-8']])
  ]);
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const url = new URL(req.url, 'http://localhost').pathname;
      if (url === '/model.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(model); return; }
      if (url === '/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); return; }
      const asset = assets.get(url);
      if (!asset) { res.writeHead(404); res.end('Not found'); return; }
      res.setHeader('Content-Type', asset[1]);
      res.end(await fs.readFile(path.join(root, asset[0])));
    } catch (_) { res.writeHead(500); res.end('Lab request failed'); }
  });
  return { server, manifest };
}

if (require.main === module) {
  const [modelPath, rawPort = '4187'] = process.argv.slice(2);
  const port = Number(rawPort);
  if (!modelPath || !Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('Usage: node scripts/avatar-lipsync-lab.js /absolute/prepared-model.glb [port]');
    process.exitCode = 1;
  } else {
    createAvatarLab(path.resolve(modelPath)).then(({ server, manifest }) => {
      server.on('error', error => { console.error(error.message); process.exitCode = 1; });
      server.listen(port, '127.0.0.1', () => {
        console.log('Avatar research lab: http://127.0.0.1:' + port);
        console.log(JSON.stringify(manifest));
      });
    }).catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
  }
}
module.exports = { createAvatarLab };
