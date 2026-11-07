#!/usr/bin/env node
// Packages one .vsix per macOS target with Microsoft's vsce (which runs the production build
// first), then checks each package: exactly the allowlisted files, nothing over budget.
// An odd minor version (0.9.x, 1.1.x) is a pre-release, as both stores recommend.
//   node scripts/package.mjs            → out/packages/many-hats-<version>-<target>.vsix
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const TARGETS = ['darwin-arm64', 'darwin-x64'];
const MAX_BYTES = 256 * 1024;
const ALLOWED = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/readme.md',
  'extension/changelog.md',
  'extension/LICENSE.txt',
  'extension/dist/extension.js',
  'extension/dist/uninstall.js',
  'extension/dist/webview.js',
  'extension/dist/sidebar.css',
  'extension/dist/launcher.sh',
  'extension/media/icon.png',
  'extension/media/activity.svg',
  'extension/media/glyphs.woff',
].sort();

export const isPreRelease = (version) => Number(version.split('.')[1]) % 2 === 1;

export function checkPackage(file) {
  const problems = [];
  const entries = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).trim().split('\n').sort();
  for (const e of entries) if (!ALLOWED.includes(e)) problems.push(`unexpected file: ${e}`);
  for (const e of ALLOWED) if (!entries.includes(e)) problems.push(`missing file: ${e}`);
  const size = fs.statSync(file).size;
  if (size > MAX_BYTES) problems.push(`${size} bytes, over the ${MAX_BYTES}-byte budget`);
  const main = execFileSync('unzip', ['-p', file, 'extension/dist/extension.js'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (/sourceMappingURL/.test(main))
    problems.push('dist/extension.js has a source map: not a production build');
  const manifest = JSON.parse(
    execFileSync('unzip', ['-p', file, 'extension/package.json'], { encoding: 'utf8' }),
  );
  for (const field of ['publisher', 'repository', 'license', 'icon'])
    if (!manifest[field]) problems.push(`package.json has no ${field}`);
  const launcher = execFileSync('unzip', ['-p', file, 'extension/dist/launcher.sh'], { encoding: 'utf8' });
  if (launcher !== fs.readFileSync(path.join(root, 'src/launcher/launcher.sh'), 'utf8'))
    problems.push('dist/launcher.sh differs from src/launcher/launcher.sh');
  return { entries: entries.length, size, problems };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = path.join(root, 'out', 'packages');
  fs.mkdirSync(outDir, { recursive: true });
  const vsce = path.join(root, 'node_modules', '.bin', 'vsce');
  let failed = false;
  for (const target of TARGETS) {
    const file = path.join(outDir, `${pkg.name}-${pkg.version}-${target}.vsix`);
    fs.rmSync(file, { force: true });
    execFileSync(
      vsce,
      [
        'package',
        '--no-dependencies',
        '--target',
        target,
        '--out',
        file,
        ...(isPreRelease(pkg.version) ? ['--pre-release'] : []),
      ],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );
    const { entries, size, problems } = checkPackage(file);
    console.log(
      `${path.relative(root, file)}: ${entries} files, ${(size / 1024).toFixed(1)} KiB${problems.length ? '' : ', checks pass'}`,
    );
    for (const p of problems) console.error(`  ✖ ${p}`);
    failed ||= problems.length > 0;
  }
  process.exit(failed ? 1 : 0);
}
