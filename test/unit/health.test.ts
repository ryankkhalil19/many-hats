import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { Compat } from '../../src/claude/compat';
import { diagnosticsReport, tailLines } from '../../src/services/diagnostics';
import { checkHealth, repairAll, type HealthDeps, type WrapperSetting } from '../../src/services/health';
import { installLauncher } from '../../src/services/launcher';
import { housekeeping } from '../../src/services/maintenance';
import { Archive } from '../../src/state/archive';
import { Assignments } from '../../src/state/assignments';
import { ensureLayout, layoutFor } from '../../src/state/layout';
import { NextTab } from '../../src/state/nextTab';
import { Picks } from '../../src/state/picks';
import { A, B, DAY, age, memoryLogger, tempDir } from '../helpers/home';
import { FakePlatform } from '../helpers/fakes';

const SCRIPT = '#!/bin/sh\nexec "$@"\n';

function deps(o: Partial<HealthDeps> = {}) {
  const home = tempDir();
  const layout = layoutFor(home);
  ensureLayout(layout);
  installLauncher(layout, SCRIPT);
  const wrapper: WrapperSetting = {
    global: layout.launcher,
    workspace: undefined,
    workspaceFolder: undefined,
  };
  const d: HealthDeps = {
    layout,
    launcherScript: SCRIPT,
    platform: new FakePlatform(),
    compat: new Compat(),
    wrapper: () => wrapper,
    setWrapper: (v) => {
      wrapper.global = v;
      return Promise.resolve();
    },
    claudeExtensionInstalled: () => true,
    claudeBinary: () => '/x/claude',
    ...o,
  };
  return { d, layout, wrapper };
}

test('health: all good says nothing', () => {
  assert.deepEqual(checkHealth(deps().d), []);
});

test('health: a missing launcher, an unset wrapper and loose permissions are repaired', async () => {
  const { d, layout, wrapper } = deps();
  fs.rmSync(layout.launcher);
  wrapper.global = undefined;
  fs.chmodSync(layout.root, 0o755);
  const checks = checkHealth(d);
  assert.deepEqual(
    checks.map((c) => [c.id, c.level]),
    [
      ['permissions', 'warning'],
      ['launcher', 'error'],
      ['wrapper-unset', 'error'],
    ],
  );
  const repaired = await repairAll(checks);
  assert.equal(repaired.length, 3);
  assert.deepEqual(checkHealth(d), []);
  assert.equal(wrapper.global, layout.launcher);
});

test('health: someone else’s wrapper, a workspace override, a missing Claude Code, paused features', () => {
  const compat = new Compat();
  const { d, wrapper } = deps({ compat, claudeExtensionInstalled: () => false });
  wrapper.global = '/usr/local/bin/their-wrapper';
  wrapper.workspace = '/elsewhere';
  for (let i = 0; i < 3; i++) compat.observe('liveSessions', 0, 1, 'no session id');
  const checks = checkHealth(d);
  assert.deepEqual(
    checks.map((c) => c.id),
    ['wrapper-foreign', 'wrapper-override', 'claude-extension', 'compat-liveSessions'],
  );
  assert.equal(checks.find((c) => c.id === 'wrapper-foreign')?.repair, undefined, 'never overwritten');
  assert.equal(checks.find((c) => c.id === 'claude-extension')?.action?.command, 'manyHats.showClaudeCode');
  assert.match(checks.find((c) => c.id === 'compat-liveSessions')?.title ?? '', /which sessions are open/);
  const noCli = deps({ claudeBinary: () => undefined });
  assert.deepEqual(
    checkHealth(noCli.d).map((c) => c.id),
    ['claude-cli'],
  );
  const linux = deps({ platform: Object.assign(new FakePlatform(), { supported: false, name: 'linux' }) });
  assert.deepEqual(
    checkHealth(linux.d).map((c) => c.id),
    ['platform'],
  );
});

