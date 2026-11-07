/**
 * Keeps each account's usage current.
 *
 * Claude Code saves an account's usage (cachedUsageUtilization in its .claude.json) only when
 * something asks for it: its own usage view, or a check near a limit. So an account in daily use
 * can show figures from yesterday. Many Hats asks the way a person would: it runs Claude Code's
 * own /usage for that account, without a prompt, with hooks off and no session saved. Claude Code
 * fetches the figures with that account's login and saves them, and the sidebar reads them as
 * before. Many Hats itself never reads a login or touches the network.
 *
 * - tick(), on a timer while the sidebar shows: refreshes a signed-in account whose figures are
 *   over 15 minutes old, one account at a time.
 * - refresh(account): now, for a click.
 * - A lock file per account, shared by every window, so two windows never refresh the same one.
 * - After a failure, automatic refreshes of that account wait 15 minutes; a click still tries.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cliEnv } from '../claude/cli';
import { usageFromConfig } from '../claude/profile';
import { errnoCode, errorText } from '../core/errors';
import { DEFAULT_ACCOUNT, extraOrUndefined, isAccountName } from '../core/ids';
import type { Runner } from '../infra/exec';
import type { Logger } from '../infra/log';
import type { AccountStore } from '../state/accounts';
import type { Layout } from '../state/layout';

/** Claude Code's own /usage, run without a prompt: no session saved, and the user's hooks off. */
export const USAGE_ARGS = [
  '-p',
  '/usage',
  '--no-session-persistence',
  '--settings',
  '{"disableAllHooks":true}',
] as const;

