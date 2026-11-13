/**
 * What can be done with a session: open it, start a new one on an account, move or copy it to an
 * account, rename, archive or delete it. These return outcomes; the UI decides what to tell the user.
 */
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Archive } from '../state/archive';
import type { Assignments } from '../state/assignments';
import type { AccountStore } from '../state/accounts';
import type { NextTab } from '../state/nextTab';
import { cliEnv, QUIET_ENV } from '../claude/cli';
import type { Compat } from '../claude/compat';
import { checkCopy, copyName, forkArgs } from '../claude/fork';
import { isAlive, readLiveSessions, type LiveSession } from '../claude/liveSessions';
import { projectDir } from '../claude/paths';
import { renameSession, sessionPaths } from '../claude/transcripts';
import { errorText, UserError } from '../core/errors';
import { DEFAULT_ACCOUNT, extraOrUndefined } from '../core/ids';
import type { Runner } from '../infra/exec';
import type { Logger } from '../infra/log';
import type { Platform } from '../platform/types';
import type { Scanner } from './scanner';
import type { PickService } from './pick';

/** How long to wait for the new tab's process once another new process (on another account) shows up. */
const NEW_TAB_SETTLE_MS = 2000;

/** Claude Code reads the whole conversation to copy it: a long one on a busy Mac takes a while. */
const COPY_TIMEOUT_MS = 5 * 60_000;

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

export type OpenOutcome = { kind: 'opened' } | { kind: 'focused' } | { kind: 'elsewhere' };

export interface CopyOutcome {
  /** The copy's session ID. */
  id: string;
  /** Its name, as given to Claude Code. */
  name: string;
  /** Whether the account it's on is signed in, so it can be opened now. */
  signedIn: boolean;
}

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
  /** Runs Claude Code's CLI, for copies. */
  run: Runner;
  claudeBinary: () => string | undefined;
  /** The environment the CLI starts from (the login variables are taken out of it). */
  env: NodeJS.ProcessEnv;
  sleep?: (ms: number) => Promise<void>;
  newTabTimeoutMs?: number;
  copyTimeoutMs?: number;
  /** New session IDs (tests use their own). */
  newId?: () => string;
  /** Whether a pid is a live process (tests use their own). */
  alive?: (pid: number) => boolean;
}

