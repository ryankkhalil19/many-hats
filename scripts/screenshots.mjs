#!/usr/bin/env node
// Screenshots of the sidebar for the README, from tools/preview with made-up data, in dark and
// light themes, using headless Chrome. Run `npm run build` first.
//   node scripts/screenshots.mjs [--chrome /path/to/chrome]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const flag = process.argv.indexOf('--chrome');
const chrome =
  flag > 0 ? process.argv[flag + 1] : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(chrome)) {
  console.error(`Chrome not found at ${chrome}; pass --chrome <path>`);
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'dist/webview.js'))) {
  console.error('Build first: npm run build');
  process.exit(1);
}
const page = pathToFileURL(path.join(root, 'tools/preview/index.html'));
for (const theme of ['dark', 'light']) {
  const out = path.join(root, 'docs/images', `sidebar-${theme}.png`);
  execFileSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      '--window-size=320,1110',
      '--virtual-time-budget=2000',
      `--screenshot=${out}`,
      `${page.href}?theme=${theme}&shot=1`,
    ],
    { stdio: 'ignore' },
  );
  console.log(path.relative(root, out));
}
