/**
 * Three logging channels with independent daily files and retention:
 * access: JSONL HTTP requests, WebSocket connections and tickets (7 days).
 * ops: readable startup, migration, agent, archival and error events (30 days).
 * audit: JSONL authentication, agent keys and configuration changes (365 days).
 *
 * Each write selects the current day's file without a rotation timer.
 * One promise queue per channel serializes appends. Write failures are reported
 * without interrupting application requests. Use this module for new log events.
 *
 * Usage:
 *   const logger = require('./services/logger');
 *   logger.start();
 *   app.use(logger.httpMiddleware());
 *   logger.access({ kind: 'ws', event: 'connect' });
 *   logger.ops('Agent WebSocket started', { path: '/ws/agent' });
 *   logger.audit('session_issued', { agent: 'x', ip: '1.2.3.4' });
 */

const fs = require('fs');
const path = require('path');
const fsp = require('fs/promises');

const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

const RETENTION_DAYS = {
  access: 7,
  ops: 30,
  audit: Number(process.env.AUDIT_LOG_RETENTION_DAYS) || 365
};

const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

// 每通道一条写队列（Promise 链），保证串行 append
const queues = { access: Promise.resolve(), ops: Promise.resolve(), audit: Promise.resolve() };
let cleanupTimer = null;
let started = false;

// ==================== 基础 ====================

function dayKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function filePath(channel, date) {
  return path.join(LOG_DIR, `${channel}-${dayKey(date || new Date())}.log`);
}

function ts() { return new Date().toISOString(); }

function clientIp(req) {
  return req.ip
    || (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || (req.socket && req.socket.remoteAddress)
    || 'unknown';
}

function enqueue(channel, line) {
  const file = filePath(channel);
  queues[channel] = queues[channel]
    .then(() => fsp.appendFile(file, line + '\n', 'utf8'))
    .catch((e) => { console.error(`[logger] Failed to write ${channel}:`, e.message); });
  return queues[channel];
}

// ==================== 三通道 API ====================

/** access：结构化单行 JSON（机器消费） */
function access(fields) {
  return enqueue('access', JSON.stringify({ ts: ts(), ...fields }));
}

/** ops：人读单行（时间 + 级别 + 消息 + key=value） */
function ops(message, fields, level) {
  let line = `${ts()} [${level || 'INFO'}] ${message}`;
  if (fields && typeof fields === 'object') {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      line += ` ${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`;
    }
  }
  return enqueue('ops', line);
}

function opsError(message, fields) { return ops(message, fields, 'ERROR'); }
function opsWarn(message, fields) { return ops(message, fields, 'WARN'); }

/** audit：敏感操作，结构化 JSONL，长期保留 */
function audit(event, fields) {
  return enqueue('audit', JSON.stringify({ ts: ts(), event, ...fields }));
}

// ==================== Express 访问日志中间件 ====================

const SILENT_PATHS = new Set(['/health', '/api/health', '/favicon.ico']);

function httpMiddleware() {
  return function loggerHttpMiddleware(req, res, next) {
    const startAt = Date.now();
    res.on('finish', () => {
      const p = (req.originalUrl || req.url || '').split('?')[0];
      if (SILENT_PATHS.has(p)) return;
      access({
        kind: 'http',
        method: req.method,
        path: p,
        status: res.statusCode,
        ms: Date.now() - startAt,
        ip: clientIp(req)
      });
    });
    next();
  };
}

// ==================== 维护 ====================

async function cleanupOnce() {
  let entries;
  try { entries = await fsp.readdir(LOG_DIR); } catch (e) { return 0; }
  const now = Date.now();
  let removed = 0;
  for (const name of entries) {
    const m = /^(access|ops|audit)-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
    if (!m) continue;
    const ageDays = (now - new Date(m[2] + 'T00:00:00').getTime()) / 86400000;
    if (ageDays <= RETENTION_DAYS[m[1]]) continue;
    try { await fsp.unlink(path.join(LOG_DIR, name)); removed++; } catch (e) { /* 已删或无权限 */ }
  }
  return removed;
}

function start() {
  if (started) return;
  started = true;
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) { /* ignore */ }
  cleanupOnce().then((n) => {
    if (n > 0) ops('日志过期清理完成', { removed: n });
  }).catch(() => {});
  cleanupTimer = setInterval(() => { cleanupOnce().catch(() => {}); }, CLEANUP_INTERVAL_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
  ops('日志系统已启动', { dir: LOG_DIR, retention: JSON.stringify(RETENTION_DAYS) });
}

function stop() {
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
  started = false;
}

module.exports = {
  LOG_DIR,
  RETENTION_DAYS,
  start,
  stop,
  access,
  ops,
  opsError,
  opsWarn,
  audit,
  httpMiddleware,
  cleanupOnce,
  // 测试/诊断用
  _dayKey: dayKey,
  _filePath: filePath,
  _clientIp: clientIp
};
