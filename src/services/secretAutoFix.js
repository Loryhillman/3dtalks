/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * JWT secret initialization.
 * Detect missing, placeholder or short JWT_SECRET / ADMIN_JWT_SECRET values.
 *       Generate random replacements and persist them in .env.
 * Call autoFixSecrets() after loading environment variables.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Known weak secret and placeholder patterns (case insensitive).
const WEAK_PATTERNS = [
  'your_secret_key_change_this',
  'your_admin_secret_key_change_this',
  'your_jwt_secret_change_this',
  'your_admin_jwt_secret_change_this',
  'change_this_in_production',
  'your_secret_key',
  'your_jwt_secret',
  'admin_secret',
  'jwt_secret',
  'secret',
  'password',
  '123456'
];

// Protected secret keys.
const PROTECTED_KEYS = ['JWT_SECRET', 'ADMIN_JWT_SECRET'];

/**
 * Check whether a secret is missing or weak.
 * @param {string} value Secret value.
 * @returns {boolean}
 */
function isWeakSecret(value) {
  if (!value || value.trim() === '') return true;
  if (value.length < 16) return true; // Reject short values.
  const lower = value.toLowerCase();
  for (const pattern of WEAK_PATTERNS) {
    if (lower.includes(pattern)) return true;
  }
  return false;
}

/**
 * Generate a random secret as 64 hexadecimal characters.
 * @returns {string}
 */
function generateSecureSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Replace a key in .env, appending it if absent.
 * @param {string} envContent .env file content.
 * @param {string} key Key name.
 * @param {string} newValue New value.
 * @returns {string} Updated content.
 */
function replaceEnvValue(envContent, key, newValue) {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${newValue}`);
  }
  // Append keys that are absent from the file.
  const suffix = envContent.endsWith('\n') ? '' : '\n';
  return `${envContent}${suffix}${key}=${newValue}\n`;
}

/**
 * Detect and replace weak secrets.
 * Call after dotenv.config().
 */
function autoFixSecrets() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  const examplePath = path.join(__dirname, '..', '..', '.env.example');

  // Find all weak secrets.
  const weakKeys = PROTECTED_KEYS.filter(key => isWeakSecret(process.env[key]));
  if (weakKeys.length === 0) return; // Existing values are valid.

  // Read .env, falling back to .env.example.
  // Strip a UTF-8 BOM so the first key can be matched.
  // Windows editors and PowerShell may write a BOM.
  const stripBOM = (text) => (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  let envContent = '';
  if (fs.existsSync(envPath)) {
    try {
      envContent = stripBOM(fs.readFileSync(envPath, 'utf-8'));
    } catch (err) {
      console.warn('[Secrets] Cannot read .env:', err.message);
    }
  }
  if (!envContent && fs.existsSync(examplePath)) {
    try {
      envContent = stripBOM(fs.readFileSync(examplePath, 'utf-8'));
    } catch (err) {
      console.warn('[Secrets] Cannot read .env.example:', err.message);
    }
  }

  // Generate a random replacement for each weak secret.
  const newSecrets = {};
  for (const key of weakKeys) {
    newSecrets[key] = generateSecureSecret();
    process.env[key] = newSecrets[key]; // Apply immediately in memory.
    console.log(`[Secrets] ${key} was weak or missing; generated a random replacement.`);
  }

  // Persist replacements in .env.
  if (!envContent) {
    // Create a minimal configuration when no template exists.
    envContent = weakKeys.map(key => `${key}=${newSecrets[key]}`).join('\n') + '\n';
  } else {
    for (const key of weakKeys) {
      envContent = replaceEnvValue(envContent, key, newSecrets[key]);
    }
  }

  try {
    fs.writeFileSync(envPath, envContent, 'utf-8');
    console.log('[Secrets] Updated .env with random secrets.');
    console.log('[Secrets] Future restarts will reuse the saved secrets.');
  } catch (err) {
    console.warn('[Secrets] Cannot write .env; generated secrets are only valid for this process.');
    console.warn('[Secrets] Update the following settings in .env:');
    for (const key of weakKeys) {
      console.warn(`[Secrets]   ${key}=${newSecrets[key]}`);
    }
  }
}

module.exports = { autoFixSecrets, isWeakSecret };
