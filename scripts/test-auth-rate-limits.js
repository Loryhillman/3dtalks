/** Regression checks for independent authentication budgets and cooldowns. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let now = 100000;
const delays = [];
const context = vm.createContext({
  module: { exports: {} },
  require(name) {
    if (name === './clientIp') return { resolveClientIp: req => req.socket.remoteAddress };
    if (name === '../database/db') return { query: async sql => ({ rows: sql.includes('COUNT') ? [{ cnt: 0 }] : [] }) };
    throw new Error(name);
  },
  Date: class extends Date { static now() { return now; } },
  console: { log() {}, warn() {}, error() {} },
  setInterval() {}, setTimeout(fn, ms) { delays.push(ms); fn(); }
});
vm.runInContext(fs.readFileSync(require.resolve('../src/middleware/loginRateLimiter'), 'utf8'), context);
const { loginRateLimiter, registerRateLimiter } = context.module.exports;
async function request(handler, ip = '198.51.100.1') {
  const result = { accepted: false, headers: {} };
  const res = { setHeader(k, v) { result.headers[k] = v; }, status(code) { result.status = code; return this; }, json(body) { result.body = body; return this; } };
  await handler({ socket: { remoteAddress: ip }, body: { username: 'alice', email: 'alice@example.invalid' } }, res, () => { result.accepted = true; });
  return result;
}
(async () => {
  const login = loginRateLimiter('user'), register = registerRateLimiter(), admin = loginRateLimiter('admin');
  for (let i = 0; i < 20; i++) assert.equal((await request(login)).accepted, true);
  assert.equal((await request(login)).status, 429);
  for (let i = 0; i < 10; i++) assert.equal((await request(register)).accepted, true);
  let denied = await request(register);
  assert.equal(denied.status, 429);
  assert.equal(denied.body.errorKey, 'authLimits.registerMinute');
  assert.equal(denied.headers['Retry-After'], '60');
  now += 30000;
  denied = await request(register);
  assert.equal(denied.body.retryAfter, 30);
  now += 30001;
  assert.equal((await request(register)).accepted, true, 'Rejected retries must not extend cooldown');
  for (let i = 0; i < 5; i++) assert.equal((await request(admin)).accepted, true);
  assert.equal((await request(admin)).status, 429, 'Admin protection is retained');
  const hourlyIp = '198.51.100.2';
  for (let minute = 0; minute < 6; minute++) {
    for (let i = 0; i < 10; i++) assert.equal((await request(register, hourlyIp)).accepted, true);
    now += 60001;
  }
  denied = await request(register, hourlyIp);
  assert.equal(denied.body.errorKey, 'authLimits.registerHour');
  assert(denied.body.retryAfter > 3000);
  assert(delays.length > 0 && delays.every(ms => ms <= 3000));
  console.log('Independent login/registration/admin budgets, retry duration, hourly limit and bounded registration delay: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
