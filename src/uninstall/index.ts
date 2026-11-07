/**
 * The uninstall hook (package.json "vscode:uninstall"). The editor runs it with Node, without the
 * extension API, once Many Hats has been uninstalled, on the editor's next start.
 *
 * It points Claude Code back at its own process start in that editor: it removes
 * claudeCode.claudeProcessWrapper from the editor's settings (every profile) when, and only when,
 * it's set to the Many Hats launcher. Other editors where Many Hats is still installed are left
 * alone. Accounts and data in ~/.many-hats stay, so reinstalling picks up where it left off;
 * "Many Hats: Remove All Accounts and Data…" removes them.
 *
 * It never throws: an uninstall must not fail because of it.
 */
import * as os from 'node:os';
import * as path from 'node:path';
import { editorOf, userSettingsDir } from './editors';
import { removeWrapperFrom, settingsFiles } from './settings';
import { layoutFor } from '../state/layout';

export function runUninstallHook(extensionFile: string, home: string): string[] {
  const out: string[] = [];
  const app = editorOf(extensionFile, home);
  if (!app) {
    out.push(
      `Many Hats: unknown editor for ${extensionFile}; remove "claudeCode.claudeProcessWrapper" from its settings by hand.`,
    );
    return out;
  }
  const ours = [layoutFor(home).launcher];
  for (const file of settingsFiles(userSettingsDir(app, home))) {
    try {
      if (removeWrapperFrom(file, ours))
        out.push(`Many Hats: removed claudeCode.claudeProcessWrapper from ${file}`);
    } catch (e) {
      out.push(`Many Hats: couldn't update ${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

if (require.main === module) {
  try {
    for (const line of runUninstallHook(path.resolve(__dirname), os.homedir())) console.log(line);
  } catch (e) {
    console.error(`Many Hats uninstall hook: ${e instanceof Error ? e.message : String(e)}`);
  }
}
