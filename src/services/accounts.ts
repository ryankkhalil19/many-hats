/**
 * Adding, signing in, signing out and removing accounts, and keeping every account folder linked
 * to ~/.claude while the window is open.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describeReport, type ConfigSync, type SyncReport } from './configSync';
import type { Trash } from './sessions';
import type { AccountStore } from '../state/accounts';
import type { Assignments } from '../state/assignments';
import type { Picks } from '../state/picks';
import { cliEnv, cliEnvArgs, QUIET_ENV } from '../claude/cli';
import { allSessionIds } from '../claude/transcripts';
import { isAccountLocal } from '../claude/configFiles';
import { UserError, errorText } from '../core/errors';
import { DEFAULT_ACCOUNT, extraOrUndefined } from '../core/ids';
import type { Runner } from '../infra/exec';
import type { Logger } from '../infra/log';
import type { Platform } from '../platform/types';

export interface AccountsDeps {
  store: AccountStore;
  sync: ConfigSync;
  picks: Picks;
  assignments: Assignments;
  platform: Platform;
  trash: Trash;
  run: Runner;
  log: Logger;
  /** The Claude CLI, found fresh each time (the Claude Code extension may update meanwhile). */
  claudeBinary: () => string | undefined;
  env: NodeJS.ProcessEnv;
}

export interface SignInTerminal {
  name: string;
  shellPath: string;
  shellArgs: string[];
  email: string | undefined;
}

export class AccountsService {
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: AccountsDeps) {}

  /** Create an account folder, link it to ~/.claude, and remember the email it should sign in as. */
  create(name: string, email?: string): { dir: string; seededKeys: number; report: SyncReport } {
    const { store, sync, log } = this.deps;
    const made = store.createFolder(name);
    if (email?.trim()) store.setExpectedEmail(name, email.trim());
    const report = sync.sync(name);
    log.info(
      `created account ${name}: ${report.linked.length} shared entries linked, ${made.seededKeys} app settings carried over`,
    );
    this.watch(name);
    return { ...made, report };
  }

  /**
   * A terminal command that signs one account in with `claude auth login`, asking the browser for
   * the account's email when known, so it can't quietly reuse whoever is signed in to claude.ai there.
   * @param name undefined or "default": the default account
   */
  signInTerminal(name: string | undefined): SignInTerminal {
    const { store, claudeBinary } = this.deps;
    const extra = extraOrUndefined(name);
    const binary = claudeBinary();
    if (!binary)
      throw new UserError(
        'Couldn’t find the Claude Code CLI to sign in with. Install or update the Claude Code extension.',
      );
    const email = store.expectedEmail(extra) ?? store.profile(extra).email;
    const args = ['auth', 'login', ...(email ? ['--email', email] : [])];
    return {
      name: extra ?? DEFAULT_ACCOUNT,
      shellPath: '/usr/bin/env',
      shellArgs: cliEnvArgs(binary, store.configDirOf(extra), args),
      email,
    };
  }

  /** Sign an extra account out, then make sure its stored login is gone. */
  async signOut(name: string): Promise<void> {
    const { store, run, platform, log, claudeBinary, env } = this.deps;
    const dir = store.dir(name);
    const binary = claudeBinary();
    if (binary) {
      try {
        await run(binary, ['auth', 'logout'], {
          env: { ...cliEnv(env, dir), ...QUIET_ENV },
          timeoutMs: 30000,
        });
      } catch (e) {
        log.warn(`claude auth logout for ${name} failed: ${errorText(e)}`);
      }
    }
    await platform.deleteStoredLogin(dir);
  }

  /** How many Claude processes, in any window, run on an account right now. */
  usersOf(name: string): Promise<number> {
    return this.deps.platform.processesUsing(this.deps.store.dir(name)).catch(() => 0);
  }

  /**
   * Remove an extra account: sign it out, move its folder to the Trash (only its own files: the
   * links to ~/.claude are removed first), and forget it everywhere.
   */
  /**
   * What removing an account undoes: the saved conversations that belong to it (a record for a
   * tab that was never used doesn't count), and the windows whose new tabs start on it.
   */
  removalImpact(name: string): { conversations: number; windows: number } {
    const { store, assignments, picks } = this.deps;
    const saved = allSessionIds(store.defaultDir); // undefined: unreadable, so count every record
    let conversations = 0;
    for (const [id, a] of assignments.list())
      if (a.account === name && (!saved || saved.has(id))) conversations++;
    return { conversations, windows: picks.list().filter((p) => p.account === name).length };
  }

  async remove(name: string): Promise<{ conversations: number; windowsReset: number }> {
    const { store, sync, trash, picks, assignments, log } = this.deps;
    if (!store.exists(name)) throw new UserError(`There is no account "${name}".`);
    const { conversations } = this.removalImpact(name);
    this.unwatch(name);
    await this.signOut(name);
    sync.unlinkShared(name);
    await trash.trash(store.dir(name));
    const windowsReset = picks.forgetAccount(name);
    assignments.removeAccount(name);
    log.info(
      `removed account ${name}; ${conversations} conversation(s) no longer belong to it, ${windowsReset} window(s) went back to default`,
    );
    return { conversations, windowsReset };
  }

  /** Link every account folder to ~/.claude now, and whenever something changes in one. */
  startWatching(): void {
    for (const name of this.deps.store.list()) this.watch(name);
    for (const name of [...this.watchers.keys()]) if (!this.deps.store.exists(name)) this.unwatch(name);
  }

  syncNow(name: string, why: string): void {
    const { sync, log } = this.deps;
    try {
      for (const line of describeReport(name, sync.sync(name), why)) log.info(line);
    } catch (e) {
      log.error(`${name}: linking to the shared config failed (${why}): ${errorText(e)}`);
    }
  }

  dispose(): void {
    for (const name of [...this.watchers.keys()]) this.unwatch(name);
  }

  private watch(name: string): void {
    if (this.watchers.has(name)) return;
    this.syncNow(name, 'window opened');
    try {
      const watcher = fs.watch(this.deps.store.dir(name), { persistent: false }, (_event, file) => {
        if (file && isAccountLocal(path.basename(String(file)))) return; // e.g. Claude rewriting .claude.json
        clearTimeout(this.timers.get(name));
        this.timers.set(
          name,
          setTimeout(() => {
            if (this.deps.store.exists(name)) this.syncNow(name, 'folder changed');
          }, 300),
        );
      });
      watcher.on('error', () => this.unwatch(name));
      this.watchers.set(name, watcher);
    } catch (e) {
      this.deps.log.warn(`can't watch the ${name} account folder: ${errorText(e)}`);
    }
  }

  private unwatch(name: string): void {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
    this.watchers.get(name)?.close();
    this.watchers.delete(name);
  }
}