export class SessionService {
  private queue: Promise<unknown> = Promise.resolve();
  /** Copies run one at a time: each one has Claude Code read a whole conversation. */
  private copies: Promise<unknown> = Promise.resolve();

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
    let tab: { pid: number; account: string | undefined } | undefined;
    try {
      await tabs.open();
      tab = await this.findNewTab(before, expected);
    } finally {
      if (viaLauncher) {
        if (nextTab.disarm(hostPid)) log.warn(`no tab claimed the request to open on ${expected}`);
      } else {
        pick.apply();
      }
    }
    if (!tab) {
      log.warn(`no Claude process started within the time allowed for a new tab on ${expected}`);
      return { expected, started: false };
    }
    log.info(
      `new tab (pid ${tab.pid}) started on ${tab.account ?? 'a folder that isn’t one of the accounts'}`,
    );
    void this.deps.scanner.scan();
    return { expected, started: true, startedOn: tab.account };
  }

  /**
   * The new tab's process: a Claude process of this window that wasn't there before. Claude Code
   * can start another one at the same moment, so a new process on another account is taken for
   * the tab only once a short wait has shown none on the account asked for.
   */
  private async findNewTab(
    before: ReadonlySet<number>,
    expected: string,
  ): Promise<{ pid: number; account: string | undefined } | undefined> {
    const { platform, hostPid } = this.deps;
    const deadline = Date.now() + (this.deps.newTabTimeoutMs ?? 20000);
    const accounts = new Map<number, string | undefined>();
    const ignored = new Set<number>();
    let first: { pid: number; account: string | undefined } | undefined;
    let settleBy = Number.POSITIVE_INFINITY;
    while (Date.now() < Math.min(deadline, settleBy)) {
      await this.sleep(250);
      const now = await platform.claudeChildren(hostPid).catch(() => [] as number[]);
      for (const pid of now.filter((p) => !before.has(p))) {
        if (ignored.has(pid)) continue;
        if (!accounts.has(pid)) {
          const env = await this.deps.platform.processEnv(pid);
          if (env?.background) {
            ignored.add(pid); // a usage refresh or copy, not the tab
            continue;
          }
          accounts.set(
            pid,
            env ? this.deps.store.accountOfEnv(env, this.deps.store.accountsByUuid()) : undefined,
          );
        }
        const account = accounts.get(pid);
        if (account === expected) return { pid, account };
        if (!first) {
          first = { pid, account };
          settleBy = Date.now() + NEW_TAB_SETTLE_MS;
        }
      }
    }
    return first;
  }

  /**
   * Open a session in a tab, on its own account (the launcher starts it there). A session open in
   * this window is brought forward; one open in another window is left there.
   */
  async openSession(id: string): Promise<OpenOutcome> {
    const { tabs, scanner, platform, hostPid } = this.deps;
    const live = this.live(id);
    if (live) {
      const here =
        scanner.isHere(live.pid) ||
        (await platform.claudeChildren(hostPid).catch(() => [] as number[])).includes(live.pid);
      if (!here) return { kind: 'elsewhere' };
      await tabs.open(id);
      return { kind: 'focused' };
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

  /**
   * Copy a session to an account (its own account too: a duplicate). Claude Code itself makes the
   * copy, with its own fork run on that account (claude/fork.ts): a new session next to the
   * original, under a new ID and the given name, owned by that account. The copy then belongs to
   * that account. The original is only read, so it can stay open, even mid-turn: the copy has what
   * was saved by then. Copies run one at a time.
   * @param folder the folder the session runs in, whose project folder holds its transcript
   */
  copySession(id: string, account: string, name: string, folder: string): Promise<CopyOutcome> {
    const run = this.copies.then(() => this.copy(id, account, name, folder));
    this.copies = run.catch(() => undefined);
    return run;
  }

  private async copy(id: string, account: string, name: string, folder: string): Promise<CopyOutcome> {
    const { store, assignments, claudeBinary, env, log } = this.deps;
    if (!store.usable(account)) throw new UserError(`There is no account "${account}".`);
    const clean = copyName(name);
    if (!clean) throw new UserError('Give the copy a name.');
    const home = projectDir(store.defaultDir, folder);
    const source = path.join(home, `${id}.jsonl`);
    if (!fs.existsSync(source))
      throw new UserError(
        'That session’s conversation isn’t saved in this folder, so there’s nothing to copy.',
      );
    const binary = claudeBinary();
    if (!binary)
      throw new UserError(
        'Claude Code’s CLI wasn’t found, and it’s what makes the copy. Install or update the Claude Code extension, then try again.',
      );
    const copyId = (this.deps.newId ?? randomUUID)();
    const configDir = store.configDirOf(extraOrUndefined(account));
    // Assigned before it exists: while Claude Code makes the copy, its process shows up like a tab
    // of this window, and the scanner would otherwise record the copy as first seen there.
    assignments.set(copyId, account, 'copied');
    try {
      await this.deps.run(binary, forkArgs(source, copyId, clean), {
        env: { ...cliEnv(env, configDir), ...QUIET_ENV },
        cwd: folder,
        timeoutMs: this.deps.copyTimeoutMs ?? COPY_TIMEOUT_MS,
      });
    } catch (e) {
      log.warn(`copying session ${id} to ${account} failed: ${errorText(e)}`);
      await this.discardCopy(copyId, folder, configDir);
      throw new UserError(`Claude Code couldn’t copy the session: ${runFailure(e)}.`);
    }
    try {
      const file = this.placeCopy(copyId, folder, configDir);
      const check = checkCopy(file, id, copyId, clean);
      if (!check.ok)
        throw new UserError(
          `Claude Code didn’t make the copy (${check.why}). Collect Diagnostics and report it, please.`,
        );
      if (!check.named) await renameSession(file, copyId, clean);
    } catch (e) {
      log.warn(`copying session ${id} to ${account} failed after Claude Code ran: ${errorText(e)}`);
      await this.discardCopy(copyId, folder, configDir);
      throw e instanceof UserError ? e : new UserError(`The copy couldn’t be finished: ${errorText(e)}`);
    }
    log.info(`session ${id} copied to ${account} as ${copyId}`);
    return { id: copyId, name: clean, signedIn: Boolean(store.profile(extraOrUndefined(account)).email) };
  }

  /**
   * The project folders Claude Code may have written a copy to, the original's first. It writes to
   * the project folder of the folder it runs in, which it knows by its real path, so a folder
   * opened through a symlink has a second one. So does an account whose shared projects folder
   * isn't linked. Each folder is listed once, however many paths lead to it.
   */
  private copyDirs(folder: string, configDir: string | undefined): string[] {
    const { defaultDir } = this.deps.store;
    let real = folder;
    try {
      real = fs.realpathSync(folder);
    } catch {
      // gone: only the path as given
    }
    const seen = new Set<string>();
    const dirs: string[] = [];
    for (const base of [defaultDir, configDir ?? defaultDir])
      for (const f of [folder, real]) {
        const dir = projectDir(base, f);
        let key = dir;
        try {
          key = fs.realpathSync(dir);
        } catch {
          // not there (yet): known by its path
        }
        if (seen.has(key)) continue;
        seen.add(key);
        dirs.push(dir);
      }
    return dirs;
  }

  /**
   * The copy, next to its original: moved there if Claude Code wrote it to another project folder
   * (copyDirs), so this window lists it and resumes it as it does the original.
   * @returns its transcript, where it is now (it may not exist: checkCopy reports that)
   */
  private placeCopy(copyId: string, folder: string, configDir: string | undefined): string {
    const [home = projectDir(this.deps.store.defaultDir, folder), ...others] = this.copyDirs(
      folder,
      configDir,
    );
    const target = path.join(home, `${copyId}.jsonl`);
    if (fs.existsSync(target)) return target;
    for (const dir of others) {
      const file = path.join(dir, `${copyId}.jsonl`);
      if (!fs.existsSync(file)) continue;
      fs.mkdirSync(home, { recursive: true });
      fs.renameSync(file, target);
      if (fs.existsSync(path.join(dir, copyId)))
        fs.renameSync(path.join(dir, copyId), path.join(home, copyId));
      this.deps.log.info(`moved the copy ${copyId} next to its original, from ${dir}`);
      break;
    }
    return target;
  }

  /**
   * Anything a failed copy left behind goes to the Trash (it has an ID no one else has), and its
   * account is let go.
   */
  private async discardCopy(copyId: string, folder: string, configDir: string | undefined): Promise<void> {
    for (const dir of this.copyDirs(folder, configDir))
      for (const p of [path.join(dir, `${copyId}.jsonl`), path.join(dir, copyId)]) {
        if (!fs.existsSync(p)) continue;
        try {
          await this.deps.trash.trash(p);
        } catch (e) {
          this.deps.log.warn(`couldn't move a failed copy's ${p} to the Trash: ${errorText(e)}`);
        }
      }
    this.deps.assignments.remove(copyId);
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

/** Why a run of the CLI failed, in a line: its own error output, not the command line before it. */
function runFailure(e: unknown): string {
  if (e !== null && typeof e === 'object' && (e as { killed?: unknown }).killed === true)
    return 'it took too long, so it was stopped';
  const lines = errorText(e)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const detail = lines[0]?.startsWith('Command failed:') ? lines.slice(1) : lines;
  return (detail[0] ?? 'it stopped with an error').replace(/[.]$/, '').slice(0, 300);
}
