/**
 * Many Hats: each Claude Code tab in one window can run on a different Claude account, side by side.
 *
 * Composition root: builds the services and wires them to the editor. How it works is in
 * docs/ARCHITECTURE.md; in short:
 *  - Claude Code starts one claude process per tab, with this extension host's environment at
 *    that moment. The account picked for new tabs is CLAUDE_CONFIG_DIR in that environment.
 *  - Every session belongs to one account (~/.many-hats/assignments). Claude Code starts every
 *    process through the launcher (its process-wrapper setting, which Many Hats sets), and the
 *    launcher starts a resumed session on its account from any window.
 *  - The scanner watches this window's Claude processes and records the account of any session
 *    it sees for the first time; the sidebar and status bar show it all.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { Compat } from './claude/compat';
import { findClaudeBinary } from './claude/cli';
import { TranscriptReader } from './claude/transcripts';
import { errorDetails, errorText } from './core/errors';
import { run } from './infra/exec';
import { redactingLogger, type Logger } from './infra/log';
import { platformFor } from './platform';
import { AccountsService } from './services/accounts';
import { ConfigSync } from './services/configSync';
import { checkHealth, repairAll, type HealthCheck } from './services/health';
import { installLauncher } from './services/launcher';
import { housekeeping } from './services/maintenance';
import { PickService } from './services/pick';
import { Scanner } from './services/scanner';
import { SessionService } from './services/sessions';
import { AccountStore } from './state/accounts';
import { Archive } from './state/archive';
import { Assignments } from './state/assignments';
import { ensureLayout, layoutFor } from './state/layout';
import { NextTab } from './state/nextTab';
import { Picks } from './state/picks';
import type { App } from './ui/app';
import { registerCommands } from './ui/commands';
import { claudeExtension, claudeTabs, setWrapper, trash, windowKey, wrapperSetting } from './ui/host';
import { SidebarProvider, VIEW_ID } from './ui/sidebar/provider';
import { createStatusBar } from './ui/statusBar';

/** Read before this extension changes it: the CLAUDE_CONFIG_DIR the editor was started with. */
const INHERITED = process.env.CLAUDE_CONFIG_DIR || undefined;
const HOUSEKEEPING_FIRST_MS = 60_000;
const HOUSEKEEPING_EVERY_MS = 24 * 3600e3;
const REFRESH_MS = 10_000;

/** What activate() returns to integration tests (MANY_HATS_TEST=1); nothing otherwise. */
export interface TestApi {
  app: App;
}

export function activate(context: vscode.ExtensionContext): TestApi | undefined {
  const started = Date.now();
  const channel = vscode.window.createOutputChannel('Many Hats', { log: true });
  context.subscriptions.push(channel);
  const log: Logger = redactingLogger(channel);
  try {
    const app = start(context, log, started);
    return process.env.MANY_HATS_TEST === '1' ? { app } : undefined;
  } catch (e) {
    log.error(`activation failed: ${errorDetails(e)}`);
    void vscode.window.showErrorMessage(`Many Hats couldn’t start: ${errorText(e)}`, 'Show Log').then((c) => {
      if (c) channel.show();
    });
    return undefined;
  }
}

