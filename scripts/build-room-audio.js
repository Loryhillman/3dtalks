const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const target = path.resolve(__dirname, '../public/vendor/livekit');
fs.mkdirSync(target, { recursive: true });
esbuild.buildSync({ stdin: { contents: 'export * from "livekit-client";', resolveDir: path.resolve(__dirname, '..') },
  bundle: true, minify: true, format: 'iife', globalName: 'LivekitClient', target: 'es2020',
  outfile: path.join(target, 'livekit-client-2.23.0.js'), legalComments: 'eof' });
fs.copyFileSync(path.resolve(path.dirname(require.resolve('livekit-client')), '../LICENSE'), path.join(target, 'LICENSE'));
