/** Static catalog audit. Does not start the application. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public', 'i18n');
const languages = ['zh-CN', 'en-US', 'ru-RU'];
const catalogs = Object.fromEntries(languages.map(locale => [
  locale, JSON.parse(fs.readFileSync(path.join(root, `${locale}.json`), 'utf8'))
]));

function flatten(value, prefix = '', result = {}) {
  for (const [key, entry] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === 'string') result[name] = entry;
    else if (entry && typeof entry === 'object' && !Array.isArray(entry)) flatten(entry, name, result);
    else throw new Error(`Invalid translation value: ${name}`);
  }
  return result;
}

const flat = Object.fromEntries(languages.map(locale => [locale, flatten(catalogs[locale])]));
const sourceKeys = Object.keys(flat['en-US']);
const han = /[\u3400-\u9fff]/;
const strict = process.argv.includes('--strict');
let errors = 0;
for (const locale of languages) {
  const missing = sourceKeys.filter(key => !(key in flat[locale]));
  const extra = Object.keys(flat[locale]).filter(key => !(key in flat['en-US']));
  const mismatched = sourceKeys.filter(key => key in flat[locale] &&
    JSON.stringify((flat[locale][key].match(/\{\{\w+\}\}/g) || []).sort()) !==
    JSON.stringify((flat['en-US'][key].match(/\{\{\w+\}\}/g) || []).sort()));
  const chinese = Object.keys(flat[locale]).filter(key => han.test(flat[locale][key]));
  const copiedEnglish = locale === 'ru-RU' ? Object.keys(flat[locale]).filter(key => flat[locale][key] === flat['en-US'][key]) : [];
  process.stdout.write(`${locale}: ${Object.keys(flat[locale]).length}/${sourceKeys.length} keys, ${missing.length} missing, ${extra.length} extra, ${mismatched.length} placeholder mismatches, ${chinese.length} with Chinese characters${locale === 'ru-RU' ? `, ${copiedEnglish.length} identical to English` : ''}\n`);
  if (locale === 'ru-RU' && (chinese.length || copiedEnglish.length)) {
    process.stderr.write(`ru-RU review: ${chinese.length ? `Chinese: ${chinese.slice(0, 10).join(', ')}; ` : ''}${copiedEnglish.length ? `English copies: ${copiedEnglish.slice(0, 10).join(', ')}` : ''}\n`);
  }
  if (extra.length || mismatched.length || (locale !== 'ru-RU' && missing.length)) {
    process.stderr.write(`${locale} sample issues: ${[...missing, ...extra, ...mismatched].slice(0, 12).join(', ')}\n`);
    errors++;
  }
  if (locale === 'ru-RU' && chinese.length) errors++;
  if (locale === 'ru-RU' && strict && missing.length) errors++;
}

// Russian remains a partial catalog; missing keys deliberately fall back to English.
process.exitCode = errors ? 1 : 0;
