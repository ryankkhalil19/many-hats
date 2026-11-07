/** The VS Code side of what the services need: Claude Code tabs, the Trash, Claude Code's settings. */
import * as vscode from 'vscode';
import { CLAUDE_EXTENSION_ID, OPEN_CLAUDE_TAB } from './text';
import type { WrapperSetting } from '../services/health';
import type { ClaudeTabs, Trash } from '../services/sessions';
import { UserError, errorText } from '../core/errors';

/** How long to wait for an editor call before carrying on without its answer. */
const EDITOR_CALL_MS = 15_000;

/**
 * Settles with the call's result, or with 'timeout' if it hasn't answered in time. Some editor
 * calls can wait on the user indefinitely (Claude Code's open-tab command waits for sign-in), and
 * Many Hats must never queue behind one forever.
 */
export function withTimeout<T>(call: Thenable<T>, ms = EDITOR_CALL_MS): Promise<T | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    call.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(errorText(e)));
      },
    );
  });
}

export const claudeTabs: ClaudeTabs = {
  async open(sessionId?: string): Promise<void> {
    if (!vscode.extensions.getExtension(CLAUDE_EXTENSION_ID)) {
      throw new UserError('The Claude Code extension isn’t installed. Install it to open Claude Code tabs.');
    }
    try {
      // The tab opens even when the command keeps waiting (on sign-in, say): don't wait for it.
      await withTimeout(vscode.commands.executeCommand(OPEN_CLAUDE_TAB, ...(sessionId ? [sessionId] : [])));
    } catch (e) {
      throw new Error(`Couldn't open a Claude Code tab: ${errorText(e)}`, { cause: e });
    }
  },
};

export const trash: Trash = {
  async trash(p: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(p), { recursive: true, useTrash: true });
  },
};

const WRAPPER_SECTION = 'claudeCode';
const WRAPPER_KEY = 'claudeProcessWrapper';

export function wrapperSetting(): WrapperSetting {
  const inspected = vscode.workspace.getConfiguration(WRAPPER_SECTION).inspect<string>(WRAPPER_KEY);
  const pick = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  return {
    global: pick(inspected?.globalValue),
    workspace: pick(inspected?.workspaceValue),
    workspaceFolder: pick(inspected?.workspaceFolderValue),
  };
}

export async function setWrapper(value: string | undefined): Promise<void> {
  const done = await withTimeout(
    vscode.workspace
      .getConfiguration(WRAPPER_SECTION)
      .update(WRAPPER_KEY, value, vscode.ConfigurationTarget.Global),
  );
  if (done === 'timeout' && wrapperSetting().global !== value) {
    throw new Error('The editor didn’t save claudeCode.claudeProcessWrapper in time.');
  }
}

export function claudeExtension(): vscode.Extension<unknown> | undefined {
  return vscode.extensions.getExtension(CLAUDE_EXTENSION_ID);
}

/** What identifies this window across restarts: its .code-workspace file or first folder. */
export function windowKey(): string | undefined {
  const { workspaceFile, workspaceFolders } = vscode.workspace;
  if (workspaceFile) return workspaceFile.scheme === 'file' ? workspaceFile.fsPath : undefined; // untitled: no stable key
  const first = workspaceFolders?.[0]?.uri;
  if (!first) return undefined;
  return first.scheme === 'file' ? first.fsPath : first.toString();
}

/** This window's local folders. */
export function localFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((f) => f.uri.scheme === 'file')
    .map((f) => f.uri.fsPath);
}
