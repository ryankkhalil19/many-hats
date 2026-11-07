#!/usr/bin/env node
// Publishes the release packages to one store, then waits until the store serves every one of them.
// A store can accept an upload and never list it: 0.9.0's Intel build was accepted by the
// Marketplace a second after the Apple silicon one, while it was still creating the extension, and
// never appeared. So a package only counts as published once it can be downloaded. One that's still
// missing halfway through the wait is published again (duplicates are skipped), and if any is still
// missing at the end, the release fails and says which.
//   node scripts/publish-store.mjs marketplace|openvsx <many-hats-X.Y.Z-target.vsix>...
// The release workflow runs it, where trusted publishing (OIDC) authenticates both CLIs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WAIT_MS = 15 * 60_000;
const POLL_MS = 30_000;

/** The target platform in a package's file name: many-hats-0.9.1-darwin-arm64.vsix → darwin-arm64. */
export function targetOf(file, name, version) {
  const m = new RegExp(`^${name}-${version.replace(/\./g, '\\.')}-([a-z0-9-]+)\\.vsix$`).exec(
    path.basename(file),
  );
  if (!m) throw new Error(`${path.basename(file)} isn't a ${name} ${version} package`);
  return m[1];
}

export function storeFor(store, { publisher, name, version }) {
  const pre = Number(version.split('.')[1]) % 2 === 1 ? ['--pre-release'] : []; // odd minor: pre-release
  if (store === 'marketplace')
    return {
      label: 'VS Code Marketplace',
      command: (file) => [
        'npx',
        [
          '--yes',
          '@vscode/vsce@4.1.0',
          'publish',
          '--packagePath',
          file,
          '--oidc',
          '--skip-duplicate',
          ...pre,
        ],
      ],
      url: (target) =>
        `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${publisher}/vsextensions/${name}/${version}/vspackage?targetPlatform=${target}`,
    };
  if (store === 'openvsx')
    return {
      label: 'Open VSX',
      command: (file) => [
        'npx',
        ['--yes', 'ovsx@1.3.0', 'publish', file, '--trusted-publishing', '--skip-duplicate', ...pre],
      ],
      url: (target) => `https://open-vsx.org/api/${publisher}/${name}/${target}/${version}`,
    };
  throw new Error(`unknown store "${store}" (marketplace or openvsx)`);
}

/**
 * Publishes each package in turn, then polls until every target is served. A target still missing
 * after half the wait is published once more.
 * @returns the targets that are live (all of them, or it throws)
 */
export async function publishAndConfirm({
  packages,
  publish,
  live,
  sleep,
  now,
  log,
  waitMs = WAIT_MS,
  pollMs = POLL_MS,
}) {
  for (const p of packages) publish(p);
  const start = now();
  const seen = new Set();
  let retried = false;
  for (;;) {
    for (const p of packages) {
      if (!seen.has(p.target) && (await live(p.target))) {
        seen.add(p.target);
        log(`${p.target} is live`);
      }
    }
    const missing = packages.filter((p) => !seen.has(p.target));
    if (!missing.length) return [...seen];
    const elapsed = now() - start;
    if (!retried && elapsed >= waitMs / 2) {
      retried = true;
      for (const p of missing) {
        log(`${p.target} isn't served yet: publishing it again`);
        publish(p);
      }
    }
    if (elapsed >= waitMs)
      throw new Error(
        `still not served after ${Math.round(waitMs / 60_000)} minutes: ${missing.map((p) => p.target).join(', ')}`,
      );
    await sleep(pollMs);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [storeName, ...files] = process.argv.slice(2);
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const store = storeFor(storeName, pkg);
  if (!files.length) throw new Error('no packages given');
  const packages = files.map((file) => ({ file, target: targetOf(file, pkg.name, pkg.version) }));
  try {
    await publishAndConfirm({
      packages,
      publish: (p) => {
        const [cmd, args] = store.command(p.file);
        execFileSync(cmd, args, { stdio: 'inherit' });
      },
      live: async (target) => {
        try {
          const res = await fetch(store.url(target), {
            redirect: 'follow',
            signal: AbortSignal.timeout(30_000),
          });
          await res.body?.cancel();
          return res.ok;
        } catch {
          return false;
        }
      },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      log: (m) => console.log(`${store.label}: ${pkg.name} ${pkg.version} ${m}`),
    });
  } catch (e) {
    console.error(`::error::${store.label}: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
