/**
 * What can be done with a session: open it, start a new one on an account, move it, rename,
 * archive or delete it. These return outcomes; the UI decides what to tell the user.
 */
import type { Archive } from '../state/archive';
import type { Assignments } from '../state/assignments';
import type { AccountStore } from '../state/accounts';
import type { NextTab } from '../state/nextTab';
import type { Compat } from '../claude/compat';
import { isAlive, readLiveSessions, type LiveSession } from '../claude/liveSessions';
import { renameSession, sessionPaths } from '../claude/transcripts';
import { UserError } from '../core/errors';
import { DEFAULT_ACCOUNT, extraOrUndefined } from '../core/ids';
import type { Logger } from '../infra/log';
import type { Platform } from '../platform/types';
import type { Scanner } from './scanner';
import type { PickService } from './pick';

/** Opening Claude Code tabs: Claude Code's own command. */
export interface ClaudeTabs {
  open(sessionId?: string): Promise<void>;
}

/** Moving files to the Trash. */
export interface Trash {
  trash(path: string): Promise<void>;
}

export interface MoveOutcome {
  changed: boolean;
  /** Where it's open: in this window, another window, or not at all. */
  running: 'here' | 'elsewhere' | null;
  /** Already running on that account. */
  runsThere: boolean;
  signedIn: boolean;
}

export type OpenOutcome =
  { kind: 'opened' } | { kind: 'focused' } | { kind: 'elsewhere' } | { kind: 'moved'; move: MoveOutcome };

export interface NewOutcome {
  expected: string;
  /** The account the new tab's process started on, if one was seen starting. */
  startedOn?: string | undefined;
  started: boolean;
}

export interface SessionDeps {
  store: AccountStore;
  assignments: Assignments;
  archive: Archive;
  nextTab: NextTab;
  scanner: Scanner;
  platform: Platform;
  pick: PickService;
  tabs: ClaudeTabs;
  trash: Trash;
  compat: Compat;
  log: Logger;
  hostPid: number;
  wrapperIsOurs: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  newTabTimeoutMs?: number;
  /** Whether a pid is a live process (tests use their own). */
  alive?: (pid: number) => boolean;
}

export class SessionService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: SessionDeps) {}

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  private live(id: string): LiveSession | undefined {
    return readLiveSessions(this.deps.store.defaultDir, this.deps.alive ?? isAlive, this.deps.compat).get(
      id.toLowerCase(),
    );
  }

  private async accountRunningOn(pid: number): Promise<string | undefined> {
    const env = await this.deps.platform.processEnv(pid);
    return env ? this.deps.store.accountOfEnv(env, this.deps.store.accountsByUuid()) : undefined;
  }

  /**
   * A new Claude Code tab on an account, leaving the window's account for new tabs as it is.
   * Requests run one at a time, so two in a row can't swap accounts.
   * @param account undefined or "default": the default account
   */
  newSession(account: string | undefined): Promise<NewOutcome> {
    const run = this.queue.then(() => this.startNew(account));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async startNew(account: string | undefined): Promise<NewOutcome> {
    const { platform, nextTab, tabs, hostPid, pick, store, log } = this.deps;
    const target = extraOrUndefined(account);
    const expected = target ?? DEFAULT_ACCOUNT;
    if (target && !store.exists(target)) throw new UserError(`There is no account "${target}".`);
    if (target === pick.pick) {
      await tabs.open();
      return { expected, started: true, startedOn: expected };
    }
    const before = new Set(await platform.claudeChildren(hostPid).catch(() => [] as number[]));
    // Through the launcher, a one-shot record picks the account for exactly the next tab. With
    // someone else's process wrapper, fall back to pointing new tabs at it until the tab starts.
    const viaLauncher = this.deps.wrapperIsOurs();
    if (viaLauncher) nextTab.arm(hostPid, expected);
    else pick.pointTemporarilyAt(target);
    let started: number | undefined;
    try {
      await tabs.open();
      const deadline = Date.now() + (this.deps.newTabTimeoutMs ?? 20000);
      while (started === undefined && Date.now() < deadline) {
        await this.sleep(250);
        const now = await platform.claudeChildren(hostPid).catch(() => [] as number[]);
        started = now.find((p) => !before.has(p));
      }
    } finally {
      if (viaLauncher) {
        if (nextTab.disarm(hostPid)) log.warn(`no tab claimed the request to open on ${expected}`);
      } else {
        pick.apply();
      }
    }
    if (started === undefined) {
      log.warn(`no Claude process started within the time allowed for a new tab on ${expected}`);
      return { expected, started: false };
    }
    const startedOn = await this.accountRunningOn(started);
    log.info(`new tab (pid ${started}) started on ${startedOn ?? 'a folder that isn’t one of the accounts'}`);
    void this.deps.scanner.scan();
    return { expected, started: true, startedOn };
  }

  /**
   * Open a session in a tab, on its own account unless another is given (which moves it there).
   * A session open in this window is brought forward; one open in another window is left there.
   */
  async openSession(id: string, account?: string): Promise<OpenOutcome> {
    const { store, assignments, tabs, scanner, platform, hostPid, log } = this.deps;
    const live = this.live(id);
    if (live) {
      const here =
        scanner.isHere(live.pid) ||
        (await platform.claudeChildren(hostPid).catch(() => [] as number[])).includes(live.pid);
      if (!here) return { kind: 'elsewhere' };
      const current = await this.accountRunningOn(live.pid);
      if (account && current && account !== current)
        return { kind: 'moved', move: await this.moveSession(id, account) };
      await tabs.open(id);
      return { kind: 'focused' };
    }
    if (account && store.usable(account) && assignments.set(id, account, 'moved')) {
      log.info(`session ${id} now belongs to ${account} (opened there)`);
    }
    await tabs.open(id);
    return { kind: 'opened' };
  }

  /** Put a session on another account from its next start. */
  async moveSession(id: string, account: string): Promise<MoveOutcome> {
    const { store, assignments, scanner, log } = this.deps;
    if (!store.usable(account)) throw new UserError(`There is no account "${account}".`);
    const live = this.live(id);
    const current = live ? await this.accountRunningOn(live.pid) : undefined;
    const changed = assignments.set(id, account, 'moved');
    const running = live ? (scanner.isHere(live.pid) ? 'here' : 'elsewhere') : null;
    const runsThere = Boolean(live && current === account);
    if (changed)
      log.info(
        `session ${id} now belongs to ${account}${live && !runsThere ? ': it moves there when its tab next starts' : ''}`,
      );
    const signedIn = Boolean(store.profile(extraOrUndefined(account)).email);
    return { changed, running, runsThere, signedIn };
  }

  async rename(file: string, id: string, title: string): Promise<string> {
    const saved = await renameSession(file, id, title);
    this.deps.log.info(`renamed session ${id}`);
    return saved;
  }

  setArchived(id: string, archived: boolean): boolean {
    return this.deps.archive.set(id, archived);
  }

  /** Move a closed session's files to the Trash. @returns how many items */
  async deleteSession(id: string, projectFolder: string): Promise<number> {
    const { store, trash, archive, assignments, log } = this.deps;
    if (this.live(id))
      throw new UserError(
        'That session is open. Close its tab (and stop it if it’s working) before deleting it.',
      );
    const paths = sessionPaths(store.defaultDir, projectFolder, id);
    for (const p of paths) await trash.trash(p);
    archive.set(id, false);
    assignments.remove(id);
    log.info(`deleted session ${id}: ${paths.length} item(s) moved to the Trash`);
    return paths.length;
  }
}
