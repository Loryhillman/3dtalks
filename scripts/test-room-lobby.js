const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const nodes = new Map();
function node() { return { hidden: false, isConnected: true, children: [], dataset: {}, style: {},
  append(...items) { this.children.push(...items); }, replaceChildren() { this.children = []; },
  addEventListener(event, fn) { this['on' + event] = fn; }, querySelectorAll() { return []; },
  focus() {}, select() {}, setSelectionRange() {}, remove() { this.isConnected = false; },
  reset() {}, elements: {} }; }
const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
for (const key of ['password','securityAnswer','securityQuestionId']) $('auth-form').elements[key] = { value: '', append() {} };
$('create').elements = { name: { value: 'New room' }, capacity: { value: '1' } };
$('join').elements = { link: { value: 'https://evil.example/join/one' } };
const data = new Map([['token','test-token'], ['userId','user'], ['characterId','character']]);
const storage = map => ({ getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) });
const requests = [], navigation = [], session = new Map();
let failCreate = true, copyAllowed = true, copiedText;
const body = node();
const context = { console, URL, Uint8Array, crypto: webcrypto, localStorage: storage(data), sessionStorage: storage(session),
 document: { documentElement: {}, body, getElementById: $, createElement: node, querySelectorAll: () => [],
   execCommand(command) { assert.equal(command, 'copy'); copiedText = body.children.at(-1).value; return copyAllowed; } },
 location: { pathname: '/rooms', origin: 'http://local', assign: url => navigation.push(url), reload() {} },
 navigator: {}, prompt: () => null, confirm: () => false,
 window: { addEventListener() {}, i18n: { init: async () => {}, currentLocale: 'ru-RU', tp: key => key, t: key => key } },
 fetch: async (url, options = {}) => {
   requests.push({ url, options });
   if (url === '/api/my/rooms' && options.method === 'POST' && failCreate) { failCreate = false; throw new Error('Network lost'); }
   return { ok: true, headers: { get: () => null }, json: async () => url === '/api/auth/me' ? { user: { id: 'user' }, characterId: 'character' } : url.includes('security-questions') ? { questions: [] } :
     { quota: { used: 1, limit: 5 }, rooms: [{ id: 'room', slug: 'room-one', name: '<img onerror=bad>', status: 'open', capacity: 1, revision: 2 }] } };
 } };
const settle = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/js/roomsLobby.js'), 'utf8'), context);
  await settle();
  assert.equal($('cabinet').hidden, false);
  assert.equal($('rooms').children[0].children[0].textContent, '<img onerror=bad>', 'names are text, not HTML');
  const copyButton = $('rooms').children[0].children.at(-1).children.find(child => child.textContent === 'roomsLobby.copy');
  copyButton.onclick(); await settle();
  assert.equal(copiedText, 'http://local/join/room-one', 'HTTP fallback copies the actual invitation');
  assert.equal($('message').textContent, 'roomsLobby.copied');
  assert.equal(body.children.at(-1).isConnected, false, 'temporary field is removed');
  context.navigator.clipboard = { async writeText() { throw new Error('Permission denied'); } };
  copyButton.onclick(); await settle();
  assert.equal($('message').textContent, 'roomsLobby.copied', 'clipboard rejection falls back to browser copy');
  copyAllowed = false;
  copyButton.onclick(); await settle();
  assert.equal($('message').textContent, 'roomsLobby.copyFailed', 'failed copying is reported without displaying the URL');
  let modernCopy;
  context.navigator.clipboard.writeText = async text => { modernCopy = text; };
  copyButton.onclick(); await settle();
  assert.equal(modernCopy, 'http://local/join/room-one');
  assert.equal($('message').textContent, 'roomsLobby.copied');
  $('create').onsubmit({ preventDefault() {}, target: $('create') }); await settle();
  assert.equal(session.size, 1, 'uncertain request keeps idempotency key');
  $('create').onsubmit({ preventDefault() {}, target: $('create') }); await settle();
  const posts = requests.filter(r => r.options.method === 'POST');
  assert.equal(posts.length, 2);
  assert.equal(JSON.parse(posts[0].options.body).request_key, JSON.parse(posts[1].options.body).request_key);
  assert.equal(session.size, 0);
  $('join').onsubmit({ preventDefault() {}, target: $('join') }); await settle();
  assert.equal(navigation.length, 0);
  $('join').elements.link.value = 'http://local/join/room-one';
  $('join').onsubmit({ preventDefault() {}, target: $('join') }); await settle();
  assert.deepEqual(navigation, ['/join/room-one']);
  $('logout').onclick(); assert.equal(data.has('token'), false); assert.equal($('auth').hidden, false);
  console.log('Room lobby: list, safe text, retry key, invitation origin and logout OK (DOM simulation)');
})().catch(error => { console.error(error); process.exitCode = 1; });
