/**
 * The sidebar webview: every account with its usage windows, and this window's Claude Code
 * sessions grouped by account, with open / new / rename / move / archive / delete. The UI is in
 * src/webview; this side builds its state and carries out what it asks, after checking each
 * message (shared/protocol.ts).
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { App } from '../app';
import { reportError } from '../guard';
import { localFolders } from '../host';
import { USAGE_PAGE } from '../text';
import { removeAccount, addAccount, signIn } from '../commands/accounts';
import { moveSession, newSession, openSession } from '../commands/tabs';
import { buildSidebarState, type KnownSession } from './state';
import { projectDir } from '../../claude/paths';
import { UserError } from '../../core/errors';
import { extraOrUndefined } from '../../core/ids';
import { parseToHost, type ToHost, type ToWebview } from '../../shared/protocol';

export const VIEW_ID = 'manyHats.sidebar';

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private lastJson = '';
  private known = new Map<string, KnownSession>();
  private timer: NodeJS.Timeout | undefined;
  private building = false;
  private again = false;
  private readonly watchers: fs.FSWatcher[] = [];
  private readonly ticker: NodeJS.Timeout;

  constructor(private readonly app: App) {
    // New and changed transcripts in this window's folders. Only folders Claude Code has used
    // exist; the regular refresh notices one created later.
    for (const folder of localFolders()) {
      try {
        const w = fs.watch(projectDir(app.store.defaultDir, folder), { persistent: false }, () =>
          this.schedule(400),
        );
        w.on('error', () => w.close());
        this.watchers.push(w);
      } catch {
        // no transcripts yet
      }
    }
    // Usage caches, running state and relative times move on by themselves. While the sidebar
    // shows, stale usage is refreshed too (one account at a time; see services/usageRefresh.ts).
    this.ticker = setInterval(() => {
      this.schedule(0);
      if (this.view?.visible) this.app.usage.tick();
    }, 5000);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const dist = vscode.Uri.joinPath(this.app.context.extensionUri, 'dist');
    const webview = webviewView.webview;
    webview.options = { enableScripts: true, localResourceRoots: [dist] };
    const nonce = crypto.randomBytes(16).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'sidebar.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${css.toString()}" rel="stylesheet">
<title>Many Hats</title>
</head>
<body>
<div id="app" aria-live="polite"></div>
<script nonce="${nonce}" src="${js.toString()}"></script>
</body>
</html>`;
    this.lastJson = '';
    webview.onDidReceiveMessage((m: unknown) => void this.onMessage(m));
    webviewView.onDidChangeVisibility(() => {
      this.app.scanner.setInteractive(webviewView.visible);
      if (webviewView.visible) {
        void this.push(true);
        this.app.usage.tick();
      }
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
      this.app.scanner.setInteractive(false);
    });
    this.app.scanner.setInteractive(webviewView.visible);
  }

  /** Coalesce bursts of changes into one update. */
  schedule(ms = 250): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), ms);
  }

  dispose(): void {
    clearTimeout(this.timer);
    clearInterval(this.ticker);
    for (const w of this.watchers) w.close();
  }

  /** Rebuild and send the state, if the view is showing and something changed. */
  private async push(force = false): Promise<void> {
    const view = this.view;
    if (!view || (!view.visible && !force)) return;
    if (this.building) {
      this.again = true;
      return;
    }
    this.building = true;
    try {
      const { state, known } = await buildSidebarState(this.app, localFolders(), this.app.health());
      this.known = known;
      const json = JSON.stringify(state);
      if (force || json !== this.lastJson) {
        this.lastJson = json;
        const message: ToWebview = { type: 'state', state };
        await view.webview.postMessage(message);
      }
    } catch (e) {
      this.app.log.error(
        `sidebar: couldn't build its state: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
      );
    } finally {
      this.building = false;
      if (this.again) {
        this.again = false;
        this.schedule();
      }
    }
  }

  private session(id: string): KnownSession {
    const s = this.known.get(id.toLowerCase());
    if (!s) throw new UserError('That session isn’t in this window’s list any more.');
    return s;
  }

  private async onMessage(raw: unknown): Promise<void> {
    const m = parseToHost(raw);
    if (!m) return;
    try {
      if (await this.handle(m)) return;
    } catch (e) {
      reportError(this.app.log, e, `sidebar ${m.type}`);
    }
    await this.push(true);
  }

  /** @returns true when no state update is needed */
  private async handle(m: ToHost): Promise<boolean> {
    const app = this.app;
    switch (m.type) {
      case 'ready':
      case 'refresh':
        await this.push(true);
        return true;
      case 'open':
        await openSession(app, m.id, m.account, this.session(m.id).title);
        return false;
      case 'new':
        await newSession(app, extraOrUndefined(m.account));
        return false;
      case 'rename': {
        const s = this.session(m.id);
        await app.sessions.rename(s.file, m.id, m.title);
        return false;
      }
      case 'archive':
        app.sessions.setArchived(m.id, m.archived);
        return false;
      case 'delete': {
        const s = this.session(m.id);
        if (s.running)
          throw new UserError(
            `"${s.title}" is open. Close its tab (and stop it if it’s working) before deleting it.`,
          );
        const go = await vscode.window.showWarningMessage(
          `Delete "${s.title}"?`,
          {
            modal: true,
            detail:
              'Its conversation, file history and session data go to the Trash, so you can still restore them from there.',
          },
          'Delete',
        );
        if (go !== 'Delete') return true;
        await app.sessions.deleteSession(m.id, s.projectFolder);
        return false;
      }
      case 'move':
        await moveSession(app, m.id, m.account, this.session(m.id).title);
        return false;
      case 'pick':
        await app.pick.set(extraOrUndefined(m.account));
        app.refresh();
        return false;
      case 'signIn':
        signIn(app, extraOrUndefined(m.account));
        return true;
      case 'addAccount':
        await addAccount(app);
        return false;
      case 'removeAccount':
        await removeAccount(app, m.account);
        return false;
      case 'refreshUsage':
        void app.usage.refresh(m.account); // takes a few seconds; it updates the view as it goes
        return false;
      case 'usageDetails':
        await vscode.env.openExternal(vscode.Uri.parse(USAGE_PAGE));
        return true;
      case 'copyId':
        await vscode.env.clipboard.writeText(m.id);
        vscode.window.setStatusBarMessage('Session ID copied', 2000);
        return true;
      case 'notice':
        await vscode.commands.executeCommand(m.command);
        return false;
    }
  }
}
