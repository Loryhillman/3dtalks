const { isIP } = require('node:net');

class ConfigurationError extends Error {
  constructor(issues) {
    super('Invalid application configuration');
    this.code = 'CONFIG_INVALID';
    this.issues = issues;
  }
}

function requireValid(issues) {
  if (issues.length) throw new ConfigurationError(issues);
}

function adminConfigurationIssues(env) {
  const issues = [];
  const username = env.ADMIN_USERNAME?.trim();
  const password = env.ADMIN_PASSWORD;
  if (!username || username.length > 50 || /[\x00-\x1f\x7f]/.test(username)) {
    issues.push({ key: 'ADMIN_USERNAME', message: 'Use 1–50 characters without control characters.' });
  }
  if (!password?.trim() || [...password].length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    issues.push({ key: 'ADMIN_PASSWORD', message: 'Use at least 12 characters and at most 72 UTF-8 bytes.' });
  }
  return issues;
}

function validateStartupConfiguration(env) {
  const issues = [];
  for (const key of ['DB_PASSWORD', 'WORLD_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD']) {
    if (!env[key]?.trim()) issues.push({ key, message: 'Required; fill this setting in .env.' });
  }
  if (env.WORLD_URL?.trim()) {
    try {
      const url = new URL(env.WORLD_URL);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    } catch {
      issues.push({ key: 'WORLD_URL', message: 'Use a site address such as http://localhost:3002, without credentials, a path or query parameters.' });
    }
  }
  for (const key of ['PORT', 'HTTP_PORT', 'DB_PORT']) {
    if (env[key] !== undefined && (!/^\d+$/.test(env[key]) || Number(env[key]) < 1 || Number(env[key]) > 65535)) {
      issues.push({ key, message: 'Use an integer between 1 and 65535.' });
    }
  }
  if (env.BIND_ADDRESS !== undefined && !isIP(env.BIND_ADDRESS.replace(/^\[|\]$/g, ''))) {
    issues.push({ key: 'BIND_ADDRESS', message: 'Use an IP address: 127.0.0.1 for local access or 0.0.0.0 for public access.' });
  }
  if (env.TRUST_PROXY !== undefined) {
    const proxy = env.TRUST_PROXY.trim().toLowerCase();
    if (!['true', 'false', 'on', 'off', 'yes', 'no', '0'].includes(proxy) && !/^[1-9]\d*$/.test(proxy)) {
      issues.push({ key: 'TRUST_PROXY', message: 'Use true, false or a positive integer proxy hop count.' });
    }
  }
  requireValid(issues);
}

// Error text never includes a supplied configuration value or password.
function logStartupError(error, log = console.error) {
  if (error.code === 'CONFIG_INVALID') {
    for (const issue of error.issues) log(`[CONFIG] ${issue.key}: ${issue.message}`);
  } else if (error.code === '28P01' || error.code === '28000') {
    log('[CONFIG] DB_PASSWORD / DB_USER: PostgreSQL rejected the credentials. Use the existing database credentials; changing .env does not reset a stored database password.');
  } else if (error.code === '3D000') {
    log('[CONFIG] DB_NAME: The PostgreSQL database does not exist. Check the database name and initialization.');
  } else if (['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT'].includes(error.code)) {
    log('[CONFIG] DB_HOST / DB_PORT: Cannot connect to PostgreSQL. Check its container, address, port and network.');
  } else if (error.startupContext === 'state') {
    log('[CONFIG] LOCAL_STATE_DIR: Cannot read or write persistent application secrets. Check the state volume and its permissions.');
  } else {
    log('[STARTUP] Failed to start the application:', error);
    return;
  }
  log('[STARTUP] Application stopped. Correct the settings and run docker compose up -d.');
}

module.exports = { ConfigurationError, requireValid, adminConfigurationIssues, validateStartupConfiguration, logStartupError };
