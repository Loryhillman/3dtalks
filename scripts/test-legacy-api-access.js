const assert = require('node:assert/strict');
const http = require('node:http');
const Module = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

const originalLoad = Module._load;
const originalMode = process.env.APP_MODE;
const originalSecret = process.env.ADMIN_JWT_SECRET;
process.env.ADMIN_JWT_SECRET = 'test-only-administrator-secret';
let dataQueries = 0;
let providerReads = 0;
const database = { query: async sql => {
  if (sql.includes('FROM admin_users')) return { rows: [{ id: 1, is_active: true }] };
  dataQueries++;
  return { rows: [] };
} };
database.pool = database;

// Keep real Express routing, Multer and administrator JWT verification.
// Replace storage and expensive model processing; forbidden requests must
// never reach either of them.
Module._load = function(name, parent, ...args) {
  if (parent?.filename.includes('/src/') && name === '../database/db') return database;
  if (parent?.filename.endsWith('/routes/uploadedModels.js') && name.startsWith('../services/')) return {};
  if (parent?.filename.endsWith('/routes/aiProviders.js') && name === '../services/aiProviderService') {
    return { getProvider: async (_id, sensitive) => {
      providerReads++;
      return { configs: [{ value: sensitive ? 'fixture-secret' : '********' }] };
    } };
  }
  return originalLoad(name, parent, ...args);
};

let server;
(async () => {
  const models = require('../src/routes/uploadedModels');
  const metadata = require('../src/routes/uploadedModelMeta');
  const providers = require('../src/routes/aiProviders');
  const media = require('../src/routes/media');
  const config = require('../src/routes/config');
  Module._load = originalLoad;
  const app = express();
  app.use(express.json());
  // Metadata mounts before models in legacy mode; its own guard is required.
  app.use('/api', metadata);
  app.use('/api', models);
  app.use('/api/ai-providers', providers);
  app.use('/api/media', media);
  app.use('/api/config', config);
  app.get('/api/unrelated', (_req, res) => res.json({ ok: true }));
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const userToken = jwt.sign({ userId: 1 }, process.env.ADMIN_JWT_SECRET);
  const adminToken = jwt.sign({ type: 'admin', adminUserId: 1 }, process.env.ADMIN_JWT_SECRET);

  process.env.APP_MODE = 'rooms';
  for (const [method, path] of [
    ['POST', '/upload-model'], ['POST', '/UPLOAD-MODEL/'],
    ['POST', '/upload-models-batch'], ['DELETE', '/uploaded-models/1'],
    ['PUT', '/uploaded-models/1/tags'], ['POST', '/uploaded-models/1/decimate']
  ]) {
    const response = await fetch(base + '/api' + path, { method });
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).code, 'FEATURE_UNAVAILABLE');
  }
  for (const token of [null, userToken]) {
    const response = await fetch(base + '/api/admin/rooms/models/upload', {
      method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}
    });
    assert.equal(response.status, token ? 403 : 401);
  }
  const allowedUpload = await fetch(base + '/api/admin/rooms/models/upload', {
    method: 'POST', headers: { Authorization: 'Bearer ' + adminToken }
  });
  assert.equal(allowedUpload.status, 400, 'administrator reached upload handler: file is required');
  for (const path of ['/weather', '/world-settings', '/character-editor']) {
    assert.equal((await fetch(base + '/api/config' + path)).status, 404);
  }
  assert.equal((await fetch(base + '/api/unrelated')).status, 200, 'shared /api router must pass unrelated routes');
  assert.equal(dataQueries, 0, 'blocked requests did no application queries');

  process.env.APP_MODE = 'world';
  for (const [method, path] of [
    ['POST', '/api/upload-model'], ['DELETE', '/api/uploaded-models/1'],
    ['PUT', '/api/uploaded-models/1/agent-description'],
    ['POST', '/api/media/upload'], ['DELETE', '/api/media/images/img-fixture.png'],
    ['GET', '/api/ai-providers/providers/1?include_sensitive=true'],
    ['POST', '/api/ai-providers/providers/1/config'], ['PUT', '/api/config/seo']
  ]) {
    for (const token of [null, userToken]) {
      const response = await fetch(base + path, {
        method, headers: token ? { Authorization: 'Bearer ' + token } : {}
      });
      assert.equal(response.status, token ? 403 : 401, path);
    }
  }
  assert.equal(providerReads, 0, 'sensitive configuration was not read');
  assert.equal(dataQueries, 0, 'unauthorized mutations did no application queries');
  const allowed = await fetch(base + '/api/ai-providers/providers/1?include_sensitive=true', {
    headers: { Authorization: 'Bearer ' + adminToken }
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).provider.configs[0].value, 'fixture-secret');
  assert.equal((await fetch(base + '/api/config/language')).status, 200);
  console.log('Legacy API access: room endpoints isolated, administrator upload preserved, file mutations and secrets protected OK');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  Module._load = originalLoad;
  if (server) await new Promise(resolve => server.close(resolve));
  for (const [key, value] of [['APP_MODE', originalMode], ['ADMIN_JWT_SECRET', originalSecret]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
