import * as vscode from 'vscode';
import type { App } from '../app';
import { guard } from '../guard';
import { addAccount, refreshAllUsage, removeAccount, removeEverything, signInPicker } from './accounts';
import { collectDiagnostics, repair, showClaudeCode } from './support';
import { choose, copyTab, moveTab, openTabOn, showTabs } from './tabs';

/** Every command in package.json, each inside the error boundary. */
export function registerCommands(app: App): vscode.Disposable[] {
  const reg = (id: string, fn: () => unknown): vscode.Disposable =>
    vscode.commands.registerCommand(id, guard(app.log, id, fn));
  return [
    reg('manyHats.choose', () => choose(app)),
    reg('manyHats.openTab', () => openTabOn(app)),
    reg('manyHats.moveTab', () => moveTab(app)),
    reg('manyHats.copyTab', () => copyTab(app)),
    reg('manyHats.addAccount', () => addAccount(app)),
    reg('manyHats.signIn', () => signInPicker(app)),
    reg('manyHats.removeAccount', () => removeAccount(app)),
    reg('manyHats.showTabs', () => showTabs(app)),
    reg('manyHats.refresh', () => {
      void app.scanner.scan();
      app.refresh();
      void refreshAllUsage(app);
    }),
    reg('manyHats.repair', () => repair(app)),
    reg('manyHats.collectDiagnostics', () => collectDiagnostics(app)),
    reg('manyHats.removeEverything', () => removeEverything(app)),
    reg('manyHats.showClaudeCode', () => showClaudeCode()),
  ];
}
