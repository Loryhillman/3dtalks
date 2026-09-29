/** Check embedded dictionaries without executing page code. */
const fs = require('node:fs');
const parser = require('@babel/parser');
const sources = [
  { file: 'public/js/subscription.js', html: false },
  { file: 'public/admin_login.html', html: true }
];
let errors = 0;
function literal(node) {
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(property => {
    if (property.type !== 'ObjectProperty' || property.computed) throw Error('Unsupported embedded dictionary expression');
    return [property.key.name || property.key.value, literal(property.value)];
  }));
  throw Error(`Unsupported dictionary value: ${node.type}`);
}
function walk(node, callback) {
  if (!node || typeof node !== 'object' || !node.type) return;
  callback(node);
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'comments', 'leadingComments', 'trailingComments'].includes(key)) continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, callback));
    else if (value && typeof value === 'object') walk(value, callback);
  }
}
for (const source of sources) {
  const text = fs.readFileSync(source.file, 'utf8');
  const scripts = source.html ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]) : [text];
  const asts = scripts.map(code => parser.parse(code, { sourceType: 'unambiguous' }));
  let catalog;
  const supplements = [], references = [];
  for (const ast of asts) walk(ast, node => {
    if (node.type === 'VariableDeclarator' && node.id.name === 'i18n' && node.init?.type === 'ObjectExpression') catalog = literal(node.init);
    if (node.type !== 'CallExpression') return;
    if (node.callee?.object?.name === 'Object' && node.callee.property.name === 'assign') {
      const target = node.arguments[0];
      if (target?.object?.name === 'i18n') supplements.push({ locale: target.property.name, values: literal(node.arguments[1]) });
    }
    if (['t', 'tf'].includes(node.callee?.name) && node.arguments[0]?.type === 'StringLiteral') references.push(node.arguments[0].value);
  });
  if (!catalog) throw Error(`No dictionary: ${source.file}`);
  for (const entry of supplements) Object.assign(catalog[entry.locale], entry.values);
  const base = catalog.en;
  const parameters = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
  for (const locale of ['zh', 'en', 'ru']) {
    const values = catalog[locale] || {};
    const missing = Object.keys(base).filter(key => !(key in values));
    const extra = Object.keys(values).filter(key => !(key in base));
    const mismatched = Object.keys(base).filter(key => key in values && parameters(values[key]) !== parameters(base[key]));
    const chinese = locale === 'ru' ? Object.keys(values).filter(key => /[\u3400-\u9fff]/.test(values[key])) : [];
    console.log(`${source.file} ${locale}: ${Object.keys(values).length}/${Object.keys(base).length}; missing=${missing.length}, extra=${extra.length}, parameters=${mismatched.length}, Chinese=${chinese.length}`);
    if (missing.length || extra.length || mismatched.length || chinese.length) { errors++; console.error([...missing, ...extra, ...mismatched, ...chinese].join(', ')); }
  }
  if (source.html) for (const match of text.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g)) references.push(match[1]);
  const missingReferences = [...new Set(references.filter(key => !(key in base)))];
  if (missingReferences.length) { errors++; console.error(`${source.file} missing references: ${missingReferences.join(', ')}`); }
}
process.exitCode = errors ? 1 : 0;
