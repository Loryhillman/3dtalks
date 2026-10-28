// Explicit local research server. Not registered in Express or included in public/.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectGlb, LIMITS } = require('../src/services/avatarValidation');
const root = path.resolve(__dirname, '..');

async function createAvatarLab(modelPath, { demoPath, meetingCandidates = false } = {}) {
  if ((await fs.stat(modelPath)).size > LIMITS.body) throw Error('Model exceeds existing body budget');
  const model = await fs.readFile(modelPath);
  const inspection = inspectGlb(model, 'body');
  let demo;
  if (demoPath) {
    const signal = require('../tools/avatar-lipsync-lab/audio-signal');
    if ((await fs.stat(demoPath)).size > signal.MAX_BYTES) throw Error('Demo WAV exceeds lab budget');
    demo = await fs.readFile(demoPath);
    signal.parseWav(demo.buffer.slice(demo.byteOffset, demo.byteOffset + demo.byteLength));
  }
  const manifest = { ...inspection, bytes: model.length, hasDemo: !!demo,
    sha256: crypto.createHash('sha256').update(model).digest('hex') };
  const candidates = new Map();
  if (meetingCandidates) {
    for (const bundle of ['valid-business-v1','meeting-human-v1']) {
     const directory = path.join(root, 'public/assets/avatars',bundle);
     const catalog = JSON.parse(await fs.readFile(path.join(directory, 'catalog.json'), 'utf8'));
     for (const entry of catalog.models) {
      if (!/^[a-z-]+-v1$/.test(entry.id) || !/^[a-z-]+\.glb$/.test(entry.file) || entry.bytes > 8 * 1048576) throw Error('Invalid candidate catalog');
      const bytes = await fs.readFile(path.join(directory, entry.file));
      if (bytes.length !== entry.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw Error('Candidate checksum mismatch');
      const profile = inspectGlb(bytes, 'body');
      candidates.set(entry.id, { model: bytes, manifest: { ...profile, bytes: bytes.length, sha256: entry.sha256,
        hasDemo: !!demo, candidateId: entry.id, candidateLabel: entry.label } });
     }
    }
    const choices = [...candidates].map(([id, value]) => ({ id, label: value.manifest.candidateLabel }));
    for (const candidate of candidates.values()) candidate.manifest.candidates = choices;
  }
  const assets = new Map([
    ['/', ['tools/avatar-lipsync-lab/index.html', 'text/html; charset=utf-8']],
    ['/lab.js', ['tools/avatar-lipsync-lab/lab.js', 'text/javascript; charset=utf-8']],
    ['/audio-signal.js', ['tools/avatar-lipsync-lab/audio-signal.js', 'text/javascript; charset=utf-8']],
    ['/lab-audio.js', ['tools/avatar-lipsync-lab/lab-audio.js', 'text/javascript; charset=utf-8']],
    ['/lab.css', ['tools/avatar-lipsync-lab/lab.css', 'text/css; charset=utf-8']],
    ...['lib/three.min.js', 'lib/GLTFLoader.js', 'avatarBase.js', 'avatarRig.js',
      'roomSeatAvatar.js', 'userAvatarRenderer.js', 'avatarAudioSignal.js'].map(file => ['/js/' + file,
      ['public/js/' + file, 'text/javascript; charset=utf-8']])
  ]);
  const server = http.createServer(async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
      const requestUrl = new URL(req.url, 'http://localhost'), url = requestUrl.pathname;
      const candidate = candidates.size ? candidates.get(requestUrl.searchParams.get('avatar') || candidates.keys().next().value) : null;
      if (candidates.size && !candidate && ['/model.glb', '/manifest.json'].includes(url)) { res.writeHead(404); res.end('Unknown candidate'); return; }
      if (url === '/model.glb') { res.setHeader('Content-Type', 'model/gltf-binary'); res.end(candidate?.model || model); return; }
      if (url === '/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(candidate?.manifest || manifest)); return; }
      if (url === '/demo.wav' && demo) { res.setHeader('Content-Type', 'audio/wav'); res.end(demo); return; }
      const asset = assets.get(url);
      if (!asset) { res.writeHead(404); res.end('Not found'); return; }
      res.setHeader('Content-Type', asset[1]);
      res.end(await fs.readFile(path.join(root, asset[0])));
    } catch (_) { res.writeHead(500); res.end('Lab request failed'); }
  });
  return { server, manifest };
}

if (require.main === module) {
  const [modelPath, rawPort = '4187', third, fourth] = process.argv.slice(2);
  const demoPath = third === '--meeting-candidates' ? undefined : third;
  const mode = third === '--meeting-candidates' ? third : fourth;
  const port = Number(rawPort);
  if (!modelPath || !Number.isInteger(port) || port < 1024 || port > 65535 || (mode && mode !== '--meeting-candidates')) {
    console.error('Usage: node scripts/avatar-lipsync-lab.js /absolute/prepared-model.glb [port] [local-demo.wav] [--meeting-candidates]');
    process.exitCode = 1;
  } else {
    createAvatarLab(path.resolve(modelPath), { demoPath, meetingCandidates: mode === '--meeting-candidates' }).then(({ server, manifest }) => {
      server.on('error', error => { console.error(error.message); process.exitCode = 1; });
      server.listen(port, '127.0.0.1', () => {
        console.log('Avatar research lab: http://127.0.0.1:' + port);
        console.log(JSON.stringify(manifest));
      });
    }).catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
  }
}
module.exports = { createAvatarLab };
