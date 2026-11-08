import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { USAGE_ARGS, UsageRefresher, type UsageRefreshDeps } from '../../src/services/usageRefresh';
import type { RunOptions } from '../../src/infra/exec';
import { fakeHome, memoryLogger } from '../helpers/home';

const NOW = Date.parse('2026-11-07T16:00:00Z');
const MIN = 60_000;

/** Signs a config in (with an account uuid), with cached figures from `fetchedAtMs` if given. */
function signIn(file: string, email: string, uuid: string, fetchedAtMs?: number): void {
  const j = (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}) as Record<string, unknown>;
  j.oauthAccount = { emailAddress: email, accountUuid: uuid };
  if (fetchedAtMs !== undefined)
    j.cachedUsageUtilization = {
      fetchedAtMs,
      accountUuid: uuid,
      utilization: { five_hour: { utilization: 10 } },
    };
  fs.writeFileSync(file, JSON.stringify(j));
}

interface Call {
  file: string;
  args: readonly string[];
  options: RunOptions | undefined;
}

/**
 * A home with the default account and "work" signed in. The fake CLI does what Claude Code's
 * /usage does: it saves fresh figures for the account its CLAUDE_CONFIG_DIR names.
 */
function setup(o: { defaultAt?: number; workAt?: number } = {}) {
  const h = fakeHome();
  h.addAccount('work');
  h.addAccount('client'); // never signed in
  signIn(h.store.configFile(undefined), 'me@example.com', 'uuid-default', o.defaultAt);
  signIn(h.store.configFile('work'), 'me@work.example', 'uuid-work', o.workAt);
  let clock = NOW;
  const calls: Call[] = [];
  const saveFigures = (configFile: string): void => {
    const j = JSON.parse(fs.readFileSync(configFile, 'utf8')) as { oauthAccount: { accountUuid: string } };
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        ...j,
        cachedUsageUtilization: {
          fetchedAtMs: clock,
          accountUuid: j.oauthAccount.accountUuid,
          utilization: { five_hour: { utilization: 20 } },
        },
      }),
    );
  };
  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin',
    CLAUDE_CODE_OAUTH_TOKEN: 'inherited-from-the-desktop-app',
    CLAUDE_CODE_USER_EMAIL: 'admin@example.com',
    CLAUDE_CONFIG_DIR: '/the/window/pick',
  };
  const ctl = {
    h,
    calls,
    log: memoryLogger(),
    changes: 0,
    /** What the fake CLI does; by default it saves fresh figures. */
    behave: (configFile: string): Promise<void> => {
      saveFigures(configFile);
      return Promise.resolve();
    },
    advance: (ms: number) => (clock += ms),
    now: () => clock,
  };
  const deps: UsageRefreshDeps = {
    layout: h.layout,
    store: h.store,
    run: async (file, args, options) => {
      calls.push({ file, args, options });
      const dir = options?.env?.CLAUDE_CONFIG_DIR;
      // Like execFile with a signal: aborting stops the program, and the run fails with an AbortError.
      const aborted = new Promise<never>((_, reject) =>
        options?.signal?.addEventListener('abort', () =>
          reject(
            Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' }),
          ),
        ),
      );
      aborted.catch(() => undefined);
      await Promise.race([
        ctl.behave(dir ? path.join(dir, '.claude.json') : h.store.configFile(undefined)),
        aborted,
      ]);
      return '';
    },
    watchMs: 5,
    claudeBinary: () => '/fake/claude',
    env,
    log: ctl.log,
    onChange: () => ctl.changes++,
    now: () => clock,
  };
  return { ...ctl, deps, r: new UsageRefresher(deps), ctl };
}

