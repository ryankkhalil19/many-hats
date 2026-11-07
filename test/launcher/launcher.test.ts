/**
 * Runs the launcher the way Claude Code does (`launcher <claude binary> args...`) against a fake
 * Claude binary that reports what it was started with.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { installLauncher, launcherStatus } from '../../src/services/launcher';
import { layoutFor } from '../../src/state/layout';
import { A, B, C, tempDir } from '../helpers/home';
import { launch, rig, type Rig } from '../helpers/launcher';

const quote = (a: string): string => `'${a.replace(/'/g, `'\\''`)}'`;

/**
 * Run the launcher as the child of a shell whose pid the test knows, the way Claude Code runs it
 * as a child of the extension host, so the test can arm that "window's" next-tab record first.
 */
async function launchFromShell(
  t: Rig,
  args: string[],
  env: Record<string, string>,
  arm: (parentPid: string) => void,
): Promise<string> {
  const stamp = `${process.pid}-${Date.now()}`;
  const pidFile = path.join(t.home, `parent-${stamp}.pid`);
  const go = path.join(t.home, `go-${stamp}`);
  // "; true" keeps the shell from exec-ing the launcher in its own place: it must be a child.
  const driver = `echo $$ > ${quote(pidFile)}; while [ ! -f ${quote(go)} ]; do sleep 0.02; done; ${[t.layout.launcher, ...args].map(quote).join(' ')}; true`;
  const p = spawn('/bin/sh', ['-c', driver], { env: { PATH: '/usr/bin:/bin', HOME: t.home, ...env } });
  let out = '';
  p.stdout.on('data', (d: Buffer) => (out += d.toString()));
  const exited = new Promise<void>((r) => p.on('exit', () => r()));
  try {
    const deadline = Date.now() + 5000;
    const written = (): string => (fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : '');
    while (!/^\d+$/.test(written()) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    arm(written());
  } finally {
    fs.writeFileSync(go, ''); // never leave the shell waiting, even if arming failed
  }
  await exited;
  return out;
}

const field =
  (name: string) =>
  (out: string): string | undefined =>
    new RegExp(`^${name}=(.*)$`, 'm').exec(out)?.[1];
const config = field('CONFIG');
const args = (out: string): string[] => [...out.matchAll(/^ARG=(.*)$/gm)].map((m) => m[1] ?? '');
const lastLog = (t: Rig): string => fs.readFileSync(t.logFile, 'utf8').trim().split('\n').pop() ?? '';

test('a new tab keeps the account the window picked; arguments pass through untouched', () => {
  const t = rig();
  const r = launch(
    t,
    [t.claude, '--output-format', 'stream-json', '--append-system-prompt', 'two words', ''],
    { CLAUDE_CONFIG_DIR: t.dev },
  );
  assert.equal(r.status, 0, r.err);
  assert.equal(config(r.out), t.dev);
  assert.match(r.out, /^LAUNCHER=1$/m);
  assert.deepEqual(args(r.out), [
    '--output-format',
    'stream-json',
    '--append-system-prompt',
    'two words',
    '',
  ]);
  assert.equal(config(launch(t, [t.claude]).out), '<unset>', 'default stays default');
});

test('a resumed session starts on the account it belongs to, whatever the window picked', () => {
  const t = rig();
  t.assign(A, 'default moved 2026-11-06T22:00:00.000Z\n');
  t.assign(B, 'dev observed 2026-11-06T22:00:00.000Z\n');
  assert.equal(config(launch(t, [t.claude, `--resume=${A}`], { CLAUDE_CONFIG_DIR: t.dev }).out), '<unset>');
  assert.equal(config(launch(t, [t.claude, '--resume', B]).out), t.dev);
  assert.equal(config(launch(t, [t.claude, '-r', B]).out), t.dev);
  assert.equal(config(launch(t, [t.claude, `--session-id=${B}`]).out), t.dev);
  assert.equal(config(launch(t, [t.claude, '--session-id', B]).out), t.dev);
  assert.equal(
    config(
      launch(t, [t.claude, '--resume', A], { CLAUDE_CONFIG_DIR: t.dev, MANY_HATS_DEFAULT_DIR: '/x/claude' })
        .out,
    ),
    '/x/claude',
    'default means the folder the editor itself was started with, when there is one',
  );
  t.assign(C, 'dev'); // no newline, nothing after the name
  assert.equal(config(launch(t, [t.claude, '--resume', C]).out), t.dev);
});

test('a closed tab’s session still starts on its own account (the 0.3 bug)', () => {
  const t = rig();
  t.assign(B, 'dev observed 2026-11-06T22:00:00.000Z\n');
  const r = launch(t, [t.claude, '--resume', B], { CLAUDE_CONFIG_DIR: '' });
  assert.equal(config(r.out), t.dev);
  assert.match(lastLog(t), new RegExp(`session=${B} account=dev via=assignment$`));
});

test('anything without a usable record keeps the pick, and the log says why', () => {
  const t = rig();
  const env = { CLAUDE_CONFIG_DIR: t.dev };
  assert.equal(config(launch(t, [t.claude, `--resume=${C}`], env).out), t.dev, 'no record');
  assert.match(lastLog(t), new RegExp(`session=${C} account=dev via=pick$`));
  t.assign(A, 'gone moved 2026-11-06T22:00:00.000Z\n');
  assert.equal(config(launch(t, [t.claude, `--resume=${A}`], env).out), t.dev, 'its account was removed');
  assert.match(lastLog(t), /via=pick note="assignment names gone, which no longer exists"$/);
  t.assign(B, '../../etc moved\n');
  assert.equal(config(launch(t, [t.claude, `--resume=${B}`], env).out), t.dev, 'not an account name');
  assert.match(lastLog(t), /via=pick note="assignment record held no account name"$/);
  t.assign(B, `${'x'.repeat(40)} moved\n`);
  assert.equal(
    config(launch(t, [t.claude, `--resume=${B}`], env).out),
    t.dev,
    'too long for an account name',
  );
  assert.equal(config(launch(t, [t.claude, '--resume=*'], env).out), t.dev, 'not a session id');
  assert.match(lastLog(t), /session=new account=dev via=pick$/);
  assert.equal(config(launch(t, [t.claude, `--resume=${A}0`], env).out), t.dev, 'too long for a session id');
  t.assign(C, '\n');
  assert.equal(config(launch(t, [t.claude, `--resume=${C}`], env).out), t.dev, 'an empty record');
});

test('a login token in the environment can’t override the account: it’s removed', () => {
  const t = rig();
  t.assign(B, 'dev observed\n');
  const desktop = {
    CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-secret',
    CLAUDE_CODE_OAUTH_SCOPES: 'user:inference',
    CLAUDE_CODE_ACCOUNT_UUID: '99999999-9999-4999-8999-999999999999',
    CLAUDE_CODE_USER_EMAIL: 'admin@example.com',
    CLAUDE_CODE_ORGANIZATION_UUID: '0809a7f2-270a-409b-81ea-5ca4281088b4',
    CLAUDE_CODE_SUBSCRIPTION_TYPE: 'team',
    CLAUDE_CODE_RATE_LIMIT_TIER: 'default_claude_max_5x',
  };
  const r = launch(t, [t.claude, '--resume', B], desktop);
  assert.equal(config(r.out), t.dev);
  assert.equal(field('TOKEN')(r.out), '<unset>');
  assert.equal(field('IDENTITY')(r.out), '<unset>/<unset>/<unset>');
  assert.match(
    lastLog(t),
    /removed=CLAUDE_CODE_OAUTH_TOKEN,CLAUDE_CODE_OAUTH_SCOPES,CLAUDE_CODE_ACCOUNT_UUID,CLAUDE_CODE_USER_EMAIL,CLAUDE_CODE_ORGANIZATION_UUID,CLAUDE_CODE_SUBSCRIPTION_TYPE,CLAUDE_CODE_RATE_LIMIT_TIER$/,
  );
  assert.doesNotMatch(
    fs.readFileSync(t.logFile, 'utf8'),
    /secret|admin@example\.com|99999999/,
    'the log never holds the token or who it was for',
  );
  launch(t, [t.claude]);
  assert.doesNotMatch(lastLog(t), /removed=/, 'nothing to remove: nothing said');
});

test('the decision log: one line per start with the pid Claude runs as, private, and rotated', () => {
  const t = rig();
  t.assign(B, 'dev observed\n');
  const r = launch(t, [t.claude, '--resume', B]);
  const pid = field('PID')(r.out) ?? '';
  assert.match(
    lastLog(t),
    new RegExp(
      `^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ pid=${pid} session=${B} account=dev via=assignment$`,
    ),
    'exec keeps the pid',
  );
  assert.equal(fs.statSync(t.logFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(t.logFile)).mode & 0o777, 0o700);
  fs.writeFileSync(t.logFile, 'x'.repeat(300_000));
  launch(t, [t.claude]);
  assert.equal(fs.statSync(`${t.logFile}.1`).size, 300_000, 'the full log moved aside');
  assert.equal(fs.readFileSync(t.logFile, 'utf8').trim().split('\n').length, 1);
});

test('the exit code, stdin and a missing bundled binary', () => {
  const t = rig();
  assert.equal(launch(t, [t.claude], { FAKE_EXIT: '7' }).status, 7);
  const cat = path.join(t.home, 'bundled', 'cat-claude');
  fs.writeFileSync(cat, '#!/bin/sh\ncat\n', { mode: 0o755 });
  assert.equal(launch(t, [cat], {}, 'hello from Claude Code').out, 'hello from Claude Code');
  // The bundled binary moved: fall back to ~/.local/bin/claude, without passing it the stale path.
  const local = path.join(t.home, '.local', 'bin', 'claude');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.copyFileSync(t.claude, local);
  fs.chmodSync(local, 0o755);
  const r = launch(t, [path.join(t.home, 'gone', 'claude'), '--verbose']);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(args(r.out), ['--verbose']);
  fs.rmSync(local);
  const none = launch(t, [path.join(t.home, 'gone', 'claude')]);
  assert.equal(none.status, 127);
  assert.match(none.err, /no Claude binary/);
});

test('a new tab asked for on an account claims the window’s one-shot record; a resumed session never does', async () => {
  const t = rig();
  const env = { CLAUDE_CONFIG_DIR: '' };
  const first = await launchFromShell(t, [t.claude], env, (ppid) => {
    fs.mkdirSync(t.layout.nextDir, { recursive: true });
    fs.writeFileSync(path.join(t.layout.nextDir, ppid), 'dev\n');
  });
  assert.equal(config(first), t.dev, 'the new tab started on the requested account');
  assert.deepEqual(fs.readdirSync(t.layout.nextDir), [], 'claimed and deleted');
  assert.match(lastLog(t), /account=dev via=next$/);
  const resumed = await launchFromShell(t, [t.claude, '--resume', C], env, (ppid) => {
    fs.writeFileSync(path.join(t.layout.nextDir, ppid), 'dev\n');
  });
  assert.equal(config(resumed), '', 'a resume is never the tab the window asked for: it keeps the pick');
  assert.equal(fs.readdirSync(t.layout.nextDir).length, 1, 'left for the tab it was meant for');
  const other = await launchFromShell(t, [t.claude], env, () => {
    // armed for a different window: not this one's
  });
  assert.equal(config(other), '', 'another window’s record is not this tab’s');
});

test('launcherStatus and installLauncher: rewritten only when changed, always executable', () => {
  const home = tempDir();
  const layout = layoutFor(home);
  assert.equal(launcherStatus(layout, '#!/bin/sh\n'), 'missing');
  assert.equal(installLauncher(layout, '#!/bin/sh\necho one\n'), true);
  assert.equal(fs.statSync(layout.launcher).mode & 0o777, 0o755);
  const ino = fs.statSync(layout.launcher).ino;
  assert.equal(installLauncher(layout, '#!/bin/sh\necho one\n'), false);
  assert.equal(fs.statSync(layout.launcher).ino, ino, 'same content: left as it is');
  assert.equal(launcherStatus(layout, '#!/bin/sh\necho two\n'), 'outdated');
  installLauncher(layout, '#!/bin/sh\necho two\n');
  assert.equal(fs.readFileSync(layout.launcher, 'utf8'), '#!/bin/sh\necho two\n');
  fs.chmodSync(layout.launcher, 0o600);
  assert.equal(launcherStatus(layout, '#!/bin/sh\necho two\n'), 'not-executable');
  installLauncher(layout, '#!/bin/sh\necho two\n');
  assert.equal(launcherStatus(layout, '#!/bin/sh\necho two\n'), 'ok');
});
