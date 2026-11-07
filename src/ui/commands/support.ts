/** Self-checks, repairs and diagnostics. */
import * as os from 'node:os';
import * as vscode from 'vscode';
import type { App } from '../app';
import { claudeExtension, wrapperSetting } from '../host';
import { CLAUDE_EXTENSION_ID, ISSUES_URL } from '../text';
import { DEFAULT_ACCOUNT } from '../../core/ids';
import { diagnosticsReport, tailLines } from '../../services/diagnostics';
import { repairAll } from '../../services/health';
import { readLayoutVersion } from '../../state/layout';
import { run } from '../../infra/exec';

/** "Check and Repair Setup": apply every safe repair, then report what's left. */
export async function repair(app: App): Promise<void> {
  const repaired = await repairAll(app.health());
  const left = app.health();
  app.refresh();
  for (const r of repaired) app.log.info(`repaired: ${r}`);
  if (!left.length) {
    void vscode.window.showInformationMessage(
      repaired.length
        ? `Many Hats repaired ${repaired.length} thing(s); everything checks out now.`
        : 'Many Hats: everything checks out.',
    );
    return;
  }
  const first = left[0];
  if (!first) return;
  const action = first.action;
  const choice = await vscode.window.showWarningMessage(
    `Many Hats: ${first.title}`,
    { modal: false, detail: first.detail },
    ...(action ? [action.label] : []),
    'Collect Diagnostics',
  );
  if (choice === 'Collect Diagnostics') await collectDiagnostics(app);
  else if (action && choice === action.label) await vscode.commands.executeCommand(action.command);
}

export async function collectDiagnostics(app: App): Promise<void> {
  const binary = app.claudeBinary();
  const cliVersion = binary
    ? (await run(binary, ['--version'], { timeoutMs: 5000 }).catch(() => undefined))?.trim()
    : undefined;
  const names = app.store.list();
  const signedIn = [DEFAULT_ACCOUNT, ...names].filter(
    (n) => app.store.profile(n === DEFAULT_ACCOUNT ? undefined : n).email,
  ).length;
  const report = diagnosticsReport({
    extensionVersion: app.version,
    editor: { name: vscode.env.appName, version: vscode.version },
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    claudeExtensionVersion: (claudeExtension()?.packageJSON as { version?: string } | undefined)?.version,
    cliVersion,
    layoutVersion: readLayoutVersion(app.layout),
    wrapper: wrapperSetting(),
    launcherPath: app.layout.launcher,
    accounts: { names, signedIn },
    assignments: app.assignments.list().size,
    runningTabs: app.scanner.running().length,
    health: app.health(),
    compat: app.compat.issues(),
    launcherLog: tailLines(app.layout.launcherLog, 40),
  });
  await vscode.env.clipboard.writeText(report);
  const choice = await vscode.window.showInformationMessage(
    'Many Hats copied a diagnostics report to the clipboard. It contains no emails, tokens or account names. Paste it into a bug report.',
    'Open a Bug Report',
    'Show Report',
  );
  if (choice === 'Open a Bug Report') await vscode.env.openExternal(vscode.Uri.parse(ISSUES_URL));
  if (choice === 'Show Report') {
    const doc = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
    await vscode.window.showTextDocument(doc);
  }
}

export async function showClaudeCode(): Promise<void> {
  await vscode.commands.executeCommand('workbench.extensions.search', `@id:${CLAUDE_EXTENSION_ID}`);
}
