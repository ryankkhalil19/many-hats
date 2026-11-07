/**
 * Keeps each extra account's folder a mirror of the default config folder (~/.claude), minus the
 * entries that belong to one login:
 *  - entries of ~/.claude with no link yet get one;
 *  - a shared file a program replaced with its own copy: the newer version wins (the other goes
 *    to ~/.many-hats/backups) and the link comes back;
 *  - a folder (or a known shared file) created in the account folder first moves into ~/.claude
 *    and is linked; any other new file stays with that login;
 *  - our links whose target was deleted from ~/.claude are removed.
 * A real folder present in both places is left alone and reported as "separate".
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AccountStore } from '../state/accounts';
import { isAccountLocal, isAdoptableFile } from '../claude/configFiles';
import { DEFAULT_ACCOUNT } from '../core/ids';
import { UserError } from '../core/errors';
import { ensureDir, lstatOrUndefined, readDirOrEmpty, statOrUndefined } from '../infra/fsx';

export interface SyncReport {
  linked: string[];
  relinked: string[];
  pushed: string[];
  dropped: string[];
  adopted: string[];
  unlinked: string[];
  separate: string[];
}

export function emptyReport(): SyncReport {
  return { linked: [], relinked: [], pushed: [], dropped: [], adopted: [], unlinked: [], separate: [] };
}

export class ConfigSync {
  constructor(
    private readonly store: AccountStore,
    private readonly now: () => number = Date.now,
  ) {}

  sync(name: string): SyncReport {
    if (!this.store.exists(name)) throw new UserError(`"${name}" is not an account folder; not syncing it.`);
    const dir = this.store.dir(name);
    const shared = this.store.defaultDir;
    const report = emptyReport();
    if (!statOrUndefined(shared)?.isDirectory()) ensureDir(shared);

    for (const entry of readDirOrEmpty(shared)) {
      if (isAccountLocal(entry)) continue;
      const local = path.join(dir, entry);
      const target = path.join(shared, entry);
      const st = lstatOrUndefined(local);
      if (!st) {
        fs.symlinkSync(target, local);
        report.linked.push(entry);
      } else if (st.isSymbolicLink()) {
        continue; // linked already (or pointed elsewhere by hand: leave it)
      } else if (st.isFile() && statOrUndefined(target)?.isFile()) {
        report[this.reconcileFile(name, entry)].push(entry);
      } else {
        report.separate.push(entry);
      }
    }

    for (const entry of readDirOrEmpty(dir)) {
      if (isAccountLocal(entry)) continue;
      const local = path.join(dir, entry);
      const target = path.join(shared, entry);
      const st = lstatOrUndefined(local);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        if (!lstatOrUndefined(target) && fs.readlinkSync(local) === target) {
          fs.unlinkSync(local);
          report.unlinked.push(entry);
        }
      } else if (!lstatOrUndefined(target) && (st.isDirectory() || isAdoptableFile(entry))) {
        fs.renameSync(local, target);
        fs.symlinkSync(target, local);
        report.adopted.push(entry);
      }
    }
    return report;
  }

  /** Remove only the links in an account folder, before the folder goes to the Trash. @returns how many */
  unlinkShared(name: string): number {
    const dir = this.store.dir(name);
    let removed = 0;
    for (const entry of readDirOrEmpty(dir)) {
      const p = path.join(dir, entry);
      if (lstatOrUndefined(p)?.isSymbolicLink()) {
        fs.unlinkSync(p);
        removed++;
      }
    }
    return removed;
  }

  /**
   * A shared file in an account folder is a real file instead of a link. Keep the newer content
   * in ~/.claude, back up the other version, and put the link back.
   */
  private reconcileFile(name: string, entry: string): 'relinked' | 'pushed' | 'dropped' {
    const dir = this.store.dir(name);
    const local = path.join(dir, entry);
    const target = path.join(this.store.defaultDir, entry);
    const mine = fs.readFileSync(local);
    let outcome: 'relinked' | 'pushed' | 'dropped' = 'relinked';
    if (!mine.equals(fs.readFileSync(target))) {
      if (fs.statSync(local).mtimeMs > fs.statSync(target).mtimeMs) {
        this.backup(target, `${DEFAULT_ACCOUNT}-${entry}`);
        fs.writeFileSync(target, mine); // in place: keeps its mode, and its own link if it is one
        outcome = 'pushed';
      } else {
        this.backup(local, `${name}-${entry}`);
        outcome = 'dropped';
      }
    }
    const tmp = path.join(dir, `.many-hats-link-${entry}-${process.pid}-${this.now()}`);
    fs.symlinkSync(target, tmp);
    fs.renameSync(tmp, local); // atomic: the path never goes missing
    return outcome;
  }

  private backup(file: string, label: string): void {
    const dir = this.store.layout.backupsDir;
    ensureDir(dir);
    const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(file, path.join(dir, `${label}.${stamp}`));
  }
}

/** One line per non-empty part of a report, for the log. */
export function describeReport(name: string, report: SyncReport, why: string): string[] {
  return Object.entries(report)
    .filter(([, names]) => (names as string[]).length)
    .map(([kind, names]) => `${name}: ${kind} ${(names as string[]).join(', ')} (${why})`);
}