/** A background run shouldn't update Claude Code or send its analytics. */
const QUIET_ENV = { DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1' };

export interface UsageRefreshDeps {
  layout: Layout;
  store: AccountStore;
  run: Runner;
  claudeBinary: () => string | undefined;
  env: NodeJS.ProcessEnv;
  log: Logger;
  /** Called when an account starts or finishes refreshing, so the sidebar can show it. */
  onChange: () => void;
  now?: () => number;
}

export type RefreshOutcome = 'refreshed' | 'failed' | 'busy' | 'skipped';

export class UsageRefresher {
  /** Figures older than this are refreshed while the sidebar shows. */
  static readonly STALE_MS = 15 * 60_000;
  /** After a failure, automatic refreshes of that account wait this long. */
  static readonly RETRY_MS = 15 * 60_000;
  static readonly TIMEOUT_MS = 90_000;
  /** A lock this old was left by a window that went away mid-refresh. */
  static readonly LOCK_STALE_MS = 3 * 60_000;
  /** Claude Code answers from figures this fresh without asking again (it uses 60 s). */
  private static readonly ANSWERED_FROM_CACHE_MS = 2 * 60_000;

  private readonly active = new Set<string>();
  private readonly failures = new Map<string, { at: number; why: string }>();

  constructor(private readonly deps: UsageRefreshDeps) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  isRefreshing(account: string): boolean {
    return this.active.has(account);
  }

  /** Why the last refresh of an account failed, in a few words; undefined once one succeeds. */
  lastError(account: string): string | undefined {
    return this.failures.get(account)?.why;
  }

  /** When Claude Code last saved the account's figures; undefined: never, or for another login. */
  fetchedAt(account: string): number | undefined {
    const name = extraOrUndefined(account);
    const { store } = this.deps;
    return usageFromConfig(store.readConfig(name), store.profile(name).accountUuid, this.now())?.fetchedAtMs;
  }

  private signedIn(account: string): boolean {
    return Boolean(this.deps.store.profile(extraOrUndefined(account)).email);
  }

  /** Signed-in accounts with stale or no figures, not under way and not waiting after a failure. */
  due(): string[] {
    const now = this.now();
    return [DEFAULT_ACCOUNT, ...this.deps.store.list()].filter((account) => {
      if (this.active.has(account) || !this.signedIn(account)) return false;
      const failed = this.failures.get(account);
      if (failed && now - failed.at < UsageRefresher.RETRY_MS) return false;
      const at = this.fetchedAt(account);
      return at === undefined || now - at >= UsageRefresher.STALE_MS;
    });
  }

  /** For a timer while the sidebar shows: refreshes the first due account, unless one is under way. */
  tick(): void {
    if (this.active.size) return;
    const next = this.due()[0];
    if (next) void this.refresh(next);
  }

  /** Refreshes one account's figures now. Never throws. */
  async refresh(account: string): Promise<RefreshOutcome> {
    if (!isAccountName(account) || !this.signedIn(account)) return 'skipped';
    if (this.active.has(account)) return 'busy';
    let lock: { release(): void } | undefined;
    try {
      lock = this.lock(account);
    } catch (e) {
      return this.failed(account, e);
    }
    if (!lock) return 'busy'; // another window is refreshing it, and every window sees the result
    this.active.add(account);
    this.deps.onChange();
    try {
      const before = this.fetchedAt(account);
      const binary = this.deps.claudeBinary();
      if (!binary) throw new RefreshError('Claude Code’s CLI wasn’t found.');
      const configDir = this.deps.store.configDirOf(extraOrUndefined(account));
      await this.deps.run(binary, USAGE_ARGS, {
        env: { ...cliEnv(this.deps.env, configDir), ...QUIET_ENV },
        cwd: this.deps.layout.root,
        timeoutMs: UsageRefresher.TIMEOUT_MS,
      });
      const after = this.fetchedAt(account);
      const fresh =
        after !== undefined &&
        (after !== before || this.now() - after < UsageRefresher.ANSWERED_FROM_CACHE_MS);
      if (!fresh) throw new RefreshError('Claude Code saved no new figures.');
      this.failures.delete(account);
      this.deps.log.info(`usage of ${account} refreshed`);
      return 'refreshed';
    } catch (e) {
      return this.failed(account, e);
    } finally {
      this.active.delete(account);
      lock.release();
      this.deps.onChange();
    }
  }

  private failed(account: string, e: unknown): RefreshOutcome {
    const why = reason(e);
    this.failures.set(account, { at: this.now(), why });
    this.deps.log.warn(`couldn't refresh the usage of ${account}: ${errorText(e)}`);
    return 'failed';
  }

  /**
   * The right to refresh an account, shared by every window: a file created only if absent.
   * @returns undefined while another window holds it
   */
  private lock(account: string): { release(): void } | undefined {
    const dir = this.deps.layout.locksDir;
    const file = path.join(dir, `usage-${account}`);
    const token = `${process.pid} ${this.now()}\n`;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.writeFileSync(file, token, { flag: 'wx', mode: 0o600 });
        return {
          release: () => {
            try {
              if (fs.readFileSync(file, 'utf8') === token) fs.unlinkSync(file);
            } catch {
              // already gone
            }
          },
        };
      } catch (e) {
        if (errnoCode(e) !== 'EEXIST') throw e;
        let since: number;
        try {
          since = Number(fs.readFileSync(file, 'utf8').trim().split(/\s+/)[1]);
        } catch {
          continue; // gone meanwhile: try again
        }
        if (Number.isFinite(since) && this.now() - since < UsageRefresher.LOCK_STALE_MS) return undefined;
        fs.rmSync(file, { force: true }); // left behind by a window that went away
      }
    }
    return undefined;
  }
}

/** A failure Many Hats itself detected, worded for the sidebar. */
class RefreshError extends Error {}

/** A few words for the sidebar: never a path, a command line or the CLI's output. */
function reason(e: unknown): string {
  if (e instanceof RefreshError) return e.message;
  const err = e as { killed?: boolean; signal?: string; code?: unknown };
  if (err.killed || err.signal === 'SIGTERM') return 'Claude Code took too long.';
  if (err.code === 'ENOENT' || err.code === 'EACCES') return 'Claude Code’s CLI couldn’t be run.';
  if (typeof err.code === 'number') return `Claude Code’s CLI failed (exit code ${err.code}).`;
  return 'Something went wrong; the Many Hats log has the details.';
}
