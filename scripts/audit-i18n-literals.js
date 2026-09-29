/** Count Han characters in JavaScript string literals without printing source text. */
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
process.stdout.on('error', error => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const roots = ['public/js', 'src'];
const han = /[\u3400-\u9fff]/;
const uiMode = process.argv.includes('--ui-candidates');
const fileFilterIndex = process.argv.indexOf('--file');
const fileFilter = fileFilterIndex >= 0 ? process.argv[fileFilterIndex + 1] : null;
const results = [];
const skipped = [];
const uiCandidates = [];

function memberName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    return node.computed ? node.property?.value : node.property?.name;
  }
  return null;
}

function isUiCandidate(ancestors) {
  const displayProperties = new Set(['textContent', 'innerText', 'innerHTML', 'placeholder', 'title', 'ariaLabel', 'value']);
  const displayCalls = new Set(['showNotification', 'addChatMessage', 'alert', 'confirm', 'prompt', 'createTextNode', 'fillText', 'strokeText']);
  if (ancestors.some(node => node.type === 'CallExpression' &&
    node.callee?.object?.name === 'console')) return false;
  const translatedCalls = new Set([
    't', 'tp', '_t', 'adminT', 'glT', 'glTp', 'ucT', 'ucTp', 'mtT', 'mtTp',
    'portalText', 'worldText', 'weT', 'weTp', 'ueT', 'ueTp',
    'frtT', 'frtTp',
    'factoryPlayerT', 'factoryPlayerTp',
    'voiceT', 'voiceTp', 'wsT', 'wsTp', 'umdT', 'umdTp',
    'codeT', 'codeTp', 'lazyT', 'lazyTp', 'adminInlineT', 'adminInlineTp',
    '_mplT', '_mplTp', '_alT', '_alTp', '_puiT', '_puiTp', 'tt', 'rpT', 'rpTp'
  ]);
  if (ancestors.some(node => node.type === 'CallExpression' && translatedCalls.has(memberName(node.callee)))) return false;
  return ancestors.some(node =>
    (node.type === 'AssignmentExpression' && displayProperties.has(memberName(node.left))) ||
    (node.type === 'CallExpression' && displayCalls.has(memberName(node.callee))) ||
    (node.type === 'JSXAttribute' && displayProperties.has(memberName(node.name)))
  );
}

function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isDirectory()) visit(name);
    else if (name.endsWith('.js')) inspect(name);
  }
}

function inspect(file) {
  if (fileFilter && !file.includes(fileFilter)) return;
  let ast;
  const source = fs.readFileSync(file, 'utf8');
  try {
    ast = parser.parse(source, { sourceType: 'unambiguous', errorRecovery: true });
  } catch (error) {
    skipped.push(file);
    return;
  }
  let strings = 0;
  const lines = source.split(/\r?\n/);
  const walk = (node, ancestors = []) => {
    if (!node || typeof node !== 'object') return;
    const hasHan = (node.type === 'StringLiteral' && han.test(node.value)) ||
      (node.type === 'TemplateElement' && han.test(node.value.raw));
    if (hasHan) {
      strings++;
      if (uiMode && isUiCandidate(ancestors)) {
        const line = node.loc?.start?.line;
        const text = lines[line - 1]?.trim() || '';
        if (!/data-i18n(?:-[\w-]+)?=|window\.i18n\s*\?/.test(text)) {
          uiCandidates.push({ file, line, text: text.slice(0, 170) });
        }
      }
    }
    const nextAncestors = [...ancestors, node];
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) value.forEach(child => walk(child, nextAncestors));
      else if (value && typeof value === 'object') walk(value, nextAncestors);
    }
  };
  walk(ast);
  if (strings) results.push({ file, strings });
}

roots.forEach(visit);
if (uiMode) {
  const unique = [...new Map(uiCandidates.map(row => [`${row.file}:${row.line}`, row])).values()];
  unique.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  process.stdout.write(`Likely UI literals: ${unique.length} lines in ${new Set(unique.map(row => row.file)).size} files\n`);
  if (skipped.length) process.stdout.write(`Unparseable files skipped: ${skipped.join(', ')}\n`);
  for (const row of unique.slice(0, 100)) process.stdout.write(`${row.file}:${row.line} ${row.text}\n`);
  process.stdout.write('Heuristic list: review each line before replacing it.\n');
  process.exit(0);
}
results.sort((a, b) => b.strings - a.strings);
process.stdout.write(`Chinese string/template literals: ${results.reduce((sum, x) => sum + x.strings, 0)} in ${results.length} files\n`);
if (skipped.length) process.stdout.write(`Unparseable files skipped: ${skipped.join(', ')}\n`);
for (const row of results.slice(0, 20)) process.stdout.write(`${row.strings} ${row.file}\n`);
process.stdout.write('Counts include internal strings. Review each occurrence before changing it.\n');
