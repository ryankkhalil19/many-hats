/** Opening, starting, moving and copying Claude Code tabs, with the prompts around them. */
import * as vscode from 'vscode';
import type { App } from '../app';
import { localFolders } from '../host';
import { emailOf, pickAccount } from '../pickers';
import { label, notSignedIn, tildify } from '../text';
import { signIn, addAccount, removeAccount, signInPicker } from './accounts';
import { copyName, defaultCopyName } from '../../claude/fork';
import { folderOfSession } from '../../claude/paths';
import { extraOrUndefined } from '../../core/ids';
import type { MoveOutcome } from '../../services/sessions';

const reloadWindow = (): Thenable<unknown> => vscode.commands.executeCommand('workbench.action.reloadWindow');

/** Status bar click: choose the account for new tabs, or manage accounts. */
export async function choose(app: App): Promise<void> {
  const names = app.store.list();
  const pick = app.pick.pick;
  const here = (n: string | undefined): string => (n === pick ? '  $(check)' : '');
  type Item = vscode.QuickPickItem & { account?: string | null; action?: string };
  const items: Item[] = [
    {
      label: `$(home) default${here(undefined)}`,
      description: emailOf(app, undefined) ?? 'not signed in',
      detail: `${tildify(app.store.defaultDir)}: your main Claude Code login`,
      account: null,
    },
    ...names.map((n): Item => ({
      label: `$(account) ${n}${here(n)}`,
      description: emailOf(app, n) ?? 'not signed in',
      detail: tildify(app.store.dir(n)),
      account: n,
    })),
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    { label: '$(layout-sidebar-left) Open the Many Hats sidebar', action: 'sidebar' },
    { label: '$(arrow-swap) Move a Claude Code tab to another account…', action: 'move' },
    { label: '$(copy) Copy a Claude Code tab to another account…', action: 'copy' },
    { label: '$(person-add) Add account…', action: 'add' },
    { label: '$(key) Sign in to an account…', action: 'signIn' },
    { label: '$(list-unordered) Show Claude Code tabs by account', action: 'show' },
  ];
  if (names.length) items.push({ label: '$(trash) Remove account…', action: 'remove' });
  const chosen = await vscode.window.showQuickPick(items, {
    title: 'Account for new Claude Code tabs in this window',
    placeHolder: `Now: ${label(pick)}. Tabs already open keep their own account.`,
  });
  if (!chosen) return;
  switch (chosen.action) {
    case 'sidebar':
      await app.revealSidebar();
      return;
    case 'move':
      return moveTab(app);
    case 'copy':
      return copyTab(app);
    case 'add':
      return addAccount(app);
    case 'signIn':
      return signInPicker(app);
    case 'show':
      return showTabs(app);
    case 'remove':
      return removeAccount(app);
    default:
      await usePick(app, chosen.account ?? undefined);
  }
}

/** Make an account the one new tabs start on, then offer to open a tab on it. */
export async function usePick(app: App, name: string | undefined): Promise<void> {
  const target = extraOrUndefined(name);
  if (target !== app.pick.pick) await app.pick.set(target);
  app.refresh();
  if (!emailOf(app, target)) {
    const go = await vscode.window.showWarningMessage(notSignedIn(label(target)), 'Sign In');
    if (go) signIn(app, target);
    return;
  }
  const go = await vscode.window.showInformationMessage(
    `New Claude Code tabs in this window now start on "${label(target)}". Tabs already open keep their own account.`,
    'Open Claude Code Tab',
  );
  if (go) await app.sessions.newSession(target);
}

/** Command: pick an account and open a Claude Code tab on it. */
export async function openTabOn(app: App): Promise<void> {
  const chosen = await pickAccount(app, 'Open a Claude Code tab on…', true);
  if (chosen !== null) await newSession(app, chosen);
}

/** A new Claude Code tab on an account, without changing the account for new tabs. */
export async function newSession(app: App, name: string | undefined): Promise<void> {
  const target = extraOrUndefined(name);
  if (!emailOf(app, target)) {
    const go = await vscode.window.showWarningMessage(notSignedIn(label(target)), 'Sign In');
    if (go) signIn(app, target);
    return;
  }
  const outcome = await app.sessions.newSession(target);
  app.refresh();
  if (outcome.started && outcome.startedOn !== undefined && outcome.startedOn !== outcome.expected) {
    void vscode.window.showWarningMessage(
      `The new Claude Code tab started on "${outcome.startedOn}", not "${outcome.expected}". Use Move in the Many Hats sidebar to put it on the right account.`,
    );
  }
}

/** Open a session in a tab, on its own account. */
export async function openSession(app: App, id: string, title: string): Promise<void> {
  const outcome = await app.sessions.openSession(id);
  if (outcome.kind === 'elsewhere') {
    void vscode.window.showWarningMessage(
      `"${title}" is open in another window. Switch to that window to use it.`,
    );
  }
  app.refresh();
}