function start(context: vscode.ExtensionContext, log: Logger, started: number): App {
  // MANY_HATS_HOME exists for tests: a sandbox without changing HOME, which the editor itself needs.
  const home = process.env.MANY_HATS_HOME || os.homedir();
  const layout = layoutFor(home);
  ensureLayout(layout);
  const compat = new Compat();
  const store = new AccountStore({ layout, inheritedConfigDir: INHERITED, compat });
  const assignments = new Assignments(layout.assignmentsDir, (n) => store.usable(n));
  const picks = new Picks(layout.picksDir);
  const archive = new Archive(layout.archiveDir);
  const nextTab = new NextTab(layout.nextDir);

  // First, before anything can start Claude in this window: the account new tabs start on.
  const pick = new PickService({
    store,
    picks,
    windowKey: windowKey(),
    memento: context.workspaceState,
    env: process.env,
    terminalEnv: context.environmentVariableCollection,
    log,
  });
  pick.init();

  // The launcher, and Claude Code pointed at it.
  const launcherScript = fs.readFileSync(context.asAbsolutePath('dist/launcher.sh'), 'utf8');
  try {
    if (installLauncher(layout, launcherScript)) log.info(`installed the launcher at ${layout.launcher}`);
  } catch (e) {
    log.error(`couldn't install the launcher: ${errorText(e)}`);
  }
  const wrapperIsOurs = (): boolean => wrapperSetting().global === layout.launcher;
  void ensureWrapper(layout.launcher, log);

  const platform = platformFor(process.platform, run);
  const claudeBinary = (): string | undefined => findClaudeBinary(home, claudeExtension()?.extensionPath);
  const scanner = new Scanner({
    platform,
    store,
    assignments,
    log,
    compat,
    hostPid: process.pid,
    wrapperIsOurs,
  });
  const sync = new ConfigSync(store);
  const accounts = new AccountsService({
    store,
    sync,
    picks,
    assignments,
    platform,
    trash,
    run,
    log,
    claudeBinary,
    env: process.env,
  });
  const sessions = new SessionService({
    store,
    assignments,
    archive,
    nextTab,
    scanner,
    platform,
    pick,
    tabs: claudeTabs,
    trash,
    compat,
    log,
    hostPid: process.pid,
    wrapperIsOurs,
  });
  const transcripts = new TranscriptReader(compat);
  const health = (): HealthCheck[] =>
    checkHealth({
      layout,
      launcherScript,
      platform,
      compat,
      wrapper: wrapperSetting,
      setWrapper: (v) => setWrapper(v),
      claudeExtensionInstalled: () => claudeExtension() !== undefined,
      claudeBinary,
    });

  const views: { sidebar?: SidebarProvider; statusBar?: { render(): void } } = {};
  const version = (context.extension.packageJSON as { version?: unknown }).version;
  const app: App = {
    context,
    version: typeof version === 'string' ? version : '0.0.0',
    log,
    layout,
    store,
    assignments,
    archive,
    nextTab,
    compat,
    platform,
    scanner,
    pick,
    accounts,
    sessions,
    transcripts,
    launcherScript,
    claudeBinary,
    health,
    refresh: () => {
      views.statusBar?.render();
      views.sidebar?.schedule();
    },
    revealSidebar: () => vscode.commands.executeCommand(`${VIEW_ID}.focus`),
  };

  const bar = createStatusBar(app);
  const sidebar = new SidebarProvider(app);
  views.statusBar = bar;
  views.sidebar = sidebar;
  context.subscriptions.push(
    bar,
    sidebar,
    vscode.window.registerWebviewViewProvider(VIEW_ID, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    ...registerCommands(app),
    { dispose: () => scanner.dispose() },
    { dispose: () => accounts.dispose() },
  );

  if (pick.missing) {
    log.warn(`account "${pick.missing}" no longer exists; new tabs start on default`);
    void vscode.window.showWarningMessage(
      `New Claude Code tabs in this window were set to start on "${pick.missing}", which no longer exists, so they start on your default account.`,
    );
  }
  log.info(
    `window ${windowKey() ?? '(no folder)'}: new tabs start on ${pick.pick ?? 'default'}; ${store.list().length} extra account(s); ` +
      `extension host pid ${process.pid}; ready in ${Date.now() - started} ms`,
  );

  // Everything below can wait until the editor has finished starting.
  setImmediate(() => {
    accounts.startWatching();
    scanner.onDidChange(() => app.refresh());
    pick.onDidChange(() => app.refresh());
    compat.onDidChange(() => {
      app.refresh();
      for (const issue of compat.issues())
        log.warn(`Claude Code format check failed (${issue.feature}): ${issue.detail}`);
    });
    scanner.start();
    void repairAll(health().filter((c) => c.id === 'launcher' || c.id === 'permissions')).then(
      (done) => done.forEach((t) => log.info(`repaired at startup: ${t}`)),
      (e: unknown) => log.warn(`startup repair failed: ${errorText(e)}`),
    );
  });
  const keep = (maintenance: () => void, firstMs: number, everyMs: number): void => {
    const first = setTimeout(maintenance, firstMs);
    const every = setInterval(maintenance, everyMs);
    context.subscriptions.push({ dispose: () => (clearTimeout(first), clearInterval(every)) });
  };
  keep(
    () => housekeeping({ claudeDir: store.defaultDir, assignments, archive, nextTab, picks, log }),
    HOUSEKEEPING_FIRST_MS,
    HOUSEKEEPING_EVERY_MS,
  );
  keep(() => app.refresh(), REFRESH_MS, REFRESH_MS);
  // Claude Code installed (or updated) after Many Hats: its setting exists now, so point it at the launcher.
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => {
      if (claudeExtension() && !wrapperIsOurs())
        void ensureWrapper(layout.launcher, log).then(() => app.refresh());
    }),
  );
  return app;
}

/** Point Claude Code's process wrapper at the launcher, unless someone else's is set. */
async function ensureWrapper(launcher: string, log: Logger): Promise<void> {
  const current = wrapperSetting().global;
  if (current === launcher) return;
  if (current) {
    log.warn(
      `claudeCode.claudeProcessWrapper is set to ${current}; leaving it. Resumed tabs start on the account for new tabs.`,
    );
    return;
  }
  if (!claudeExtension()) {
    // Its setting doesn't exist until Claude Code is installed; onDidChange tries again then.
    log.info('Claude Code isn’t installed yet; Many Hats points it at the launcher once it is.');
    return;
  }
  try {
    await setWrapper(launcher);
    log.info(`set claudeCode.claudeProcessWrapper to ${launcher}`);
  } catch (e) {
    log.error(`couldn't set claudeCode.claudeProcessWrapper: ${errorText(e)}`);
  }
}

export function deactivate(): void {
  // Disposables registered in activate() clean up. The launcher and records stay: other windows
  // and Claude Code still use them.
}
