/**
 * Which account each Claude Code session belongs to: the one record the launcher, the sidebar and
 * every window go by. A session starts on its account whenever it starts through the launcher,
 * and the sidebar lists it there whether it's open or closed.
 *
 *   ~/.many-hats/assignments/<session id>    one line: "<account> <source> <ISO time>"
 *
 * - source: how it got there. "observed": first seen running there. "moved": Move, or Open on
 *   another account.
 * - A session gets its account the first time it's seen running and keeps it until it's moved.
 *   Seeing it run somewhere else (a terminal, another app) never changes it, so the record can't
 *   flip back and forth.
 *
 * One file per session: every Claude launch reads it and several windows write it at once.
 * Replacing one small file by rename is atomic, so there's no shared file to lock or merge, no
 * reader ever sees half a record, and the launcher reads it with plain sh.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UserError } from '../core/errors';
import { isAccountName, isSessionId } from '../core/ids';
import { sweepTempFiles, writeFileAtomic } from '../infra/atomicFile';
import { readDirOrEmpty } from '../infra/fsx';

export type AssignmentSource = 'observed' | 'moved';

export interface Assignment {
  account: string;
  source: AssignmentSource | 'unknown';
  at: number | undefined;
}

const SOURCES = new Set<string>(['observed', 'moved']);

export function parseAssignment(text: string): Assignment | undefined {
  const [account, source, at] = (text.split('\n', 1)[0] ?? '').trim().split(/\s+/);
  if (!isAccountName(account)) return undefined;
  const t = Date.parse(at ?? '');
  return {
    account,
    source: source && SOURCES.has(source) ? (source as AssignmentSource) : 'unknown',
    at: Number.isFinite(t) ? t : undefined,
  };
}

export class Assignments {
  /** Each file parsed once while it stays the same file. */
  private readonly memo = new Map<string, { key: string; value: Assignment | undefined }>();

  /**
   * @param usable whether an account can run sessions now: "default", or an extra account that exists
   */
  constructor(
    readonly dir: string,
    private readonly usable: (account: string) => boolean,
    private readonly now: () => number = Date.now,
  ) {}

  private file(id: string): string {
    return path.join(this.dir, id.toLowerCase());
  }

  /** A session's assignment as recorded, even if its account has since been removed. */
  get(id: string): Assignment | undefined {
    if (!isSessionId(id)) return undefined;
    const key = id.toLowerCase();
    let st: fs.Stats;
    try {
      st = fs.statSync(this.file(key));
    } catch {
      this.memo.delete(key);
      return undefined;
    }
    if (!st.isFile()) return undefined;
    // Every write is a new file (rename), so a new inode means new content.
    const stamp = `${st.ino}:${st.size}:${st.mtimeMs}`;
    const hit = this.memo.get(key);
    if (hit && hit.key === stamp) return hit.value;
    let text: string;
    try {
      text = fs.readFileSync(this.file(key), 'utf8');
    } catch {
      return undefined;
    }
    const value = parseAssignment(text);
    this.memo.set(key, { key: stamp, value });
    return value;
  }

  /** The account a session runs on, if it has one that can run sessions now. */
  accountOf(id: string): string | undefined {
    const a = this.get(id);
    return a && this.usable(a.account) ? a.account : undefined;
  }

  /**
   * Put a session on an account.
   * @returns whether it changed (false: it was already there)
   */
  set(id: string, account: string, source: AssignmentSource): boolean {
    if (!isSessionId(id)) throw new UserError(`"${id as string}" is not a session id.`);
    if (!isAccountName(account) || !this.usable(account))
      throw new UserError(`There is no account "${account}".`);
    if (!SOURCES.has(source)) throw new Error(`Unknown assignment source "${source}".`);
    if (this.get(id)?.account === account) return false;
    writeFileAtomic(this.file(id), `${account} ${source} ${new Date(this.now()).toISOString()}\n`);
    this.memo.delete(id.toLowerCase());
    return true;
  }

  /**
   * Record the account a session was seen running on, if it doesn't belong anywhere yet (or its
   * account is gone). An existing assignment always wins: that keeps the record from flipping.
   * @returns whether it was recorded
   */
  adopt(id: string, account: string): boolean {
    if (!isSessionId(id) || this.accountOf(id) || !isAccountName(account) || !this.usable(account))
      return false;
    return this.set(id, account, 'observed');
  }

  /** @returns whether there was one */
  remove(id: string): boolean {
    if (!isSessionId(id)) return false;
    this.memo.delete(id.toLowerCase());
    try {
      fs.unlinkSync(this.file(id));
      return true;
    } catch {
      return false;
    }
  }

  /** Every assignment, by session id. */
  list(): Map<string, Assignment> {
    const out = new Map<string, Assignment>();
    for (const name of readDirOrEmpty(this.dir)) {
      if (!isSessionId(name)) continue;
      const a = this.get(name);
      if (a) out.set(name, a);
    }
    return out;
  }

  /** Forget the sessions of an account being removed. @returns how many */
  removeAccount(account: string): number {
    let n = 0;
    for (const [id, a] of this.list()) if (a.account === account && this.remove(id)) n++;
    return n;
  }

  /**
   * Housekeeping: drop the assignments of sessions that no longer exist, once they're old enough
   * (a new session has no transcript until its first message), and temp files a crash left.
   * @returns the sessions dropped
   */
  prune(exists: (id: string) => boolean, minAgeMs = 7 * 24 * 3600e3): string[] {
    const now = this.now();
    sweepTempFiles(this.dir, 3600e3, now);
    const dropped: string[] = [];
    for (const name of readDirOrEmpty(this.dir)) {
      if (!isSessionId(name)) continue;
      let mtimeMs: number;
      try {
        mtimeMs = fs.statSync(path.join(this.dir, name)).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtimeMs > minAgeMs && !exists(name) && this.remove(name)) dropped.push(name);
    }
    return dropped;
  }
}
