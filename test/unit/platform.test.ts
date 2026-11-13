import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import test from 'node:test';
import { DarwinPlatform, keychainService, parseProcessEnv } from '../../src/platform/darwin';
import { platformFor } from '../../src/platform';
import type { Runner } from '../../src/infra/exec';

test('parseProcessEnv: the variables that decide an account, never a token’s value', () => {
  const cmd =
    '/x/claude --resume abc TERM=xterm CLAUDE_CONFIG_DIR=/Users/me/.many-hats/accounts/work MANY_HATS_LAUNCHER=1 PATH=/bin';
  assert.deepEqual(parseProcessEnv(cmd), {
    configDir: '/Users/me/.many-hats/accounts/work',
    viaLauncher: true,
    background: false,
    tokenAuth: false,
    tokenAccountUuid: undefined,
  });
  const desktop =
    '/x/claude CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-secret CLAUDE_CODE_ACCOUNT_UUID=ABCDEF01-0000-4000-8000-000000000001';
  const env = parseProcessEnv(desktop);
  assert.equal(env.tokenAuth, true);
  assert.equal(env.tokenAccountUuid, 'abcdef01-0000-4000-8000-000000000001');
  assert.equal(JSON.stringify(env).includes('secret'), false);
  assert.deepEqual(parseProcessEnv('/x/claude'), {
    configDir: undefined,
    viaLauncher: false,
    background: false,
    tokenAuth: false,
    tokenAccountUuid: undefined,
  });
  assert.equal(
    parseProcessEnv('/x/claude CLAUDE_CONFIG_DIR=/a b/c NEXT=1').configDir,
    '/a b/c',
    'a path with a space',
  );
  assert.equal(
    parseProcessEnv('/x/claude CLAUDE_CONFIG_DIR=/d MANY_HATS_BACKGROUND=1 DISABLE_TELEMETRY=1').background,
    true,
    'one of Many Hats’ own background runs',
  );
  assert.equal(
    parseProcessEnv('/x/claude CLAUDE_CODE_OAUTH_TOKEN= X=1').tokenAuth,
    false,
    'an empty token is no token',
  );
});

test('keychainService: named after the config folder, like Claude Code does', () => {
  assert.equal(keychainService(undefined), 'Claude Code-credentials');
  const dir = '/Users/me/.many-hats/accounts/work';
  assert.equal(
    keychainService(dir),
    `Claude Code-credentials-${crypto.createHash('sha256').update(dir).digest('hex').slice(0, 8)}`,
  );
});

test('DarwinPlatform: this window’s claude processes, each environment read once', async () => {
  const calls: string[][] = [];
  const runner: Runner = (file, args) => {
    calls.push([file, ...args]);
    if (args[0] === '-A' && args[2] === 'pid=,ppid=,comm=') {
      return Promise.resolve(
        [
          '  10   1 /Applications/Cursor.app/x',
          '  20 500 /x/native-binary/claude',
          '  21 500 /bin/zsh',
          '  22 999 claude',
          ' 23 500 claude-helper',
          '',
        ].join('\n'),
      );
    }
    if (args[0] === '-A' && args[2] === 'pid=,comm=')
      return Promise.resolve('  20 /x/claude\n  22 claude\n  30 node\n');
    if (args[0] === '-E') {
      const pid = args[args.length - 1];
      if (pid === '20') return Promise.resolve('/x/claude CLAUDE_CONFIG_DIR=/acc/work MANY_HATS_LAUNCHER=1');
      if (pid === '22') return Promise.resolve('/x/claude CLAUDE_CONFIG_DIR=/acc/work/');
      return Promise.reject(new Error('gone'));
    }
    if (file === 'security') return Promise.reject(new Error('not found'));
    return Promise.resolve('');
  };
  const p = new DarwinPlatform(runner);
  assert.deepEqual(await p.claudeChildren(500), [20]);
  const env = await p.processEnv(20);
  assert.equal(env?.configDir, '/acc/work');
  await p.processEnv(20);
  assert.equal(calls.filter((c) => c[1] === '-E').length, 1, 'cached');
  p.forgetEnv(20);
  await p.processEnv(20);
  assert.equal(calls.filter((c) => c[1] === '-E').length, 2);
  assert.equal(await p.processEnv(77), undefined, 'exited meanwhile');
  p.pruneEnvCache(new Set());
  assert.equal(await p.processesUsing('/acc/work'), 2);
  await p.deleteStoredLogin('/acc/work'); // a missing entry is fine
  assert.deepEqual(calls.at(-1), ['security', 'delete-generic-password', '-s', keychainService('/acc/work')]);
});

test('an unsupported platform lists nothing and changes nothing', async () => {
  const p = platformFor('linux', () => Promise.reject(new Error('must not run')));
  assert.equal(p.supported, false);
  assert.deepEqual(await p.claudeChildren(1), []);
  assert.equal(await p.processEnv(1), undefined);
  assert.equal(await p.processesUsing('/x'), 0);
  await p.deleteStoredLogin('/x');
  p.forgetEnv(1);
  p.pruneEnvCache(new Set());
  assert.equal(platformFor('darwin', () => Promise.resolve('')).supported, true);
});
