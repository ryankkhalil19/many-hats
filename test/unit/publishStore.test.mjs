// The release's publishing: a package counts only once the store serves it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { publishAndConfirm, storeFor, targetOf } from '../../scripts/publish-store.mjs';

const PKG = { publisher: 'ryankkhalil19', name: 'many-hats', version: '0.9.1' };

/** A fake store and clock: `servedAfter` maps a target to the publish count after which it's served. */
function world(servedAfter, { waitMs = 15 * 60_000, pollMs = 30_000 } = {}) {
  let clock = 0;
  const published = [];
  const counts = new Map();
  const lines = [];
  const opts = {
    packages: Object.keys(servedAfter).map((target) => ({ file: `${target}.vsix`, target })),
    publish: (p) => {
      published.push(p.target);
      counts.set(p.target, (counts.get(p.target) ?? 0) + 1);
    },
    live: async (target) =>
      (counts.get(target) ?? 0) >= servedAfter[target].publishes && clock >= servedAfter[target].at,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    log: (m) => lines.push(m),
    waitMs,
    pollMs,
  };
  return { opts, published, lines, clock: () => clock };
}

test('publish-store: each package once, done when every target is served', async () => {
  const w = world({ 'darwin-arm64': { publishes: 1, at: 0 }, 'darwin-x64': { publishes: 1, at: 90_000 } });
  assert.deepEqual(await publishAndConfirm(w.opts), ['darwin-arm64', 'darwin-x64']);
  assert.deepEqual(w.published, ['darwin-arm64', 'darwin-x64'], 'nothing published twice');
  assert.equal(w.clock(), 90_000, 'waited for the slow one');
});

test('publish-store: a target lost by the store is published again halfway through the wait', async () => {
  // The 0.9.0 case: accepted, never listed, until it's sent again.
  const w = world({ 'darwin-arm64': { publishes: 1, at: 0 }, 'darwin-x64': { publishes: 2, at: 0 } });
  assert.deepEqual((await publishAndConfirm(w.opts)).sort(), ['darwin-arm64', 'darwin-x64']);
  assert.deepEqual(w.published, ['darwin-arm64', 'darwin-x64', 'darwin-x64']);
  assert.ok(w.lines.some((l) => l === "darwin-x64 isn't served yet: publishing it again"));
});

test('publish-store: a target that never appears fails the release, by name', async () => {
  const w = world(
    { 'darwin-arm64': { publishes: 1, at: 0 }, 'darwin-x64': { publishes: 99, at: 0 } },
    { waitMs: 4 * 60_000 },
  );
  await assert.rejects(publishAndConfirm(w.opts), /still not served after 4 minutes: darwin-x64/);
  assert.deepEqual(
    w.published,
    ['darwin-arm64', 'darwin-x64', 'darwin-x64'],
    'one retry, not a loop of them',
  );
});

test('publish-store: targets from file names, and each store’s command and download address', () => {
  assert.equal(targetOf('out/packages/many-hats-0.9.1-darwin-x64.vsix', 'many-hats', '0.9.1'), 'darwin-x64');
  assert.throws(
    () => targetOf('many-hats-0.9.0-darwin-x64.vsix', 'many-hats', '0.9.1'),
    /isn't a many-hats 0\.9\.1 package/,
  );
  const m = storeFor('marketplace', PKG);
  assert.deepEqual(m.command('a.vsix'), [
    'npx',
    [
      '--yes',
      '@vscode/vsce@4.1.0',
      'publish',
      '--packagePath',
      'a.vsix',
      '--oidc',
      '--skip-duplicate',
      '--pre-release',
    ],
  ]);
  assert.equal(
    m.url('darwin-x64'),
    'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/ryankkhalil19/vsextensions/many-hats/0.9.1/vspackage?targetPlatform=darwin-x64',
  );
  const o = storeFor('openvsx', { ...PKG, version: '1.0.0' });
  assert.deepEqual(o.command('a.vsix')[1], [
    '--yes',
    'ovsx@1.3.0',
    'publish',
    'a.vsix',
    '--trusted-publishing',
    '--skip-duplicate',
  ]);
  assert.equal(o.url('darwin-arm64'), 'https://open-vsx.org/api/ryankkhalil19/many-hats/darwin-arm64/1.0.0');
  assert.throws(() => storeFor('elsewhere', PKG), /unknown store/);
});
