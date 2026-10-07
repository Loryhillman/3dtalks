/** Persist application secrets across container recreation, in dev and production. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isWeakSecret } = require('../src/services/secretAutoFix');
const { ConfigurationError, validateStartupConfiguration, logStartupError } = require('../src/services/startupConfig');

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
    const content = fs.readFileSync(secretFile, 'utf8');
    try {
      saved = JSON.parse(content);
    } catch {
      throw new ConfigurationError([{ key: 'LOCAL_STATE_DIR', message: 'secrets.json is invalid JSON. Restore the secrets file from a backup.' }]);
    }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || secretKeys.some(key => saved[key] !== undefined && typeof saved[key] !== 'string')) {
      throw new ConfigurationError([{ key: 'LOCAL_STATE_DIR', message: 'secrets.json must contain an object with string secret values. Restore it from a backup.' }]);
    }
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
  try {
    if (process.env.SIMPLE_DEPLOYMENT === 'true') validateStartupConfiguration(process.env);
    try {
      ensureLocalSecrets();
    } catch (error) {
      error.startupContext = 'state';
      throw error;
    }
    require('../src/server');
  } catch (error) {
    logStartupError(error);
    process.exit(1);
  }
}

module.exports = { ensureLocalSecrets };