/** A promise and the function that settles it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

test('usage refresh: Claude Code’s own /usage, for exactly that account, quietly, from a fixed folder', async () => {
  const t = setup({ defaultAt: NOW - 20 * MIN, workAt: NOW - 20 * MIN });
  let duringRun = false;
  const save = t.ctl.behave;
  t.ctl.behave = async (file) => {
    duringRun = t.r.isRefreshing('work');
    await save(file);
  };
  assert.equal(await t.r.refresh('work'), 'refreshed');
  assert.equal(duringRun, true, 'the sidebar shows it as updating meanwhile');
  assert.equal(t.ctl.changes, 2, 'once when it starts, once when it ends');
  const [call] = t.calls;
  assert.ok(call);
  assert.equal(call.file, '/fake/claude');
  assert.deepEqual(call.args, USAGE_ARGS);
  assert.deepEqual(USAGE_ARGS, [
    '-p',
    '/usage',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--settings',
    '{"disableAllHooks":true}',
  ]);
  const env = call.options?.env ?? {};
  assert.equal(env.CLAUDE_CONFIG_DIR, t.h.store.dir('work'));
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined, 'an inherited login never overrides the account');
  assert.equal(env.CLAUDE_CODE_USER_EMAIL, undefined);
  assert.equal(env.PATH, '/usr/bin:/bin');
  assert.equal(env.DISABLE_AUTOUPDATER, '1');
  assert.equal(env.DISABLE_TELEMETRY, '1');
  assert.equal(
    call.options?.cwd,
    t.h.layout.root,
    'one folder, so Claude Code keeps at most one project entry',
  );
  assert.equal(call.options?.timeoutMs, UsageRefresher.TIMEOUT_MS);
  assert.equal(t.r.fetchedAt('work'), NOW);
  assert.equal(t.r.isRefreshing('work'), false);
  assert.equal(fs.existsSync(path.join(t.h.layout.locksDir, 'usage-work')), false, 'the lock is let go');

  assert.equal(await t.r.refresh('default'), 'refreshed');
  assert.equal(
    t.calls[1]?.options?.env?.CLAUDE_CONFIG_DIR,
    undefined,
    'the default account: Claude Code’s own folder',
  );
  assert.equal(t.r.fetchedAt('default'), NOW);
});

test('usage refresh: Claude Code is stopped once it has saved the figures, before its long analysis', async () => {
  const t = setup({ workAt: NOW - 20 * MIN });
  t.ctl.behave = (file) => {
    // Claude Code 2.1.3xx saves the figures in seconds, then reads every session on the machine
    // for "What's contributing to your usage?", which can run past the time allowed.
    signIn(file, 'me@work.example', 'uuid-work', t.now());
    return new Promise<void>(() => undefined);
  };
  const started = Date.now();
  const out = await t.r.refresh('work');
  const stopped = t.calls[0]?.options?.signal?.aborted === true;
  assert.equal(out, 'refreshed');
  assert.equal(stopped, true, 'the run is stopped');
  assert.ok(Date.now() - started < 2000, 'without waiting for the analysis');
  assert.equal(t.r.lastError('work'), undefined);
  assert.equal(t.r.isRefreshing('work'), false);
  // A run that fails before saving anything still fails, and isn't mistaken for a stop.
  t.advance(UsageRefresher.FRESH_MS);
  t.ctl.behave = () => Promise.reject(Object.assign(new Error('Command failed'), { code: 1 }));
  assert.equal(await t.r.refresh('work'), 'failed');
  assert.equal(t.r.lastError('work'), 'Claude Code’s CLI failed (exit code 1).');
  assert.ok(
    t.log.lines.some((l) => l.includes('(exit code 1)')),
    'the log says how it ended',
  );
});

test('usage refresh: figures under a minute old are what Claude Code would answer with, so nothing runs', async () => {
  const t = setup({ workAt: NOW - 30_000 });
  assert.equal(await t.r.refresh('work'), 'refreshed');
  assert.equal(t.calls.length, 0);
  t.advance(UsageRefresher.FRESH_MS);
  assert.equal(await t.r.refresh('work'), 'refreshed');
  assert.equal(t.calls.length, 1, 'older than that, it runs');
});

test('usage refresh: signed-in accounts with stale or no figures are due, refreshed one at a time', async () => {
  const t = setup({ defaultAt: NOW - 5 * MIN });
  assert.deepEqual(t.r.due(), ['work'], 'fresh figures and signed-out accounts wait');
  t.advance(11 * MIN);
  assert.deepEqual(t.r.due(), ['default', 'work']);

  const gate = deferred();
  const save = t.ctl.behave;
  t.ctl.behave = async (file) => {
    await gate.promise;
    await save(file);
  };
  t.r.tick();
  t.r.tick();
  assert.equal(t.calls.length, 1, 'one refresh at a time');
  assert.deepEqual(t.r.due(), ['work'], 'the one under way is not due');
  gate.resolve();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.r.fetchedAt('default'), NOW + 11 * MIN);
  t.r.tick();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(t.calls.length, 2);
  assert.deepEqual(t.r.due(), []);
});

test('usage refresh: a failure reads as a few words, pauses automatic refreshes, and a click still tries', async () => {
  const t = setup({ defaultAt: NOW, workAt: NOW - 20 * MIN });
  t.ctl.behave = () =>
    Promise.reject(
      Object.assign(new Error('Command failed: /fake/claude -p /usage (and its output)'), {
        killed: true,
        signal: 'SIGTERM',
      }),
    );
  assert.equal(await t.r.refresh('work'), 'failed');
  assert.equal(t.r.lastError('work'), 'Claude Code took too long.');
  assert.ok(
    t.log.lines.some((l) => l.startsWith('warn') && l.includes('Command failed')),
    'the log has the details',
  );
  assert.equal(t.r.isRefreshing('work'), false);
  assert.deepEqual(t.r.due(), [], 'automatic refreshes wait');
  t.advance(UsageRefresher.RETRY_MS);
  assert.ok(t.r.due().includes('work'), 'and try again later');

  t.ctl.behave = () => Promise.reject(Object.assign(new Error('Command failed'), { code: 2 }));
  assert.equal(await t.r.refresh('work'), 'failed', 'a click always tries');
  assert.equal(t.r.lastError('work'), 'Claude Code’s CLI failed (exit code 2).');

  t.ctl.behave = () => Promise.resolve(); // ran, saved nothing
  assert.equal(await t.r.refresh('work'), 'failed');
  assert.equal(t.r.lastError('work'), 'Claude Code saved no new figures.');

  t.ctl.behave = (file) => {
    signIn(file, 'me@work.example', 'uuid-work', t.now() - 30_000);
    return Promise.resolve();
  };
  assert.equal(await t.r.refresh('work'), 'refreshed', 'figures from the last minute are an answer too');
  assert.equal(t.r.lastError('work'), undefined, 'success clears the failure');

  t.advance(UsageRefresher.FRESH_MS);
  const none = new UsageRefresher({ ...t.deps, claudeBinary: () => undefined });
  const before = t.calls.length;
  assert.equal(await none.refresh('work'), 'failed');
  assert.equal(none.lastError('work'), 'Claude Code’s CLI wasn’t found.');
  assert.equal(t.calls.length, before, 'nothing ran');
});

test('usage refresh: one window at a time per account, across windows; a lock left behind expires', async () => {
  const t = setup({ workAt: NOW - 20 * MIN });
  const lock = path.join(t.h.layout.locksDir, 'usage-work');
  fs.mkdirSync(t.h.layout.locksDir, { recursive: true });
  fs.writeFileSync(lock, `123 ${NOW - MIN}\n`);
  assert.equal(await t.r.refresh('work'), 'busy', 'another window is on it');
  assert.equal(t.calls.length, 0);
  fs.writeFileSync(lock, `123 ${NOW - UsageRefresher.LOCK_STALE_MS - 1}\n`);
  assert.equal(await t.r.refresh('work'), 'refreshed', 'a window that went away doesn’t block it');
  assert.equal(fs.existsSync(lock), false);
  fs.writeFileSync(lock, 'garbage');
  t.advance(20 * MIN);
  assert.equal(await t.r.refresh('work'), 'refreshed', 'an unreadable lock counts as left behind');

  // Two windows at once.
  const gate = deferred();
  const save = t.ctl.behave;
  t.ctl.behave = async (file) => {
    await gate.promise;
    await save(file);
  };
  const other = new UsageRefresher(t.deps);
  t.advance(20 * MIN);
  const first = t.r.refresh('work');
  assert.equal(await other.refresh('work'), 'busy');
  assert.equal(await t.r.refresh('work'), 'busy', 'nor twice in one window');
  gate.resolve();
  assert.equal(await first, 'refreshed');
});

test('usage refresh: nothing runs for a signed-out or unknown account', async () => {
  const t = setup();
  assert.equal(await t.r.refresh('client'), 'skipped');
  assert.equal(await t.r.refresh('../etc'), 'skipped');
  assert.equal(await t.r.refresh('nobody'), 'skipped');
  assert.equal(t.calls.length, 0);
  assert.equal(t.ctl.changes, 0);
});
