/**
 * Many Hats in a real VS Code, with the real Claude Code extension when it could be installed.
 * Runs against a throwaway home (see .vscode-test.mjs). The end-to-end tests open real Claude
 * Code tabs and check, in the launcher's own log, which account each one started on.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { TestApi } from '../../src/extension';

const ID = 'ryankkhalil19.many-hats';
const COMMANDS = [
  'manyHats.choose',
  'manyHats.openTab',
  'manyHats.moveTab',
  'manyHats.addAccount',
  'manyHats.signIn',
  'manyHats.removeAccount',
  'manyHats.showTabs',
  'manyHats.refresh',
  'manyHats.repair',
  'manyHats.collectDiagnostics',
  'manyHats.removeEverything',
];

async function waitFor(check: () => boolean, ms = 30_000, what = 'condition'): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

suite('Many Hats in a real editor', () => {
  let api: TestApi;
  const claudeCode = (): boolean => vscode.extensions.getExtension('anthropic.claude-code') !== undefined;
  const log = (): string => {
    try {
      return fs.readFileSync(api.app.layout.launcherLog, 'utf8');
    } catch {
      return '';
    }
  };

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<TestApi>(ID);
    assert.ok(ext, 'Many Hats is installed in the test editor');
    const exported = await ext.activate();
    assert.ok(exported, 'activate() hands tests its API when MANY_HATS_TEST=1');
    api = exported;
  });

  test('activation: the data folder, the launcher and every command', async () => {
    const { layout } = api.app;
    assert.ok(fs.statSync(layout.root).isDirectory());
    assert.equal(fs.statSync(layout.root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(layout.launcher).mode & 0o777, 0o755);
    const commands = await vscode.commands.getCommands(true);
    for (const c of COMMANDS) assert.ok(commands.includes(c), c);
    assert.equal(
      process.env.MANY_HATS_DEFAULT_DIR,
      process.env.CLAUDE_CONFIG_DIR,
      'the editor’s own config folder is the default account',
    );
  });

  test('the sidebar and status bar come up without errors', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.manyHats');
    await vscode.commands.executeCommand('manyHats.refresh');
  });

  test('without Claude Code, the setup check says so and nothing else breaks', function () {
    if (claudeCode()) return this.skip();
    const ids = api.app.health().map((c) => c.id);
    assert.ok(ids.includes('claude-extension'), JSON.stringify(ids));
    assert.ok(!ids.includes('launcher') && !ids.includes('permissions'), JSON.stringify(ids));
    assert.equal(
      vscode.workspace.getConfiguration('claudeCode').inspect('claudeProcessWrapper')?.globalValue,
      undefined,
      'nothing written for an extension that isn’t there',
    );
  });

  test('Claude Code is pointed at the launcher', async function () {
    if (!claudeCode()) return this.skip();
    const inspect = () =>
      vscode.workspace.getConfiguration('claudeCode').inspect<string>('claudeProcessWrapper');
    try {
      await waitFor(
        () => inspect()?.globalValue === api.app.layout.launcher,
        30_000,
        'claudeCode.claudeProcessWrapper',
      );
    } catch (e) {
      const health = api.app.health().map((c) => `${c.id}: ${c.title}`);
      throw new Error(
        `${(e as Error).message}; inspect=${JSON.stringify(inspect())}; health=${JSON.stringify(health)}`,
        { cause: e },
      );
    }
    assert.deepEqual(
      api.app
        .health()
        .map((c) => c.id)
        .filter((id) => id !== 'claude-cli'),
      [],
      'nothing needs attention',
    );
  });

  test('a new tab on another account starts there; a plain new tab starts on the window’s account', async function () {
    if (!claudeCode()) return this.skip();
    api.app.accounts.create('work');
    const before = log().split('\n').length;
    const out = await api.app.sessions.newSession('work');
    if (!out.started) {
      // Claude Code opened its tab without starting a claude process (it can wait for sign-in).
      return this.skip();
    }
    await waitFor(() => /account=work via=next/.test(log()), 30_000, 'the launcher’s decision');
    assert.equal(out.startedOn, 'work');
    assert.equal(api.app.nextTab.isArmed(process.pid), false, 'the one-shot record was claimed');
    await vscode.commands.executeCommand('claude-vscode.editor.open');
    await waitFor(
      () =>
        log()
          .split('\n')
          .slice(before)
          .some((l) => /account=default via=pick/.test(l)),
      30_000,
      'a plain new tab',
    );
  });
});
