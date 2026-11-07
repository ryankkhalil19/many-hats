/** Adding, signing in and removing accounts, with the prompts around them. */
import * as vscode from 'vscode';
import type { App } from '../app';
import { pickAccount } from '../pickers';
import { tildify } from '../text';
import { UserError } from '../../core/errors';
import { accountNameProblem, DEFAULT_ACCOUNT } from '../../core/ids';
import { setWrapper, wrapperSetting } from '../host';

const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

/** Open a terminal that signs an account in. @param name undefined: default */
export function signIn(app: App, name: string | undefined): void {
  const t = app.accounts.signInTerminal(name);
  const terminal = vscode.window.createTerminal({
    name: `Sign in: ${t.name}`,
    shellPath: t.shellPath,
    shellArgs: t.shellArgs,
    isTransient: true,
  });
  terminal.show();
  void vscode.window.showInformationMessage(
    `Sign in to "${t.name}"${t.email ? ` as ${t.email}` : ''} in your browser, then paste the code into the terminal. If the browser is signed in to claude.ai as someone else, open the link in a private window.`,
  );
}

export async function signInPicker(app: App): Promise<void> {
  const chosen = await pickAccount(app, 'Sign in to which account?', true);
  if (chosen !== null) signIn(app, chosen);
}

export async function addAccount(app: App): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: 'Add an account (1/2)',
    prompt: 'A short name for it, like work, client-a or personal',
    validateInput: (v) => {
      const n = v.trim();
      return n ? (app.store.nameProblem(n) ?? undefined) : undefined;
    },
  });
  const name = input?.trim();
  if (!name) return;
  const problem = accountNameProblem(name);
  if (problem) throw new UserError(problem);
  const mail = await vscode.window.showInputBox({
    title: `Add an account (2/2): ${name}`,
    prompt: 'Its email (optional). Sign-in then asks your browser for exactly this account.',
    placeHolder: 'you@example.com',
    validateInput: (v) =>
      !v.trim() || EMAIL_RE.test(v.trim()) ? undefined : 'That doesn’t look like an email address.',
  });
  if (mail === undefined) return;
  app.accounts.create(name, mail.trim() || undefined);
  app.refresh();
  const go = await vscode.window.showInformationMessage(
    `Account "${name}" is ready. Sign in to it now?`,
    {
      modal: true,
      detail: `A terminal opens and your browser asks you to sign in${mail.trim() ? ` as ${mail.trim()}` : ''}. Then use "${name}" from the Many Hats sidebar or the status bar.`,
    },
    'Sign In',
  );
  if (go === 'Sign In') signIn(app, name);
}

/** @param given skip the picker */
export async function removeAccount(app: App, given?: string): Promise<void> {
  if (!app.store.list().length) {
    void vscode.window.showInformationMessage('There are no extra accounts to remove.');
    return;
  }
  const chosen = given ?? (await pickAccount(app, 'Remove an account', false));
  if (!chosen || !app.store.exists(chosen)) return;
  const busy = await app.accounts.usersOf(chosen);
  const { conversations, windows } = app.accounts.removalImpact(chosen);
  const many = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
  const go = await vscode.window.showWarningMessage(
    `Remove the "${chosen}" account?`,
    {
      modal: true,
      detail: [
        `This signs it out on this Mac and moves ${tildify(app.store.dir(chosen))} to the Trash.`,
        'Conversations, settings and CLAUDE.md live in ~/.claude and stay.',
        conversations
          ? `${many(conversations, 'conversation')} belong to it. They’ll stop reopening on it and start on the window’s account for new tabs.`
          : '',
        windows
          ? `New tabs in ${many(windows, 'window')} start on it. They’ll start on the default account instead.`
          : '',
        busy
          ? `${busy} Claude process(es) run on it right now, in this or another window. Close those tabs first or they stop working.`
          : '',
        'If it’s signed out or its usage looks old, Sign In Again or Refresh Usage fixes that and keeps all of this.',
      ]
        .filter(Boolean)
        .join(' '),
    },
    'Remove',
  );
  if (go !== 'Remove') return;
  const wasPick = app.pick.pick === chosen;
  await app.accounts.remove(chosen);
  if (wasPick) await app.pick.set(undefined);
  app.refresh();
  void vscode.window.showInformationMessage(`Removed the "${chosen}" account.`);
}

/**
 * Remove every extra account and Many Hats' data, and unhook Claude Code, ready to uninstall.
 * Conversations and settings in ~/.claude are untouched.
 */
export async function removeEverything(app: App): Promise<void> {
  const names = app.store.list();
  const go = await vscode.window.showWarningMessage(
    'Remove all Many Hats accounts and data?',
    {
      modal: true,
      detail: [
        names.length
          ? `Signs out and removes ${names.map((n) => `"${n}"`).join(', ')}.`
          : 'There are no extra accounts.',
        `Moves ${tildify(app.layout.root)} to the Trash and stops Claude Code from starting tabs through Many Hats.`,
        'Your default login, conversations, settings and CLAUDE.md in ~/.claude stay.',
      ].join(' '),
    },
    'Remove Everything',
  );
  if (go !== 'Remove Everything') return;
  for (const name of names) await app.accounts.remove(name);
  await app.pick.set(undefined);
  if (wrapperSetting().global === app.layout.launcher) await setWrapper(undefined);
  await vscode.workspace.fs.delete(vscode.Uri.file(app.layout.root), { recursive: true, useTrash: true });
  app.log.info('removed all accounts and data');
  app.refresh();
  const next = await vscode.window.showInformationMessage(
    'Many Hats removed its accounts and data. Uninstall the extension now?',
    'Uninstall',
  );
  if (next === 'Uninstall')
    await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', app.context.extension.id);
}

/** Asks Claude Code for every signed-in account's latest usage, one account at a time. */
export async function refreshAllUsage(app: App): Promise<void> {
  const failed: string[] = [];
  for (const account of [DEFAULT_ACCOUNT, ...app.store.list()]) {
    if ((await app.usage.refresh(account)) === 'failed')
      failed.push(`${account}: ${app.usage.lastError(account) ?? 'it failed'}`);
  }
  if (failed.length)
    void vscode.window.showWarningMessage(`Couldn’t refresh the usage of ${failed.join('; ')}`);
}
