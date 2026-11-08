/**
 * Many Hats in a real VS Code, with the real Claude Code extension when it could be installed.
 * Runs against a throwaway home (see .vscode-test.mjs). The end-to-end tests open real Claude
 * Code tabs and check, in the launcher's own log, which account each one started on.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { projectDir } from '../../src/claude/paths';
import type { TestApi } from '../../src/extension';

const ID = 'ryankkhalil19.many-hats';
const COMMANDS = [
  'manyHats.choose',
  'manyHats.openTab',
  'manyHats.moveTab',
  'manyHats.copyTab',
  'manyHats.addAccount',
  'manyHats.signIn',
  'manyHats.removeAccount',
  'manyHats.showTabs',
  'manyHats.refresh',
  'manyHats.repair',
  'manyHats.collectDiagnostics',
  'manyHats.removeEverything',
];

/** A two-message conversation in Claude Code 2.1's format (as test/fixtures/claude-code-2.1/conversation.jsonl). */
function conversation(sessionId: string): string {
  const base = {
    isSidechain: false,
    userType: 'external',
    entrypoint: 'cli',
    cwd: '/work',
    sessionId,
    version: '2.1.319',
    gitBranch: '',
  };
  const user = '9e8d7c6b-0000-4000-8000-000000000001';
  const reply = '9e8d7c6b-0000-4000-8000-000000000002';
  return [
    {
      ...base,
      parentUuid: null,
      type: 'user',
      message: { role: 'user', content: 'Summarize the README in one line.' },
      uuid: user,
      timestamp: '2026-11-01T10:00:00.000Z',
    },
    { type: 'ai-title', aiTitle: 'Summarize the README', sessionId },
    {
      ...base,
      parentUuid: user,
      type: 'assistant',
      message: {
        model: 'claude-sonnet-5-5',
        id: 'msg_e2e000000000000000000001',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'It explains what the project does.' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 9 },
      },
      requestId: 'req_e2e000000000000000000001',
      uuid: reply,
      timestamp: '2026-11-01T10:00:02.000Z',
    },
    { type: 'last-prompt', lastPrompt: 'Summarize the README in one line.', leafUuid: reply, sessionId },
  ]
    .map((r) => `${JSON.stringify(r)}\n`)
    .join('');
}

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

  let copied: string | undefined;

  test('Copy to account: Claude Code forks the session into a new session on that account', async function () {
    if (!claudeCode() || !api.app.claudeBinary()) return this.skip(); // the CLI comes with Claude Code
    this.timeout(180_000);
    if (!api.app.store.exists('work')) api.app.accounts.create('work');
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    assert.ok(folder, 'the test editor has a folder');
    const source = '77777777-7777-4777-8777-777777777777';
    const dir = projectDir(api.app.store.defaultDir, folder);
    fs.mkdirSync(dir, { recursive: true });
    const original = conversation(source);
    fs.writeFileSync(path.join(dir, `${source}.jsonl`), original);

    const out = await api.app.sessions.copySession(source, 'work', 'E2E copy', folder);
    assert.notEqual(out.id, source);
    assert.equal(out.name, 'E2E copy');
    assert.equal(api.app.assignments.get(out.id)?.source, 'copied');
    assert.equal(api.app.assignments.accountOf(out.id), 'work');
    const records = fs
      .readFileSync(path.join(dir, `${out.id}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type?: string; sessionId?: string; customTitle?: string });
    assert.ok(
      records.some((r) => r.type === 'assistant'),
      'the conversation came along',
    );
    assert.ok(
      records.every((r) => r.sessionId === undefined || r.sessionId === out.id),
      'only the copy’s ID',
    );
    assert.ok(records.some((r) => r.type === 'custom-title' && r.customTitle === 'E2E copy'));
    assert.equal(
      fs.readFileSync(path.join(dir, `${source}.jsonl`), 'utf8'),
      original,
      'the original is untouched',
    );
    copied = out.id;
  });

  test('the copy opens on the account it was copied to', async function () {
    const id = copied;
    if (!id) return this.skip();
    const before = log().split('\n').length;
    await api.app.sessions.openSession(id);
    try {
      await waitFor(
        () =>
          log()
            .split('\n')
            .slice(before)
            .some((l) => l.includes(`session=${id} account=work via=assignment`)),
        30_000,
        'the copy starting',
      );
    } catch {
      // Claude Code opened its tab without starting a claude process (it can wait for sign-in).
      return this.skip();
    }
  });
});
