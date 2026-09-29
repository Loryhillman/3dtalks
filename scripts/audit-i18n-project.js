/** Read-only inventory of catalog references and Han UI candidates; never starts the app. */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const outIndex = args.indexOf('--output');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public/i18n/en-US.json'), 'utf8'));
const keys = new Set();
function flatten(value, prefix = '') {
  for (const [key, entry] of Object.entries(value)) {
    const name = prefix + key;
    if (typeof entry === 'string') keys.add(name);
    else flatten(entry, name + '.');
  }
}
flatten(catalog);
function files(dir, extension) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const name = path.join(dir, entry.name);
    return entry.isDirectory() ? (entry.name === 'lib' ? [] : files(name, extension)) : name.endsWith(extension) ? [name] : [];
  });
}
const htmlFiles = files(path.join(root, 'public'), '.html');
const referenced = new Set();
const prefixes = Object.assign(Object.create(null), {
  pt: 'puppeteerPage.', pp: 'puppeteerPage.',
  frtT: 'federationRoleUi.', frtTp: 'federationRoleUi.',
  factoryPlayerT: 'motionPlayerUi.', factoryPlayerTp: 'motionPlayerUi.',
  legacyEditorT: 'characterEditorPage.', legacyEditorTp: 'characterEditorPage.',
  ceT: 'characterEditorPage.', ceTp: 'characterEditorPage.',
  ueT: 'unifiedEditorPage.', ueTp: 'unifiedEditorPage.',
  weT: 'worldEditor.', weTp: 'worldEditor.',
  sceneT: 'aiScenePage.', sceneTp: 'aiScenePage.',
  voiceT: 'voiceChat.', voiceTp: 'voiceChat.', wsT: 'websocketUi.', wsTp: 'websocketUi.',
  umdT: 'uploadMetaDialog.', umdTp: 'uploadMetaDialog.',
  codeT: 'worldEditorCodeBlocks.', codeTp: 'worldEditorCodeBlocks.',
  lazyT: 'lazyModelLoader.', lazyTp: 'lazyModelLoader.', rpT: 'worldEditorCoordinates.', rpTp: 'worldEditorCoordinates.',
  adminInlineT: 'adminInlineUi.', adminInlineTp: 'adminInlineUi.',
  ucT: 'adminUIControls.', ucTp: 'adminUIControls.',
  portalText: 'portalUi.', worldText: 'worldUi.',
  _puiT: 'adminCharacters.', _puiTp: 'adminCharacters.',
});
const fullCalls = new Set(['t', 'tp', '_t', 'adminT', 'glT', 'glTp', 'mtT', 'mtTp', '_alT', '_alTp', '_mplT', '_mplTp', '_tcfg', '_tcfgp', 'tt']);
const displayCalls = new Set(['alert', 'confirm', 'prompt', 'showNotification', 'showToast', 'showNotif', 'addChatMessage', 'fillText', 'createTextNode']);
const displayProperties = new Set(['textContent', 'innerText', 'innerHTML', 'placeholder', 'title', 'ariaLabel']);
const report = { missingReferences: [], parameterIssues: [], candidates: [], parseWarnings: [], dynamicReferences: 0, limitations: ['Candidate detection is heuristic; template comments and translation fallbacks are filtered.', 'Only known translation helpers and literal keys are checked; computed keys require review.', 'No direct HTML reference does not prove a script is unused; imports and dynamic loading may exist.'] };
const nameOf = n => n?.type === 'Identifier' ? n.name : n?.property?.name;
const han = /[\u3400-\u9fff]/;
const relative = file => path.relative(root, file).replaceAll('\\', '/');
function reference(file, line, key, kind) {
  if (relative(file) === 'public/admin_login.html' && !key.includes('.')) return; // This page owns an embedded zh/en/ru catalog.
  if (!keys.has(key)) report.missingReferences.push({ file: relative(file), line, key, kind });
}
function scanJs(file, source, offset = 0, origin = 'external-js') {
  let ast;
  try { ast = parser.parse(source, { sourceType: 'unambiguous', errorRecovery: true, allowReturnOutsideFunction: true }); }
  catch (error) { report.parseWarnings.push({ file: relative(file), line: offset + (error.loc?.line || 1), message: error.message }); return; }
  function walk(node, ancestors = []) {
    if (!node || typeof node !== 'object' || !node.type) return;
    const line = offset + (node.loc?.start.line || 1);
    const call = node.type === 'CallExpression' || node.type === 'OptionalCallExpression';
    const name = call ? nameOf(node.callee) : '';
    if (node.type === 'ObjectProperty' && ['errorKey', 'messageKey', 'questionKey'].includes(nameOf(node.key)) && node.value?.type === 'StringLiteral') {
      reference(file, line, node.value.value, 'api-metadata');
    }
    if (call && (fullCalls.has(name) || prefixes[name])) {
      const arg = node.arguments[0];
      if (arg?.type === 'StringLiteral') {
        const prefix = name === '_t' && node.callee?.object?.type === 'ThisExpression' && relative(file) === 'public/js/federationUI.js' ? 'world.' : (prefixes[name] || '');
        const key = prefix + arg.value;
        // Generic t() also appears in unrelated modules; require a dotted catalog key.
        if (prefixes[name] || key.includes('.')) reference(file, line, key, 'js');
        if ((name === 'tp' || name === 'pp' || name === 'adminT' || /Tp$/.test(name)) && keys.has(key)) {
          const text = key.split('.').reduce((value, part) => value?.[part], catalog);
          if (/(?<!\{)\{\w+\}(?!\})/.test(text)) report.parameterIssues.push({ file: relative(file), line, key, issue: 'Single braces cannot be substituted by i18n.tp' });
          const params = node.arguments[name === 'adminT' ? 2 : 1];
          if (params?.type === 'ObjectExpression' && params.properties.every(p => p.type === 'ObjectProperty' && !p.computed)) {
            const provided = new Set(params.properties.map(p => p.key.name || p.key.value));
            const expected = [...text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
            for (const missing of new Set(expected.filter(p => !provided.has(p)))) report.parameterIssues.push({ file: relative(file), line, key, issue: `Missing parameter: ${missing}` });
          }
        }
      } else report.dynamicReferences++;
    }
    if (node.type === 'StringLiteral' || node.type === 'TemplateElement') {
      const raw = node.type === 'StringLiteral' ? node.value : node.value.raw;
      const text = raw.replace(/<!--[\s\S]*?-->/g, '');
      const translated = ancestors.some(a => (a.type === 'CallExpression' || a.type === 'OptionalCallExpression') && (fullCalls.has(nameOf(a.callee)) || prefixes[nameOf(a.callee)]));
      const consoleCall = ancestors.some(a => a.type === 'CallExpression' && a.callee?.object?.name === 'console');
      const labelMap = ancestors.some(a => (a.type === 'VariableDeclarator' && /(?:Labels|Names)$/.test(a.id?.name || '')) || (a.type === 'AssignmentExpression' && /(?:Labels|Names)$/.test(nameOf(a.left) || '')));
      const shown = labelMap || ancestors.some(a => (a.type === 'AssignmentExpression' && displayProperties.has(nameOf(a.left))) || (a.type === 'CallExpression' && displayCalls.has(nameOf(a.callee))));
      if (han.test(text) && shown && !translated && !consoleCall && !/data-i18n(?:-[\w-]+)?=/.test(text)) {
        report.candidates.push({ file: relative(file), line, origin, connection: origin === 'inline-js' || referenced.has(relative(file)) ? 'html-referenced' : 'no-direct-html-reference', text: text.trim().slice(0, 240) });
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(child => walk(child, [...ancestors, node]));
      else if (value && typeof value === 'object') walk(value, [...ancestors, node]);
    }
  }
  walk(ast);
}
const pages = htmlFiles.map(file => ({ file, source: fs.readFileSync(file, 'utf8') }));
for (const { source } of pages) {
  for (const match of source.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const url = match[1].split('?')[0];
    if (!/^https?:/.test(url)) referenced.add('public/' + url.replace(/^\//, ''));
  }
}
for (const { file, source } of pages) {
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=|type\s*=\s*["'](?:importmap|application\/json|application\/ld\+json)/i.test(match[1])) continue;
    const start = match.index + match[0].indexOf('>') + 1;
    scanJs(file, match[2], source.slice(0, start).split('\n').length - 1, 'inline-js');
  }
  const markup = source.replace(/<!--[^]*?-->|<(script|style)\b[^>]*>[^]*?<\/\1\s*>/gi, m => m.replace(/[^\n]/g, ' '));
  for (const match of markup.matchAll(/<[^>]+>/g)) {
    for (const attr of match[0].matchAll(/\bdata-i18n(?:-(?:placeholder|title|loading|initial))?\s*=\s*["']([^"']+)["']/g)) {
      reference(file, markup.slice(0, match.index).split('\n').length, attr[1], 'html');
    }
  }
  // Immediate parent only: nested translated containers may produce false positives.
  for (const match of markup.matchAll(/<([\w-]+)\b([^>]*)>([^<]*[\u3400-\u9fff][^<]*)/g)) {
    if (/data-i18n(?:-[\w-]+)?=/.test(match[2]) || /<option\b/i.test(match[0])) continue;
    report.candidates.push({ file: relative(file), line: markup.slice(0, match.index).split('\n').length, origin: 'html', connection: 'page', text: match[3].trim().slice(0, 240) });
  }
}
for (const file of files(path.join(root, 'public/js'), '.js')) scanJs(file, fs.readFileSync(file, 'utf8'));
const modelApiFile = path.join(root, 'src/routes/uploadedModels.js');
scanJs(modelApiFile, fs.readFileSync(modelApiFile, 'utf8'), 0, 'server-js');
const authApiFile = path.join(root, 'src/routes/auth.js');
scanJs(authApiFile, fs.readFileSync(authApiFile, 'utf8'), 0, 'server-js');
for (const field of ['missingReferences', 'candidates']) report[field] = [...new Map(report[field].map(row => [JSON.stringify(row), row])).values()].sort((a,b) => a.file.localeCompare(b.file) || a.line-b.line);
report.summary = { missingReferences: report.missingReferences.length, parameterIssues: report.parameterIssues.length, candidates: report.candidates.length, directlyReferencedCandidates: report.candidates.filter(r => r.connection !== 'no-direct-html-reference').length, parseWarnings: report.parseWarnings.length, dynamicReferences: report.dynamicReferences };
if (outIndex >= 0) fs.writeFileSync(args[outIndex + 1], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.summary));
for (const row of report.missingReferences.slice(0, 50)) console.log(`${row.file}:${row.line} missing ${row.key}`);
for (const row of report.parameterIssues.slice(0, 30)) console.log(`${row.file}:${row.line} ${row.key}: ${row.issue}`);
if (args.includes('--strict') && (report.missingReferences.length || report.parameterIssues.length)) process.exitCode = 1;
