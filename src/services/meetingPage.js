const fs = require('node:fs/promises');
const path = require('node:path');
const source = path.resolve(__dirname, '../../public/index.html');

// The shared, trusted HTML marks legacy-only scripts explicitly. Filtering on
// the server preserves parser execution order and the window load lifecycle.
function renderMeetingPage(html) {
  return html.replace(/<script\b[^>]*\bdata-world-only\b[^>]*>[\s\S]*?<\/script\s*>/gi, '');
}
let cached;
async function loadMeetingPage() {
  if (process.env.DEV_DISABLE_STATIC_CACHE === 'true') return renderMeetingPage(await fs.readFile(source, 'utf8'));
  if (!cached) cached = fs.readFile(source, 'utf8').then(renderMeetingPage).catch(error => { cached = null; throw error; });
  return cached;
}
async function serveMeetingPage(_req, res, next) {
  try {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(await loadMeetingPage());
  } catch (error) { next(error); }
}
module.exports = { renderMeetingPage, serveMeetingPage };
