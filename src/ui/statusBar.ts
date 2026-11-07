/**
 * The status bar item: the account new Claude Code tabs here start on, with the open tabs and any
 * problem in its tooltip. Click to choose.
 */
import * as vscode from 'vscode';
import type { App } from './app';
import { emailOf } from './pickers';
import { label } from './text';

export function createStatusBar(app: App): vscode.Disposable & { render(): void } {
  const item = vscode.window.createStatusBarItem('manyHats.status', vscode.StatusBarAlignment.Right, 1000);
  item.name = 'Many Hats: Account for New Claude Code Tabs';
  item.command = 'manyHats.choose';

  const render = (): void => {
    const pick = app.pick.pick;
    const who = emailOf(app, pick);
    const problems = app.health().filter((c) => c.level !== 'ok');
    item.text = `$(many-hats-logo) ${label(pick)}${pick && !who ? ' $(sign-in)' : ''}${problems.length ? ' $(warning)' : ''}`;
    const tip = new vscode.MarkdownString(undefined, true);
    tip.appendMarkdown('**New Claude Code tabs here start on** ').appendText(label(pick));
    tip.appendText(who ? ` (${who})` : ' (not signed in yet)').appendMarkdown('\n\n');
    if (app.pick.missing) {
      tip
        .appendText(
          `This window was set to "${app.pick.missing}", which no longer exists, so new tabs start on default.`,
        )
        .appendMarkdown('\n\n');
    }
    const tabs = app.scanner.running().filter((r) => r.sessionId);
    if (tabs.length) {
      const counts = new Map<string, number>();
      for (const t of tabs)
        counts.set(t.account ?? 'another login', (counts.get(t.account ?? 'another login') ?? 0) + 1);
      tip
        .appendMarkdown('**Open tabs:** ')
        .appendText([...counts].map(([a, n]) => `${a} ×${n}`).join(', '))
        .appendMarkdown('\n\n');
      const moving = tabs.filter((t) => {
        const assigned = t.sessionId ? app.assignments.accountOf(t.sessionId) : undefined;
        return assigned && assigned !== t.account;
      });
      if (moving.length)
        tip
          .appendText(
            `${moving.length} tab(s) here move to another account when they next start: reload the window to move them now.`,
          )
          .appendMarkdown('\n\n');
    } else {
      tip.appendText('No Claude Code tabs are open here.').appendMarkdown('\n\n');
    }
    for (const p of problems) tip.appendMarkdown('$(warning) ').appendText(p.title).appendMarkdown('\n\n');
    tip.appendMarkdown('Click to change it. Tabs already open keep their own account.');
    item.tooltip = tip;
    item.backgroundColor =
      app.pick.missing || problems.some((p) => p.level === 'error')
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
  };

  render();
  item.show();
  return {
    render,
    dispose: () => item.dispose(),
  };
}
