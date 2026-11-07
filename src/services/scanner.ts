/**
 * Which of this window's Claude Code tabs runs on which account.
 *
 * Claude Code starts one claude process per tab, as a child of the window's extension host. The
 * scanner lists those processes, reads each one's environment once (it can't change), maps it to
 * an account, and finds its session in Claude Code's live-session records. The first time a
 * session is seen running on one of the accounts, it's assigned there for good.
 *
 * It rescans when Claude Code's session records change, and on a timer as a safety net: every
 * 2 s while the sidebar is visible, every 6 s otherwise.
 */
import * as fs from 'node:fs';
import type { Assignments } from '../state/assignments';
import type { AccountStore } from '../state/accounts';
import type { Compat } from '../claude/compat';
import { readLiveSession } from '../claude/liveSessions';
import { liveSessionsDir } from '../claude/paths';
import { hasTranscript } from '../claude/transcripts';
import { errorText } from '../core/errors';
import type { Logger } from '../infra/log';
import type { Platform, ProcessEnv } from '../platform/types';

export interface RunningTab {
  pid: number;
  /** The account it runs on; undefined: a config folder or login that isn't one of the accounts. */
  account: string | undefined;
  sessionId?: string;
  title?: string;
  viaLauncher: boolean;
  tokenAuth: boolean;
}

export interface ScannerDeps {
  platform: Platform;
  store: AccountStore;
  assignments: Assignments;
  log: Logger;
  compat: Compat;
  /** This window's extension host. */
  hostPid: number;
  /** Whether Claude Code's process wrapper is set to the launcher, so every new tab should come through it. */
  wrapperIsOurs: () => boolean;
}

const INTERACTIVE_MS = 2000;
const BACKGROUND_MS = 6000;

export class Scanner {
  private readonly procs = new Map<number, ProcessEnv>();
  /** Processes that were already running at the first scan: they may predate the launcher. */
  private readonly preexisting = new Set<number>();
  private first = true;
  private current: RunningTab[] = [];
  private lastJson = '';
  private scanning: Promise<void> | undefined;
  private again = false;
  private failures = 0;
  private timer: NodeJS.Timeout | undefined;
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private interactive = false;
  private disposed = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: ScannerDeps) {}

  running(): readonly RunningTab[] {
    return this.current;
  }

  /** Whether a Claude process is one of this window's tabs. */
  isHere(pid: number): boolean {
    return this.procs.has(pid);
  }

  pids(): ReadonlySet<number> {
    return new Set(this.procs.keys());
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    this.watch();
    this.schedule();
    void this.scan();
  }

  setInteractive(on: boolean): void {
    if (this.interactive === on) return;
    this.interactive = on;
    this.schedule();
    if (on) void this.scan();
  }

  /** Scan now; concurrent calls share one scan and queue at most one more. */
  scan(): Promise<void> {
    if (this.scanning) {
      this.again = true;
      return this.scanning;
    }
    this.scanning = this.doScan().finally(() => {
      this.scanning = undefined;
      if (this.again && !this.disposed) {
        this.again = false;
        void this.scan();
      }
    });
    return this.scanning;
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    this.watcher?.close();
    this.listeners.clear();
  }

  private async doScan(): Promise<void> {
    const { platform, store, assignments, log, compat, hostPid } = this.deps;
    try {
      const pids = await platform.claudeChildren(hostPid);
      const alive = new Set(pids);
      for (const pid of [...this.procs.keys()]) {
        if (alive.has(pid)) continue;
        this.procs.delete(pid);
        this.preexisting.delete(pid);
        platform.forgetEnv(pid); // so a reused pid is read again
      }
      for (const pid of pids) {
        if (this.procs.has(pid)) continue;
        const env = await platform.processEnv(pid);
        if (!env) continue;
        this.procs.set(pid, env);
        if (this.first) this.preexisting.add(pid);
      }
      this.first = false;
      const byUuid = store.accountsByUuid();
      let viaLauncher = 0;
      let bypassed = 0;
      const tabs: RunningTab[] = [];
      for (const [pid, env] of this.procs) {
        const account = store.accountOfEnv(env, byUuid);
        // Normally every account's records are ~/.claude's (linked); a folder with its own wins.
        const live =
          (env.configDir && readLiveSession(env.configDir, pid)) || readLiveSession(store.defaultDir, pid);
        const tab: RunningTab = { pid, account, viaLauncher: env.viaLauncher, tokenAuth: env.tokenAuth };
        if (live) {
          tab.sessionId = live.sessionId;
          if (live.name) tab.title = live.name;
        }
        tabs.push(tab);
        if (!this.preexisting.has(pid) && !env.tokenAuth) {
          if (env.viaLauncher) viaLauncher++;
          else bypassed++;
        }
        // A session gets its account once it has been saved, with its first message. A tab opened
        // and never used has nothing to reopen, so it isn't recorded (or counted anywhere).
        const id = tab.sessionId;
        if (
          account &&
          id &&
          store.usable(account) &&
          !compat.isDegraded('liveSessions') &&
          !assignments.get(id) &&
          (hasTranscript(store.defaultDir, id, live?.cwd) ||
            (env.configDir !== undefined && hasTranscript(env.configDir, id, live?.cwd)))
        ) {
          try {
            if (assignments.adopt(id, account)) {
              log.info(
                `session ${tab.sessionId} ("${tab.title ?? 'untitled'}") belongs to ${account}: first seen running there`,
              );
            }
          } catch (e) {
            log.warn(`couldn't record session ${tab.sessionId}'s account: ${errorText(e)}`);
          }
        }
      }
      if (this.deps.wrapperIsOurs()) {
        compat.observe(
          'processWrapper',
          viaLauncher,
          bypassed,
          'Claude Code started tabs without its process wrapper',
        );
      }
      platform.pruneEnvCache(alive);
      tabs.sort((a, b) => a.pid - b.pid);
      this.current = tabs;
      this.failures = 0;
      const json = JSON.stringify(tabs);
      if (json !== this.lastJson) {
        this.lastJson = json;
        this.emit();
      }
    } catch (e) {
      // A single miss happens while the editor is busy starting up; the next scan catches up.
      if (++this.failures >= 2)
        log.warn(
          `couldn't list this window's Claude processes (${this.failures} times in a row): ${errorText(e)}`,
        );
    }
  }

  private schedule(): void {
    if (this.disposed) return;
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.scan(), this.interactive ? INTERACTIVE_MS : BACKGROUND_MS);
    this.timer.unref?.();
  }

  private watch(): void {
    const dir = liveSessionsDir(this.deps.store.defaultDir);
    try {
      this.watcher = fs.watch(dir, { persistent: false }, () => {
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => void this.scan(), 150);
      });
      this.watcher.on('error', () => {
        this.watcher?.close();
        this.watcher = undefined;
      });
    } catch {
      // no session records yet: the timer covers it
    }
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        this.deps.log.error(`scanner listener failed: ${errorText(e)}`);
      }
    }
  }
}
