/**
 * Fault injection: whatever state Many Hats' records are in, Claude Code still starts. Each case
 * breaks something on purpose and checks that Claude runs, with its arguments, exit code and a
 * sensible account.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { A, B } from '../helpers/home';
import { launch, rig } from '../helpers/launcher';

const config = (out: string): string | undefined => /^CONFIG=(.*)$/m.exec(out)?.[1];
const started = (r: { status: number | null; out: string }): boolean =>
  r.status === 0 && /^PID=\d+$/m.test(r.out);

test('no ~/.many-hats at all: the launcher changes nothing, not even a token', () => {
  const t = rig();
  fs.rmSync(t.layout.root, { recursive: true, force: true });
  // The launcher itself lives in the folder that's gone: run a copy, as a stale setting would.
  const copy = path.join(t.home, 'launcher-copy');
  fs.writeFileSync(
    copy,
    fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'launcher', 'launcher.sh')),
    { mode: 0o755 },
  );
  const r = spawnSync(copy, [t.claude, '--resume', A], {
    env: { PATH: '/usr/bin:/bin', HOME: t.home, CLAUDE_CONFIG_DIR: '/kept', CLAUDE_CODE_OAUTH_TOKEN: 'x' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(config(r.stdout), '/kept');
  assert.match(r.stdout, /^TOKEN=x$/m, 'pass-through: exactly as if there were no wrapper');
  assert.match(r.stdout, /^LAUNCHER=$/m);
  assert.equal(fs.existsSync(t.layout.root), false, 'creates nothing');
});

test('HOME unset: Claude still starts', () => {
  const t = rig();
  const r = spawnSync(t.layout.launcher, [t.claude, '--resume', A], {
    env: { PATH: '/usr/bin:/bin' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
});

test('records that are folders, unreadable, binary or huge never stop Claude', () => {
  const t = rig();
  fs.mkdirSync(path.join(t.layout.assignmentsDir, A), { recursive: true }); // a folder where a record should be
  assert.ok(started(launch(t, [t.claude, '--resume', A])));
  t.assign(B, 'dev moved\n');
  fs.chmodSync(path.join(t.layout.assignmentsDir, B), 0o000);
  const unreadable = launch(t, [t.claude, '--resume', B], { CLAUDE_CONFIG_DIR: '/pick' });
  assert.ok(started(unreadable));
  assert.equal(config(unreadable.out), '/pick', 'an unreadable record counts as none');
  fs.chmodSync(path.join(t.layout.assignmentsDir, B), 0o600);
  fs.writeFileSync(path.join(t.layout.assignmentsDir, B), Buffer.from([0, 255, 10, 1, 2]));
  assert.ok(started(launch(t, [t.claude, '--resume', B])));
  fs.writeFileSync(path.join(t.layout.assignmentsDir, B), 'x'.repeat(2_000_000));
  assert.ok(started(launch(t, [t.claude, '--resume', B])));
});

test('the assignments, accounts or next-tab folders being files or missing never stop Claude', () => {
  const t = rig();
  fs.writeFileSync(t.layout.assignmentsDir, 'not a folder');
  fs.writeFileSync(t.layout.nextDir, 'not a folder');
  assert.ok(started(launch(t, [t.claude, '--resume', A])));
  assert.ok(started(launch(t, [t.claude])));
  fs.rmSync(t.layout.accountsDir, { recursive: true });
  fs.rmSync(t.layout.assignmentsDir);
  t.assign(A, 'dev moved\n');
  const r = launch(t, [t.claude, '--resume', A], { CLAUDE_CONFIG_DIR: '/pick' });
  assert.ok(started(r));
  assert.equal(config(r.out), '/pick', 'an account whose folder is gone falls back to the pick');
});

test('a log that can’t be written never stops Claude and prints nothing', () => {
  const t = rig();
  t.assign(B, 'dev observed\n');
  fs.rmSync(t.layout.logsDir, { recursive: true, force: true });
  fs.writeFileSync(t.layout.logsDir, 'not a folder');
  const blocked = launch(t, [t.claude, '--resume', B]);
  assert.ok(started(blocked));
  assert.equal(config(blocked.out), t.dev);
  assert.equal(blocked.err, '');
  fs.rmSync(t.layout.logsDir);
  fs.mkdirSync(t.layout.logsDir, { mode: 0o500 }); // read-only
  const readOnly = launch(t, [t.claude, '--resume', B]);
  assert.ok(started(readOnly));
  assert.equal(readOnly.err, '');
  fs.chmodSync(t.layout.logsDir, 0o700);
});

test('odd arguments: dangling flags, empty values, look-alike ids', () => {
  const t = rig();
  t.assign(A, 'dev moved\n');
  for (const args of [
    ['--resume'],
    ['-r', ''],
    ['--session-id='],
    ['--resume', '--resume'],
    [`--resume=${A}/../x`],
    ['--resume', `${A}\n`],
    ['--', '--resume', 'x'],
  ]) {
    const r = launch(t, [t.claude, ...args]);
    assert.ok(started(r), JSON.stringify(args));
  }
});

test('a crash mid-write leaves a temp file the launcher ignores', () => {
  const t = rig();
  t.assign(A, 'dev moved\n');
  fs.writeFileSync(path.join(t.layout.assignmentsDir, `.${A}.123.deadbeef.tmp`), 'default mo');
  const r = launch(t, [t.claude, '--resume', A]);
  assert.equal(config(r.out), t.dev);
});

test('MANY_HATS_HOME (tests only) points the launcher at a sandbox without touching HOME', () => {
  const t = rig();
  t.assign(A, 'dev moved\n');
  const elsewhere = path.join(t.home, 'not-home');
  fs.mkdirSync(elsewhere);
  const r = spawnSync(t.layout.launcher, [t.claude, '--resume', A], {
    env: { PATH: '/usr/bin:/bin', HOME: elsewhere, MANY_HATS_HOME: t.home },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(config(r.stdout), t.dev);
});
