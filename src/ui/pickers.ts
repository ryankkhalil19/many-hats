import * as vscode from 'vscode';
import type { App } from './app';
import { DEFAULT_ACCOUNT, extraOrUndefined } from '../core/ids';

/** An account's email, if it's signed in. @param name undefined or "default": the default */
export function emailOf(app: App, name: string | undefined): string | undefined {
  return app.store.profile(extraOrUndefined(name)).email;
}

/**
 * Pick an account.
 * @returns the account (undefined: default), or null if cancelled
 */
export async function pickAccount(
  app: App,
  title: string,
  withDefault: boolean,
): Promise<string | undefined | null> {
  const names = [...(withDefault ? [DEFAULT_ACCOUNT] : []), ...app.store.list()];
  if (!names.length) {
    void vscode.window.showInformationMessage(
      'There are no extra accounts yet. Add one from the Many Hats sidebar.',
    );
    return null;
  }
  const chosen = await vscode.window.showQuickPick(
    names.map((n) => ({
      label: n === DEFAULT_ACCOUNT ? '$(home) default' : `$(account) ${n}`,
      description: emailOf(app, n) ?? 'not signed in',
      name: n,
    })),
    { title },
  );
  if (!chosen) return null;
  return extraOrUndefined(chosen.name);
}
