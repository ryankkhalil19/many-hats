// The canary's own checks, against Claude Code 2.1's real files: they pass on what works today and
// fail on each change they exist to catch.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { check, checkCli } from '../../scripts/canary.mjs';

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
