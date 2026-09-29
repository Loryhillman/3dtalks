/** Persist development-only secrets across container recreation. */
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
  ensureLocalSecrets();
  require('../src/server');
}

module.exports = { ensureLocalSecrets };
