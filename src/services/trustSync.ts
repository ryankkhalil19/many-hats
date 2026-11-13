/**
 * One answer to "trust this folder?" for every account.
 *
 * Claude Code keeps folder trust per config folder, so with several accounts it splits: the
 * extension asks the account for new tabs whether a folder is trusted, but records the answer on
 * the account the session runs on. A folder trusted on one account then keeps asking on reload.
 * Trust is a decision about the folder, not about a login, so a folder trusted on any account is
 * marked trusted on all of them.
 *
 * Trust only ever spreads: nothing is untrusted here, and a folder no account trusts is never
 * touched. To stop trusting a folder, remove its record from every account's .claude.json.
 *
 * It runs when the window opens (before Claude Code asks), then every minute.
 */
import { DEFAULT_ACCOUNT } from '../core/ids';
import { errorText } from '../core/errors';
import type { Logger } from '../infra/log';
import type { AccountStore } from '../state/accounts';
import { addTrust, readTrustedFolders } from '../claude/trust';

export interface TrustSyncDeps {
  store: AccountStore;
  log: Logger;
  /** How long to wait for a locked file before trying again (tests shorten it). */
  retryMs?: number;
}

export interface TrustReport {
  /** Account → folders newly marked trusted there. */
  added: Map<string, string[]>;
  /** Accounts whose file Claude Code had locked: tried again shortly. */
  busy: string[];
}

const EVERY_MS = 60_000;
const BUSY_RETRY_MS = 2_000;

export class TrustSync {
  private timer: NodeJS.Timeout | undefined;
  private retry: NodeJS.Timeout | undefined;
  private disposed = false;

  constructor(private readonly deps: TrustSyncDeps) {}

  /** Sync now, then every minute. */
  start(): void {
    this.syncAndLog();
    this.timer = setInterval(() => this.syncAndLog(), EVERY_MS);
    this.timer.unref?.();
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.timer);
    clearTimeout(this.retry);
  }

  sync(): TrustReport {
    const { store } = this.deps;
    const report: TrustReport = { added: new Map(), busy: [] };
    const accounts = [DEFAULT_ACCOUNT, ...store.list()];
    const trusted = new Map<string, Set<string>>();
    for (const name of accounts) {
      const folders = readTrustedFolders(store.configFile(name));
      if (folders) trusted.set(name, folders);
    }
    const all = new Set<string>();
    for (const folders of trusted.values()) for (const f of folders) all.add(f);
    for (const [name, folders] of trusted) {
      const missing = [...all].filter((f) => !folders.has(f));
      if (!missing.length) continue;
      const result = addTrust(store.configFile(name), missing);
      if (result.kind === 'added') report.added.set(name, result.folders);
      else if (result.kind === 'busy') report.busy.push(name);
    }
    return report;
  }

  private syncAndLog(): void {
    if (this.disposed) return;
    const { log } = this.deps;
    try {
      const report = this.sync();
      for (const [name, folders] of report.added) {
        log.info(
          `trusted ${folders.length} folder(s) on ${name} that another account trusts: ${folders.join(', ')}`,
        );
      }
      if (report.busy.length && !this.retry) {
        this.retry = setTimeout(() => {
          this.retry = undefined;
          this.syncAndLog();
        }, this.deps.retryMs ?? BUSY_RETRY_MS);
        this.retry.unref?.();
      }
    } catch (e) {
      log.warn(`couldn't share folder trust between accounts: ${errorText(e)}`);
    }
  }
}