test('diagnostics: versions, checks and launcher decisions, with no emails, tokens, home or account names', () => {
  const home = '/Users/someone';
  const report = diagnosticsReport(
    {
      extensionVersion: '0.9.0',
      editor: { name: 'Cursor', version: '1.105.0' },
      os: { platform: 'darwin', release: '27.2.0', arch: 'arm64' },
      claudeExtensionVersion: '2.1.319',
      cliVersion: '2.1.319 (Claude Code)',
      layoutVersion: 1,
      wrapper: { global: `${home}/.many-hats/bin/launcher`, workspace: '/their', workspaceFolder: undefined },
      launcherPath: `${home}/.many-hats/bin/launcher`,
      accounts: { names: ['acme-client', 'personal'], signedIn: 2 },
      assignments: 12,
      runningTabs: 3,
      health: [
        { id: 'x', level: 'warning', title: 'Something for me@example.com', detail: `at ${home}/.many-hats` },
      ],
      compat: [{ feature: 'usage', detail: 'no usage windows', since: 0 }],
      launcherLog: [
        `2026-11-06T22:00:00Z pid=1 session=${A} account=acme-client via=assignment`,
        'removed=CLAUDE_CODE_OAUTH_TOKEN token=sk-ant-oat01-abcdefgh',
      ],
    },
    home,
  );
  assert.match(report, /Many Hats: 0\.9\.0/);
  assert.match(report, /global Many Hats launcher, workspace another program, folder unset/);
  assert.match(report, /account=account-1 via=assignment/);
  assert.doesNotMatch(report, /acme-client|me@example\.com|sk-ant-oat01-abcdefgh|\/Users\/someone/);
  assert.match(report, /usage: no usage windows/);
  const empty = diagnosticsReport({
    extensionVersion: '1',
    editor: { name: 'Code', version: '1' },
    os: { platform: 'darwin', release: '1', arch: 'x64' },
    claudeExtensionVersion: undefined,
    cliVersion: undefined,
    layoutVersion: undefined,
    wrapper: { global: undefined, workspace: undefined, workspaceFolder: undefined },
    launcherPath: '/l',
    accounts: { names: [], signedIn: 0 },
    assignments: 0,
    runningTabs: 0,
    health: [],
    compat: [],
    launcherLog: [],
  });
  assert.match(empty, /all checks pass[\s\S]*no issues[\s\S]*\(none\)/);
});

test('tailLines: the last lines of a big log, without a cut first line', () => {
  const dir = tempDir();
  const file = path.join(dir, 'log');
  fs.writeFileSync(file, Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n') + '\n');
  assert.deepEqual(tailLines(file, 3), ['line 4997', 'line 4998', 'line 4999']);
  assert.deepEqual(tailLines(path.join(dir, 'missing'), 3), []);
});

test('housekeeping: forgets records of sessions that are gone, sweeps what crashes left', () => {
  const home = tempDir();
  const layout = layoutFor(home);
  const claudeDir = path.join(home, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'projects', 'x'), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'projects', 'x', `${B}.jsonl`), '');
  const assignments = new Assignments(layout.assignmentsDir, () => true);
  const archive = new Archive(layout.archiveDir);
  const nextTab = new NextTab(layout.nextDir);
  const picks = new Picks(layout.picksDir);
  assignments.set(A, 'default', 'observed');
  assignments.set(B, 'default', 'observed');
  age(path.join(layout.assignmentsDir, A), 10 * DAY);
  archive.set(A, true);
  nextTab.arm(1, 'default');
  age(nextTab.file(1), DAY);
  const log = memoryLogger();
  housekeeping({ claudeDir, assignments, archive, nextTab, picks, log });
  assert.deepEqual([...assignments.list().keys()], [B]);
  assert.equal(archive.list().size, 0);
  assert.equal(nextTab.isArmed(1), false);
  assert.match(log.lines.join('\n'), /forgot the accounts of 1 session/);
  // Can't read the projects folder: forget nothing.
  fs.rmSync(path.join(claudeDir, 'projects'), { recursive: true });
  age(path.join(layout.assignmentsDir, B), 10 * DAY);
  housekeeping({ claudeDir, assignments, archive, nextTab, picks, log });
  assert.deepEqual([...assignments.list().keys()], [B]);
});
