/** Persist application secrets across container recreation, in dev and production. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isWeakSecret } = require('../src/services/secretAutoFix');

const secretKeys = [
  'JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'AGENT_JWT_SECRET',
  'CONFIG_ENCRYPTION_KEY'
];

function ensureLocalSecrets(stateDir = process.env.LOCAL_STATE_DIR || path.join(__dirname, '..', '.local-state')) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const secretFile = path.join(stateDir, 'secrets.json');
  let saved = {};
  if (fs.existsSync(secretFile)) {
    saved = JSON.parse(fs.readFileSync(secretFile, 'utf8'));
  }

  let changed = false;
  for (const key of secretKeys) {
    if (!isWeakSecret(process.env[key])) continue;
    if (isWeakSecret(saved[key])) {
      saved[key] = crypto.randomBytes(32).toString('hex');
      changed = true;
    }
    process.env[key] = saved[key];
  }

  if (changed) {
    const tempFile = `${secretFile}.${process.pid}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(saved, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tempFile, secretFile);
  }
  return Object.fromEntries(secretKeys.map(key => [key, process.env[key]]));
}

if (require.main === module) {
  if (process.env.SIMPLE_DEPLOYMENT === 'true') {
    const required = ['DB_PASSWORD', 'WORLD_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];
    for (const key of required) {
      if (!process.env[key]?.trim()) throw new Error(`Fill ${key} in .env before starting`);
    }
    const url = new URL(process.env.WORLD_URL);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('WORLD_URL must be a site address, e.g. http://localhost:3002');
    }
  }
  ensureLocalSecrets();
  require('../src/server');
}

module.exports = { ensureLocalSecrets };
