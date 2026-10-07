/** Browser-free checks for locale precedence and catalog fallback. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const base = path.join(__dirname, '..', 'public', 'i18n');
const saved = new Map();
let worldDefault = 'zh-CN';
const context = vm.createContext({
  window: {}, console: { log() {}, warn() {}, error() {} },
  localStorage: {
    getItem(key) { return saved.get(key) || null; },
    setItem(key, value) { saved.set(key, value); }
  },
  async fetch(url) {
    if (url === '/api/config/language') return { ok: true, async json() { return { language: worldDefault }; } };
    const match = /^\/i18n\/([a-zA-Z-]+)\.json$/.exec(url);
    if (!match) throw new Error(`Unexpected URL: ${url}`);
    return { ok: true, async json() { return JSON.parse(fs.readFileSync(path.join(base, `${match[1]}.json`), 'utf8')); } };
  }
});
vm.runInContext(fs.readFileSync(path.join(base, 'i18n.js'), 'utf8'), context);

(async () => {
  const i18n = context.window.i18n;
  await i18n.init();
  assert.equal(i18n.getCurrentLocale(), 'zh-CN');
  await i18n.setLocaleLocal('ru-RU');
  assert.equal(i18n.t('world.startGame'), 'Начать игру');
  delete i18n.translations['ru-RU'].admin.pgWorldSub;
  assert.equal(i18n.t('admin.pgWorldSub'), 'Manage game world, monsters, weather & NPCs');
  assert.equal(i18n.tp('world.maxChars', { count: 20 }), 'Не более 20 символов');
  assert.equal(i18n.tp('shopUi.purchased', { item: 'Меч' }), 'Куплено: Меч');
  assert.equal(i18n.tp('worldEditorCoordinates.confirmApply', { coordinates: 'X:1 Y:2 Z:3' }), '✅ Применить X:1 Y:2 Z:3');
  assert.equal(i18n.tp('characterEditorPage.loadingPercent', { percent: 42 }), 'Загрузка 42%');
  assert.equal(i18n.tp('admin.usersDeleteConfirm', { name: 'Иван' }), 'Удалить пользователя «Иван»? Это действие нельзя отменить.');
  assert.equal(i18n.tp('adminInlineUi.poolRemaining', { pool: 'Награды', count: 7 }), 'Награды: осталось кодов — 7');
  assert.equal(i18n.tp('adminInlineUi.currentFileLabel', { name: 'model.glb' }), 'Текущий файл: model.glb');
  assert.equal(i18n.t('unifiedEditorPage.promptVillage'), 'Построй красивую деревню');
  assert.equal(i18n.tp('motionPlayerUi.texturesFailed', { count: 3 }), 'Не удалось восстановить текстуры: 3');
  const adminSource = fs.readFileSync(path.join(__dirname, '../public/js/admin.js'), 'utf8');
  vm.runInContext(adminSource.slice(adminSource.indexOf('function adminT('), adminSource.indexOf('const API_BASE')), context);
  assert.equal(vm.runInContext("adminT('admin.usersDeleteConfirmGeneric', 'Delete user?')", context), 'Удалить этого пользователя? Это действие нельзя отменить.');
  assert.equal(vm.runInContext("adminT('missing.testKey', 'Failed: {{message}}', { message: 'network' })", context), 'Failed: network');
  const federationSource = fs.readFileSync(path.join(__dirname, '../public/js/federationRoleTemplates.js'), 'utf8');
  vm.runInContext(federationSource.slice(0, federationSource.indexOf('const roleTemplateCSS')), context);
  const templateHtml = vm.runInContext("Object.create(FederationRoleTemplatesUI.prototype).renderTemplateItem({ id: 'test', local_template_id: 'local', is_active: false, source_world_name: 'Мир' }, 'federated')", context);
  assert.ok(templateHtml.includes('Федеративный шаблон'));
  assert.ok(templateHtml.includes('из мира: Мир'));
  assert.ok(templateHtml.includes('Использовать этот шаблон'));
  assert.ok(!/[\u3400-\u9fff]/.test(templateHtml));
  assert.equal(i18n.tp('federationRoleUi.importSuccess', { id: '42' }), 'Шаблон импортирован. ID: 42');
  const puppeteerSource = fs.readFileSync(path.join(__dirname, '../public/animation_puppeteer.html'), 'utf8');
  const syncEl = { dataset: { syncKey: 'synced' }, textContent: '' };
  const syncContext = vm.createContext({
    document: { getElementById() { return syncEl; } },
    pt(key) { return i18n.t('puppeteerPage.' + key); }
  });
  vm.runInContext(puppeteerSource.slice(puppeteerSource.indexOf('function updateConfigSyncLabel('), puppeteerSource.indexOf('function applyPuppeteerTranslations(')), syncContext);
  vm.runInContext("updateConfigSyncLabel('defaultConfig')", syncContext);
  assert.equal(syncEl.textContent, i18n.t('puppeteerPage.defaultConfig'));
  await i18n.setLocaleLocal('en-US');
  vm.runInContext('updateConfigSyncLabel()', syncContext);
  assert.equal(syncEl.dataset.syncKey, 'defaultConfig');
  assert.equal(syncEl.textContent, 'Using defaults');
  await i18n.setLocaleLocal('ru-RU');
  const subscriptionSource = fs.readFileSync(path.join(__dirname, '../public/js/subscription.js'), 'utf8');
  const localParamsContext = vm.createContext({ t() { return '{name} / {name}'; } });
  vm.runInContext(subscriptionSource.slice(subscriptionSource.indexOf('function tf('), subscriptionSource.indexOf('// ==================== 语言切换')), localParamsContext);
  assert.equal(vm.runInContext("tf('test', { name: 'Иван' })", localParamsContext), 'Иван / Иван');
  const loginSource = fs.readFileSync(path.join(__dirname, '../public/admin_login.html'), 'utf8');
  const loginParamsContext = vm.createContext({ currentLang: 'ru', i18n: { ru: { test: '{name} / {name}' }, zh: {} } });
  vm.runInContext(loginSource.slice(loginSource.indexOf('function t(key, vars)'), loginSource.indexOf('function applyLanguage(')), loginParamsContext);
  assert.equal(vm.runInContext("t('test', { name: 'Иван' })", loginParamsContext), 'Иван / Иван');
  assert.equal(i18n.t('gaussianTestPage.reload'), 'Загрузить заново');
  const characterSource = fs.readFileSync(path.join(__dirname, '../public/character_editor.html'), 'utf8');
  const templateNameContext = vm.createContext({ ceT(key) { return i18n.t('characterEditorPage.' + key); } });
  vm.runInContext(characterSource.slice(characterSource.indexOf('function _editorTemplateName('), characterSource.indexOf('function updateAnimStatusGrid(')), templateNameContext);
  assert.equal(vm.runInContext("_editorTemplateName('默认方块人')", templateNameContext), i18n.t('characterEditorPage.blockCharacter'));
  assert.equal(vm.runInContext("_editorTemplateName('方块人')", templateNameContext), i18n.t('characterEditorPage.blockCharacter'));
  assert.equal(vm.runInContext("_editorTemplateName('Игрок')", templateNameContext), 'Игрок');
  const initialEl = { dataset: { i18nInitial: 'admin3dgs.selectedCount', i18nInitialText: '0 selected', i18nInitialParams: '{"count":0}' }, textContent: '0 selected' };
  context.document = { querySelectorAll() { return initialEl.dataset.i18nInitial ? [initialEl] : []; } };
  vm.runInContext('applyInitialAdminTranslations()', context);
  assert.equal(initialEl.textContent, i18n.tp('admin3dgs.selectedCount', { count: 0 }));
  await i18n.setLocaleLocal('en-US');
  vm.runInContext('applyInitialAdminTranslations()', context);
  assert.equal(initialEl.textContent, '0 selected');
  initialEl.textContent = '12 selected';
  await i18n.setLocaleLocal('ru-RU');
  vm.runInContext('applyInitialAdminTranslations()', context);
  assert.equal(initialEl.textContent, '12 selected');
  assert.equal(initialEl.dataset.i18nInitial, undefined);
  const utilsSource = fs.readFileSync(path.join(__dirname, '../public/js/utils.js'), 'utf8');
  const legacyContext = vm.createContext({
    legacyEditorT(key) { return i18n.t('characterEditorPage.' + key); }
  });
  vm.runInContext(utilsSource.slice(utilsSource.indexOf('function legacyPresetName('), utilsSource.indexOf('function loadPreset(')), legacyContext);
  assert.equal(vm.runInContext("legacyPresetName('bow')", legacyContext), 'Поклон');
  assert.equal(vm.runInContext("legacyPresetName('custom')", legacyContext), 'custom');
  const weaponSource = fs.readFileSync(path.join(__dirname, '../public/js/weapon.js'), 'utf8');
  vm.runInContext(weaponSource.slice(weaponSource.indexOf('function getEffectName('), weaponSource.indexOf('function onAttack(')), legacyContext);
  assert.equal(vm.runInContext("getEffectName('damage')", legacyContext), 'Повышение урона');
  assert.equal(vm.runInContext("getEffectName('custom')", legacyContext), 'custom');
  await i18n.setLocaleLocal('en-US');
  assert.equal(vm.runInContext("legacyPresetName('bow')", legacyContext), 'Bowing pose');
  assert.equal(vm.runInContext("getEffectName('damage')", legacyContext), 'Damage boost');
  await i18n.setLocaleLocal('ru-RU');
  assert.equal(i18n.tp('characterEditorPage.characterLoadedAnimations', { count: 4 }), '✅ Модель персонажа загружена; встроенных анимаций GLB: 4');
  assert.equal(i18n.tp('characterEditorPage.animationNotReady', { name: 'Бег', hint: i18n.t('characterEditorPage.animationLoading') }), '⚠️ Анимация «Бег» не готова: Загрузка…');
  const templateSource = fs.readFileSync(path.join(__dirname, '../public/js/template.js'), 'utf8');
  const templateAst = require('@babel/parser').parse(templateSource, { sourceType: 'script' });
  const playButton = { dataset: {}, textContent: '' };
  const loopButton = {};
  const previewInfo = { style: {}, textContent: '' };
  const templateContext = vm.createContext({
    legacyEditorT(key) { return i18n.t('characterEditorPage.' + key); },
    legacyEditorTp(key, params) { return i18n.tp('characterEditorPage.' + key, params); },
    previewState: { isPlaying: true, isLooping: false },
    cfg: { templateId: 'test', templateName: '<custom>', glbUrl: '/model.glb', templateSounds: {} },
    tmplAnimUrls: { idle: '/idle.glb' },
    document: {
      querySelector(selector) { return selector.includes('playPreview') ? playButton : loopButton; },
      getElementById() { return previewInfo; }
    }
  });
  for (const name of ['legacyTemplateName', 'updatePreviewControls', 'getAnimDisplayName', 'updatePreviewInfo', 'getTemplateSoundCount']) {
    const fn = templateAst.program.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
    assert.ok(fn, name);
    vm.runInContext(templateSource.slice(fn.start, fn.end), templateContext);
  }
  vm.runInContext('updatePreviewControls(); updatePreviewInfo()', templateContext);
  assert.equal(playButton.textContent, 'Приостановить предпросмотр');
  assert.equal(playButton.dataset.i18n, 'characterEditorPage.pausePreview');
  assert.ok(previewInfo.textContent.includes('<custom>'));
  assert.ok(previewInfo.textContent.includes('Движений: 1'));
  assert.equal(vm.runInContext("getAnimDisplayName('draw_sword')", templateContext), 'Достать меч');
  assert.equal(vm.runInContext("getAnimDisplayName('custom')", templateContext), 'custom');
  assert.equal(vm.runInContext("legacyTemplateName('默认方块人')", templateContext), i18n.t('characterEditorPage.blockCharacter'));
  await i18n.setLocaleLocal('en-US');
  vm.runInContext('updatePreviewControls()', templateContext);
  assert.equal(playButton.textContent, 'Pause preview');
  templateContext.previewState.isPlaying = false;
  vm.runInContext('updatePreviewControls()', templateContext);
  assert.equal(playButton.textContent, 'Play preview');
  await i18n.setLocaleLocal('ru-RU');
  const previewElements = {
    'ai-preview-area': { innerHTML: '' },
    'ai-preview-input': { placeholder: '' },
    'ai-preview-status': { style: {}, textContent: '' },
    'ai-preview-confirm-btn': { style: {} },
    'model-first-preview-stats': { textContent: '' }
  };
  const chatArea = { innerHTML: '' };
  previewElements['ai-preview-panel'] = { dataset: {}, querySelector() { return chatArea; } };
  const aiPreviewContext = vm.createContext({
    window: { i18n }, document: { getElementById(id) { return previewElements[id] || null; } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/modules/ai-preview.js'), 'utf8'), aiPreviewContext);
  vm.runInContext("previewMode = 'model-first'; _switchPanelToChat(null, [{ id: 1 }], { scene_type: 'city' })", aiPreviewContext);
  assert.ok(chatArea.innerHTML.includes('Отправить изменения (Ctrl+Enter)'));
  assert.ok(!/[\u3400-\u9fff]/.test(chatArea.innerHTML + previewElements['ai-preview-area'].innerHTML));
  assert.ok(previewElements['ai-preview-input'].placeholder.includes('\n'));
  assert.equal(previewElements['model-first-preview-stats'].textContent, 'Тип сцены: city | Объектов: 1');
  assert.equal(i18n.apiMessage({ error: '模型不存在', errorKey: 'uploadedModelsApi.notFound' }), 'Модель не найдена');
  assert.equal(i18n.apiMessage({ message: '成功上传', messageKey: 'uploadedModelsApi.batchResult', messageParams: { success: 3, failed: 1 } }), 'Загружено: 3, с ошибкой: 1');
  assert.equal(i18n.apiMessage({ error: 'Custom error', errorKey: 'missing.apiKey' }), 'Custom error');
  assert.equal(i18n.apiMessage({ error: 'Legacy error' }), 'Legacy error');
  assert.equal(i18n.apiMessage(null, 'Fallback'), 'Fallback');
  await i18n.setLocaleLocal('en-US');
  assert.equal(i18n.apiMessage({ error: '模型不存在', errorKey: 'uploadedModelsApi.notFound' }), 'Model not found');
  await i18n.setLocaleLocal('ru-RU');
  const apiSource = fs.readFileSync(path.join(__dirname, '../src/routes/uploadedModels.js'), 'utf8');
  const apiAst = require('@babel/parser').parse(apiSource, { sourceType: 'unambiguous' });
  let checkedApiMessages = 0;
  function checkApiMetadata(node) {
    if (!node || !node.type) return;
    if (node.type === 'ObjectExpression') {
      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || !['error', 'message'].includes(property.key.name) || property.value.type !== 'StringLiteral' || !/[\u3400-\u9fff]/.test(property.value.value)) continue;
        const metadata = node.properties.find(p => p.type === 'ObjectProperty' && p.key.name === property.key.name + 'Key');
        assert.ok(metadata, property.value.value);
        assert.notEqual(i18n.t(metadata.value.value), metadata.value.value);
        checkedApiMessages++;
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(checkApiMetadata);
      else if (value && typeof value === 'object') checkApiMetadata(value);
    }
  }
  checkApiMetadata(apiAst);
  assert.equal(checkedApiMessages, 28);
  const authSource = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  const questionContext = vm.createContext({});
  vm.runInContext(authSource.slice(authSource.indexOf('const securityQuestionKeys'), authSource.indexOf('const JWT_SECRET')), questionContext);
  assert.equal(vm.runInContext("withQuestionTranslation({ id: 5, question_text: '你的出生日期' }).questionKey", questionContext), 'authApi.questionBirthDate');
  assert.equal(vm.runInContext("withQuestionTranslation({ id: 5, question_text: 'Мой вопрос' }).question_text", questionContext), 'Мой вопрос');
  assert.equal(vm.runInContext("withQuestionTranslation({ id: 5, question_text: 'Мой вопрос' }).questionKey", questionContext), undefined);
  assert.equal(i18n.apiMessage({ message: '你的出生日期', messageKey: 'authApi.questionBirthDate' }), 'Ваша дата рождения');
  let promptCount = 0;
  const responseQueue = [];
  const apiClientContext = vm.createContext({
    window: { i18n, location: { origin: 'http://localhost' }, AuthPrompt: { async prompt() { promptCount++; } } },
    CONFIG: { API_BASE: '/api' }, AbortController,
    localStorage: { getItem() { return null; }, setItem() {} },
    setTimeout() { return 0; }, clearTimeout() {},
    console: { error() {} },
    async fetch() {
      const next = responseQueue.shift();
      assert.ok(next, 'Unexpected request');
      if (next.throw) throw next.throw;
      return { ok: next.status === 200, status: next.status, headers: { get() { return null; } }, async json() { return next.body; } };
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/api.js'), 'utf8'), apiClientContext);
  const apiClient = apiClientContext.window.API;
  responseQueue.push({ status: 401, body: { error: 'Invalid credentials', errorKey: 'authApi.invalidCredentials' } });
  await assert.rejects(apiClient.login('user', 'wrong'), error => error.message === 'Неверное имя пользователя или пароль' && error.originalMessage === 'Invalid credentials' && error.status === 401);
  assert.equal(promptCount, 0);
  responseQueue.push({ status: 401, body: { error: 'Invalid token', errorKey: 'authApi.invalidToken' } }, { status: 200, body: { success: true } });
  assert.equal((await apiClient.get('/auth/me')).success, true);
  assert.equal(promptCount, 1);
  responseQueue.push({ status: 401, body: { error: 'Invalid token', errorKey: 'authApi.invalidToken' } }, { status: 401, body: { error: 'Invalid token', errorKey: 'authApi.invalidToken' } });
  await assert.rejects(apiClient.get('/auth/me'), error => error.message === i18n.t('authApi.invalidToken'));
  assert.equal(promptCount, 2); // Exactly one prompt for this request; no retry loop.
  responseQueue.push({ status: 429, body: { error: 'Custom limit', code: 'LIMIT', retryAfter: 9 } });
  await assert.rejects(apiClient.get('/test'), error => error.message === 'Custom limit' && error.code === 'LIMIT' && error.retryAfter === 9);
  responseQueue.push({ throw: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
  await assert.rejects(apiClient.get('/test'), error => error.message === i18n.t('authApi.timeout'));
  const authAst = require('@babel/parser').parse(authSource, { sourceType: 'script' });
  let authMessages = 0;
  function checkAuthMetadata(node) {
    if (!node || !node.type) return;
    if (node.type === 'ObjectExpression') {
      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || !['error', 'message'].includes(property.key.name) || property.value.type !== 'StringLiteral') continue;
        const metadata = node.properties.find(p => p.type === 'ObjectProperty' && p.key.name === property.key.name + 'Key');
        assert.ok(metadata, property.value.value);
        assert.notEqual(i18n.t(metadata.value.value), metadata.value.value);
        authMessages++;
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(checkAuthMetadata);
      else if (value && typeof value === 'object') checkAuthMetadata(value);
    }
  }
  checkAuthMetadata(authAst);
  assert.equal(authMessages, 27);
  const hudSource = fs.readFileSync(path.join(__dirname, '../public/js/skillHUD.js'), 'utf8');
  const microphoneLabel = { textContent: 'Voice' };
  let finishHudLocale;
  let hudLocaleLoaded = false;
  const hudInitPromise = new Promise(resolve => { finishHudLocale = resolve; });
  const hudContext = vm.createContext({
    window: { i18n: {
      init() { return hudInitPromise; }, onLocaleChange() {},
      t(key) { return hudLocaleLoaded ? i18n.t(key) : 'Voice'; }
    } }
  });
  vm.runInContext(hudSource.slice(0, hudSource.indexOf('window.skillHUD = new SkillHUD()')) + '\nwindow.HudClass = SkillHUD;', hudContext);
  const hud = Object.create(hudContext.window.HudClass.prototype);
  hud._injectStyles = () => {};
  hud._createContainer = () => {};
  hud._createVoiceButton = () => {};
  hud.renderSlots = () => {};
  hud.voiceBtn = { querySelector() { return microphoneLabel; } };
  hud.init();
  assert.equal(microphoneLabel.textContent, 'Voice');
  hudLocaleLoaded = true;
  finishHudLocale();
  await hudInitPromise;
  assert.equal(microphoneLabel.textContent, 'Микрофон');
  await i18n.setLocaleLocal('en-US');
  hud.refreshTranslations();
  assert.equal(microphoneLabel.textContent, 'Voice');
  await i18n.setLocaleLocal('ru-RU');
  hud.refreshTranslations();
  assert.equal(microphoneLabel.textContent, 'Микрофон');
  worldDefault = 'en-US';
  i18n.initialized = false;
  i18n._initPromise = null;
  await i18n.init();
  assert.equal(i18n.getCurrentLocale(), 'ru-RU');
  assert.equal(saved.get('preferredLocale'), 'ru-RU');
  process.stdout.write('Locale precedence and fallback OK\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
