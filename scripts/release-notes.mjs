#!/usr/bin/env node
// Prints one version's section of CHANGELOG.md, for its GitHub Release.
//   node scripts/release-notes.mjs 0.9.0
import fs from 'node:fs';
import path from 'node:path';

const version = process.argv[2];
if (!version) {
  console.error('usage: release-notes.mjs <version>');
  process.exit(1);
}
const changelog = fs.readFileSync(path.join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8');
const start = changelog.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const rest = changelog.slice(start);
const next = rest.slice(1).search(/^## \[|^\[[^\]]+\]: /m);
const section = (next < 0 ? rest : rest.slice(0, next + 1)).replace(/^## .*\n/, '').trim();
console.log(
  `${section}\n\nInstall from the VS Code Marketplace or Open VSX, or download the .vsix for your Mac below (Apple silicon: darwin-arm64, Intel: darwin-x64). SHA256SUMS lists their checksums; each has a build provenance attestation (\`gh attestation verify <file> --repo ryankkhalil19/many-hats\`).`,
);
