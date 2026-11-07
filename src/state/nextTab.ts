/**
 * "New session on <account>" without touching the window's account for new tabs.
 *
 * The window writes ~/.many-hats/next/<its extension host pid> holding the account, then opens a
 * Claude Code tab. Claude Code starts that tab's process through the launcher, whose parent is
 * the extension host, so the launcher finds the file by its parent pid. It claims the file by
 * renaming it (atomic: only one process can win it), starts on that account and deletes it. The
 * next tab, or any other window's, isn't affected. A file nobody claims is removed by the window
 * after a timeout, and by housekeeping if the window died.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isAccountName } from '../core/ids';
import { writeFileAtomic } from '../infra/atomicFile';
import { readDirOrEmpty } from '../infra/fsx';

export class NextTab {
  constructor(
    readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  file(hostPid: number): string {
    return path.join(this.dir, String(hostPid));
  }

  arm(hostPid: number, account: string): void {
    if (!isAccountName(account)) throw new Error(`"${account as string}" isn't an account name.`);
    writeFileAtomic(this.file(hostPid), `${account}\n`);
  }

  /** Remove the file if no Claude process claimed it. @returns whether it was still there (unclaimed) */
  disarm(hostPid: number): boolean {
    try {
      fs.unlinkSync(this.file(hostPid));
      return true;
    } catch {
      return false;
    }
  }

  isArmed(hostPid: number): boolean {
    return fs.existsSync(this.file(hostPid));
  }

  /** Remove files and claims older than maxAgeMs: left by a window or launcher that died. */
  sweep(maxAgeMs = 120_000): number {
    let n = 0;
    for (const name of readDirOrEmpty(this.dir)) {
      const file = path.join(this.dir, name);
      try {
        if (this.now() - fs.statSync(file).mtimeMs > maxAgeMs) {
          fs.unlinkSync(file);
          n++;
        }
      } catch {
        // gone meanwhile
      }
    }
    return n;
  }
}
