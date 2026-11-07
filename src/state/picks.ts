/**
 * The account new Claude Code tabs start on, per window: one small file per window key (its
 * .code-workspace file or first folder), named by a hash of the key so any path is a safe file
 * name. One file per window means two windows changing their pick never overwrite each other.
 *
 *   ~/.many-hats/picks/<sha256(key)[0:32]>.json    {"key": "...", "account": "work", "at": "..."}
 *
 * No file: new tabs start on the default account.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_ACCOUNT, isExtraAccountName } from '../core/ids';
import { sweepTempFiles, writeFileAtomic } from '../infra/atomicFile';
import { isRecord, readDirOrEmpty, readJsonOrUndefined } from '../infra/fsx';

export interface PickRecord {
  key: string;
  account: string;
}

export class Picks {
  constructor(
    readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(key: string): string {
    return path.join(this.dir, `${crypto.createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
  }

  private read(file: string): PickRecord | undefined {
    const raw = readJsonOrUndefined(file, 64 * 1024);
    if (!isRecord(raw) || typeof raw.key !== 'string' || !isExtraAccountName(raw.account)) return undefined;
    return { key: raw.key, account: raw.account };
  }

  /** The extra account chosen for a window; undefined: the default. */
  get(key: string): string | undefined {
    const rec = this.read(this.file(key));
    return rec && rec.key === key ? rec.account : undefined;
  }

  /** @param account undefined or "default": the default account (the record is removed) */
  set(key: string, account: string | undefined): void {
    const file = this.file(key);
    if (!account || account === DEFAULT_ACCOUNT) {
      try {
        fs.unlinkSync(file);
      } catch {
        // none
      }
      return;
    }
    if (!isExtraAccountName(account)) throw new Error(`"${account as string}" isn't an account name.`);
    writeFileAtomic(file, `${JSON.stringify({ key, account, at: new Date(this.now()).toISOString() })}\n`);
  }

  list(): PickRecord[] {
    const out: PickRecord[] = [];
    for (const name of readDirOrEmpty(this.dir)) {
      if (!name.endsWith('.json')) continue;
      const rec = this.read(path.join(this.dir, name));
      if (rec) out.push(rec);
    }
    return out;
  }

  /** Every window set to this account goes back to the default. @returns how many */
  forgetAccount(account: string): number {
    let n = 0;
    for (const rec of this.list()) {
      if (rec.account !== account) continue;
      this.set(rec.key, undefined);
      n++;
    }
    return n;
  }

  sweep(): void {
    sweepTempFiles(this.dir, 3600e3, this.now());
  }
}
