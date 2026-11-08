// The canary's own checks, against Claude Code 2.1's real files: they pass on what works today and
// fail on each change they exist to catch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { check, checkCli, checkCopy, checkUsage, copyArgs, USAGE_ARGS } from '../../scripts/canary.mjs';
import { forkArgs } from '../../src/claude/fork.ts';
import { USAGE_ARGS as EXTENSION_USAGE_ARGS } from '../../src/services/usageRefresh.ts';

const fixture = (name) =>
  fs.readFileSync(path.join(import.meta.dirname, '../fixtures/claude-code-2.1', name), 'utf8');
const failing = (results) => results.filter((r) => !r.ok).map((r) => r.name);

test('canary: the extension checks pass on a manifest like 2.1’s and catch each change', () => {
  const manifest = {
    contributes: {
      configuration: [{ properties: { 'claudeCode.claudeProcessWrapper': { type: 'string' } } }],
      commands: [{ command: 'claude-vscode.editor.open' }],
      views: {
        claude: [{ id: 'claudeVSCodeSidebar' }, { id: 'claudeVSCodeSessionsList' }],
        secondary: [{ id: 'claudeVSCodeSidebarSecondary' }],
      },
    },
  };
  const main = 'const w = config.get("claudeProcessWrapper"); args.push("--resume", id);';
  assert.deepEqual(failing(check(manifest, main)), []);
  assert.deepEqual(failing(check({ contributes: {} }, '')), [
    'the process-wrapper setting exists',
    'the process-wrapper setting is still used',
    'resumed sessions are started with --resume',
    'the open-tab command exists',
    'view claudeVSCodeSidebar exists',
    'view claudeVSCodeSidebarSecondary exists',
    'view claudeVSCodeSessionsList exists',
  ]);
  const views = check({ ...manifest, contributes: { ...manifest.contributes, views: {} } }, main);
  assert.ok(
    views.filter((r) => !r.ok).every((r) => !r.hard),
    'a missing view only warns: Many Hats still activates at startup',
  );
});

test('canary: the CLI checks pass on 2.1’s help and catch a missing command or --email', () => {
  const login = fixture('auth-login-help.txt');
  const logout = fixture('auth-logout-help.txt');
  assert.deepEqual(failing(checkCli(login, logout)), []);
  assert.deepEqual(failing(checkCli(login.replace(/--email.*\n/, ''), logout)), [
    'claude auth login takes --email',
  ]);
  assert.deepEqual(failing(checkCli('', '')), [
    'the CLI signs in with claude auth login',
    'claude auth login takes --email',
    'the CLI signs out with claude auth logout',
  ]);
  assert.ok(
    checkCli('', '').every((r) => r.hard),
    'sign-in and sign-out break without them',
  );
});

test('canary: the usage refresh runs without a prompt and with hooks off, as the extension runs it', () => {
  assert.deepEqual(
    USAGE_ARGS,
    [...EXTENSION_USAGE_ARGS],
    'the canary checks the command line the extension uses',
  );
  const ok = { code: 0, stdout: 'Total cost: $0.0000\n', hookRan: false };
  assert.deepEqual(failing(checkUsage(ok)), []);
  assert.deepEqual(failing(checkUsage({ ...ok, hookRan: true })), ['hooks stay off for the usage refresh']);
  assert.deepEqual(failing(checkUsage({ code: 1, stdout: 'error: unknown option', hookRan: false })), [
    'the CLI runs /usage without a prompt',
    'hooks stay off for the usage refresh',
  ]);
  assert.ok(
    checkUsage({ code: null, stdout: '', hookRan: false }).every((r) => r.hard && !r.ok),
    'a timeout fails both',
  );
});

test('canary: a copy is checked as the extension makes it, and each way it can go wrong is caught', () => {
  const [src, copy] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  const file = `/projects/-work/${src}.jsonl`;
  assert.deepEqual(
    copyArgs(file, copy, 'Canary copy'),
    forkArgs(file, copy, 'Canary copy'),
    'the canary copies with the command line the extension uses',
  );
  const records = [
    { type: 'user', sessionId: copy },
    { type: 'assistant', sessionId: copy },
    { type: 'custom-title', customTitle: 'Canary copy', sessionId: copy },
  ];
  const ok = { code: 0, records, copy, name: 'Canary copy', turns: 0, sourceUnchanged: true, hookRan: false };
  assert.deepEqual(failing(checkCopy(ok)), []);
  assert.deepEqual(failing(checkCopy({ ...ok, code: 1, records: null, turns: undefined })), [
    'the CLI copies a session with --fork-session',
    'the copy carries only its own session ID',
    'the copy leaves the original’s Remote Control link behind',
    'the copy leaves the original’s folder move behind',
    'no turn runs for a copy',
    'hooks stay off for a copy',
    '/rename names the copy',
  ]);
  assert.deepEqual(failing(checkCopy({ ...ok, records: [...records, { type: 'user', sessionId: src }] })), [
    'the copy carries only its own session ID',
  ]);
  assert.deepEqual(
    failing(checkCopy({ ...ok, records: [...records, { type: 'bridge-session', sessionId: copy }] })),
    ['the copy leaves the original’s Remote Control link behind'],
  );
  assert.deepEqual(
    failing(checkCopy({ ...ok, records: [...records, { type: 'relocated', sessionId: copy }] })),
    ['the copy leaves the original’s folder move behind'],
  );
  assert.deepEqual(failing(checkCopy({ ...ok, turns: 1 })), ['no turn runs for a copy']);
  assert.deepEqual(failing(checkCopy({ ...ok, sourceUnchanged: false })), [
    'copying leaves the original untouched',
  ]);
  assert.deepEqual(failing(checkCopy({ ...ok, hookRan: true })), ['hooks stay off for a copy']);
  const unnamed = checkCopy({ ...ok, records: records.slice(0, 2) });
  assert.deepEqual(failing(unnamed), ['/rename names the copy']);
  assert.ok(
    unnamed.every((r) => r.ok || !r.hard),
    'an unnamed copy only warns: Many Hats names it',
  );
});
