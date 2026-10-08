// Optional integrations belong to the legacy world, not meeting rooms.
// Load their modules lazily: several register timers or perform setup on import.
function isRoomsMode() { return process.env.APP_MODE === 'rooms'; }
function unavailable(_req, res) {
  res.status(404).json({ success: false, code: 'FEATURE_UNAVAILABLE', error: 'This feature is unavailable in rooms mode' });
}
const legacyGameRoutes = [
  ['/api/shop', 'shop'], ['/api/plot', 'plot'], ['/api/skills', 'skills'],
  ['/api/monster', 'monster'], ['/api/portal', 'portal'], ['/api/inventory', 'inventory'],
  ['/api/npc', 'npc'], ['/api/custom-npc', 'customNpc'], ['/api/character-templates', 'characterTemplates']
];
const legacyToolRoutes = [
  ['/api/tripo', 'tripo'], ['/api/ai', 'aiAssistant'],
  ['/api/geometry-building', 'geometryBuilding'],
  ['/api/ai-providers', 'aiProviders'], ['/api/ai-scene', 'aiSceneGenerator'],
  ['/api/media', 'media'], ['/api/tags', 'tags'], ['/api/three-dgs', 'threeDgs'],
  ['/api/ai-factory', 'aiFactory'], ['/api/gallery', 'gallery'],
  ['/api/model-guard', 'modelGuard'], ['/api/admin/model-guard', 'modelGuard'],
  ['/api/threejs-blocks', 'threejsCodeBlocks'], ['/api/threejs-blocks', 'threejsImport'],
  ['/api/subscription', 'subscription'], ['/api/ui-controls', 'uiControls'],
  ['/api/sky', 'sky']
];
function registerLegacyToolRoutes(app, load = require) {
  for (const [prefix, name] of legacyToolRoutes) {
    if (isRoomsMode()) app.use(prefix, unavailable);
    else {
      const module = load('../routes/' + name);
      app.use(prefix, module.router || module);
    }
  }
  // This router used the shared /api prefix; mount only its actual resource.
  if (isRoomsMode()) app.use('/api/uploaded-models', unavailable);
  else app.use('/api', load('../routes/uploadedModelMeta'));
}
function registerLegacyGameRoutes(app, load = require) {
  if (isRoomsMode()) {
    for (const prefix of ['/api/world', '/api/public/character-templates', ...legacyGameRoutes.map(([prefix]) => prefix)]) app.use(prefix, unavailable);
    return;
  }
  app.use('/api/world/spatial', load('../routes/worldSpatial'));
  const { worldWriteGuard } = load('../middleware/worldWriteGuard');
  for (const name of ['world', 'worldLock', 'worldGround']) app.use('/api/world', worldWriteGuard, load('../routes/' + name));
  for (const [prefix, name] of legacyGameRoutes) app.use(prefix, load('../routes/' + name));
}
function registerWorldIntegrations(app, load = require) {
  if (isRoomsMode()) {
    app.use('/api/federation', unavailable);
    app.use('/api/agent', unavailable);
    app.use('/.well-known/virtual-world-agent.json', unavailable);
    return;
  }
  app.use('/api/federation', load('../routes/federation').router);
  app.use('/api/federation', load('../routes/federationTrust'));
  app.use('/api/agent/v1', load('../routes/agent'));
  app.use('/api/agent/federation', load('../routes/agentFederation'));
  const { buildWellKnown } = load('../routes/agent/meta');
  app.get('/.well-known/virtual-world-agent.json', async (req, res) => {
    try {
      res.set('Cache-Control', 'public, max-age=60');
      res.json(await buildWellKnown(req));
    } catch (error) {
      console.error('[Agent] Discovery failed:', error);
      res.status(500).json({ success: false, error: 'Discovery failed', code: 'WELLKNOWN_FAILED' });
    }
  });
}
async function initializeWorldFederation(load = require) {
  if (isRoomsMode()) return;
  await load('../routes/federation').initFederation();
  console.log('[World] Federation initialized');
}
function startWorldBackgroundServices(load = require) {
  if (isRoomsMode()) {
    console.log('[Rooms] Federation, AI agent access and agent chat archival are disabled');
    return;
  }
  // A failed optional integration must not prevent the other one from starting.
  for (const [name, modulePath, method] of [
    ['Agent WebSocket', '../websocket/agentWsServer', 'start'],
    ['Agent chat archival', './chatArchiveService', 'startArchiveLoop']
  ]) {
    try { load(modulePath)[method](); }
    catch (error) { console.warn(`[World] ${name} failed to start:`, error.message); }
  }
}
module.exports = { isRoomsMode, registerLegacyGameRoutes, registerLegacyToolRoutes, registerWorldIntegrations, initializeWorldFederation, startWorldBackgroundServices };
