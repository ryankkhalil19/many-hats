#!/usr/bin/env node
// Builds dist/: the extension, the uninstall hook and the sidebar webview, each bundled by esbuild
// with no runtime dependencies, plus the launcher and the stylesheet.
//
//   node scripts/build.mjs [--production] [--watch] [--integration]
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const integration = process.argv.includes('--integration');

/** @type {esbuild.BuildOptions} */
const node = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  logLevel: 'warning',
  legalComments: 'none',
  // ESM builds first: some packages' "main" is a UMD wrapper that loads files esbuild can't see.
  mainFields: ['module', 'main'],
};

const builds = [
  {
    ...node,
    entryPoints: [path.join(root, 'src/extension.ts')],
    outfile: path.join(root, 'dist/extension.js'),
    external: ['vscode'],
  },
  {
    ...node,
    entryPoints: [path.join(root, 'src/uninstall/index.ts')],
    outfile: path.join(root, 'dist/uninstall.js'),
  },
  {
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'iife',
    sourcemap: !production,
    minify: production,
    logLevel: 'warning',
    entryPoints: [path.join(root, 'src/webview/main.ts')],
    outfile: path.join(root, 'dist/webview.js'),
  },
];
if (integration) {
  const tests = fs.globSync('test/integration/**/*.test.ts', { cwd: root });
  builds.push({
    ...node,
    sourcemap: true,
    minify: false,
    entryPoints: tests.map((t) => path.join(root, t)),
    outdir: path.join(root, 'out/integration'),
    external: ['vscode', 'mocha'],
  });
}

function copyAssets() {
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.copyFileSync(path.join(root, 'src/webview/sidebar.css'), path.join(root, 'dist/sidebar.css'));
  fs.copyFileSync(path.join(root, 'src/launcher/launcher.sh'), path.join(root, 'dist/launcher.sh'));
  fs.chmodSync(path.join(root, 'dist/launcher.sh'), 0o755);
}

if (!watch) fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
copyAssets();
if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((c) => c.watch()));
  fs.watch(path.join(root, 'src/webview/sidebar.css'), copyAssets);
  fs.watch(path.join(root, 'src/launcher/launcher.sh'), copyAssets);
  console.log('watching for changes…');
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log(`built dist/${production ? ' (production)' : ''}`);
}