/**
 * Copy a session to an account: name the copy, have Claude Code make it, then open it there (or,
 * if that account isn't signed in, say so). The original stays as it is.
 * @param folder the folder the session runs in
 */
export async function copySession(
  app: App,
  id: string,
  account: string,
  title: string,
  folder: string,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: `Copy "${title}" to ${account}`,
    prompt: 'Name the copy. The original stays as it is.',
    value: defaultCopyName(title),
    validateInput: (v) => (copyName(v) ? undefined : 'Give the copy a name.'),
  });
  if (name === undefined) return;
  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Copying "${title}" to ${account}…` },
    () => app.sessions.copySession(id, account, name, folder),
  );
  app.refresh();
  if (!outcome.signedIn) {
    const go = await vscode.window.showWarningMessage(
      `Copied as "${outcome.name}" on "${account}", which isn't signed in yet. Sign in to it, then open the copy.`,
      'Sign In',
    );
    if (go) signIn(app, extraOrUndefined(account));
    return;
  }
  await openSession(app, outcome.id, outcome.name);
}

/** Put a session on another account from its next start; offer to restart it now if it's open here. */
export async function moveSession(app: App, id: string, account: string, title: string): Promise<void> {
  const outcome = await app.sessions.moveSession(id, account);
  app.refresh();
  await afterMove(app, outcome, title, account);
}

async function afterMove(app: App, outcome: MoveOutcome, title: string, account: string): Promise<void> {
  if (outcome.runsThere) return;
  if (!outcome.signedIn) {
    void vscode.window.showWarningMessage(
      `"${account}" isn't signed in yet. Sign in to it before "${title}" next starts.`,
    );
  }
  if (outcome.running === 'here') {
    const go = await vscode.window.showInformationMessage(
      `"${title}" moves to "${account}" when it restarts. Reload the window to move it now? Claude Code tabs here restart and pick up where they were.`,
      'Reload Window',
    );
    if (go) await reloadWindow();
  } else if (outcome.running === 'elsewhere') {
    void vscode.window.showInformationMessage(
      `"${title}" is open in another window. It moves to "${account}" when that tab restarts.`,
    );
  }
}

/** Command: make an open tab run on another account from its next start. */
export async function moveTab(app: App): Promise<void> {
  await app.scanner.scan();
  const tabs = app.scanner.running().filter((r) => r.sessionId);
  if (!tabs.length) {
    void vscode.window.showInformationMessage('No Claude Code tabs are open in this window.');
    return;
  }
  const tab = await vscode.window.showQuickPick(
    tabs.map((r) => ({
      label: r.title ?? 'Untitled',
      description: `on ${r.account ?? 'another login'}`,
      tab: r,
    })),
    { title: 'Move which Claude Code tab to another account?' },
  );
  const sessionId = tab?.tab.sessionId;
  if (!tab || !sessionId) return;
  const target = await pickAccount(app, `Move "${tab.label}" to…`, true);
  if (target === null) return;
  await moveSession(app, sessionId, label(target), tab.label);
}

/** Command: copy an open tab's conversation to an account. */
export async function copyTab(app: App): Promise<void> {
  await app.scanner.scan();
  const tabs = app.scanner
    .running()
    .flatMap((r) =>
      r.sessionId ? [{ r, folder: folderOfSession(app.store.defaultDir, localFolders(), r.sessionId) }] : [],
    )
    .filter((t): t is { r: (typeof t)['r']; folder: string } => t.folder !== undefined);
  if (!tabs.length) {
    void vscode.window.showInformationMessage(
      'No Claude Code tab with a saved conversation is open in this window.',
    );
    return;
  }
  const tab = await vscode.window.showQuickPick(
    tabs.map((t) => ({
      label: t.r.title ?? 'Untitled',
      description: `on ${t.r.account ?? 'another login'}`,
      tab: t,
    })),
    { title: 'Copy which Claude Code tab to another account?' },
  );
  const sessionId = tab?.tab.r.sessionId;
  if (!tab || !sessionId) return;
  const target = await pickAccount(app, `Copy "${tab.label}" to…`, true);
  if (target === null) return;
  await copySession(app, sessionId, label(target), tab.label, tab.tab.folder);
}

export async function showTabs(app: App): Promise<void> {
  await app.scanner.scan();
  const tabs = app.scanner.running().filter((r) => r.sessionId);
  const lines = tabs.map((r) => {
    const assigned = r.sessionId ? app.assignments.accountOf(r.sessionId) : undefined;
    const moving = assigned && assigned !== r.account ? ` (moves to ${assigned} when it next starts)` : '';
    return `• ${r.title ?? 'Untitled'}: ${r.account ?? 'another login'}${moving}${r.viaLauncher || r.tokenAuth ? '' : ' (started without the launcher)'}`;
  });
  await vscode.window.showInformationMessage(
    `New Claude Code tabs in this window start on "${label(app.pick.pick)}".`,
    {
      modal: true,
      detail: tabs.length
        ? `Claude Code tabs open here:\n${lines.join('\n')}`
        : 'No Claude Code tabs are open in this window.',
    },
  );
}
