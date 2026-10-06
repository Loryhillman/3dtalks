const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/i18n/i18n.js'), 'utf8'), context);
const i18n = context.window.i18n;
i18n.initialized = true;
for (const locale of ['ru-RU', 'en-US', 'zh-CN']) {
  i18n.currentLocale = locale;
  i18n.translations[locale] = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/i18n', locale + '.json'), 'utf8'));
  for (const [key, params] of Object.entries({ quota: { used: 2, limit: 5 }, occupancy: { active: 1, held: 2, available: 3 }, confirmEnd: { name: 'Test room' }, confirmDelete: { name: 'Test room' } })) {
    const text = i18n.tp('roomsLobby.' + key, params);
    assert.ok(!/[{}]/.test(text), `${locale}/${key}: unresolved placeholders`);
    for (const value of Object.values(params)) assert.ok(text.includes(String(value)), `${locale}/${key}: missing ${value}`);
  }
}
console.log('Lobby translations: real i18n interpolates counters and confirmations in all three languages');
