/**
 * Sessions archived in the sidebar. Claude Code keeps its own archive in storage another
 * extension can't reach, so Many Hats keeps its own: one marker file per archived session.
 *
 *   ~/.many-hats/archive/<session id>    holds the time it was archived
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isSessionId } from '../core/ids';
import { sweepTempFiles, writeFileAtomic } from '../infra/atomicFile';
import { readDirOrEmpty, readTextOrUndefined } from '../infra/fsx';

export class Archive {
  constructor(
    readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {}

  private file(id: string): string {
    return path.join(this.dir, id.toLowerCase());
  }

  /** Archived sessions → when they were archived. */
  list(): Map<string, number> {
    const out = new Map<string, number>();
    for (const name of readDirOrEmpty(this.dir)) {
      if (!isSessionId(name)) continue;
      const at = Date.parse(readTextOrUndefined(path.join(this.dir, name), 128)?.trim() ?? '');
      out.set(name.toLowerCase(), Number.isFinite(at) ? at : 0);
    }
    return out;
  }

  has(id: string): boolean {
    return isSessionId(id) && fs.existsSync(this.file(id));
  }

  /** @returns whether it changed */
  set(id: string, archived: boolean): boolean {
    if (!isSessionId(id)) return false;
    if (archived === this.has(id)) return false;
    if (archived) {
      writeFileAtomic(this.file(id), `${new Date(this.now()).toISOString()}\n`);
      return true;
    }
    try {
      fs.unlinkSync(this.file(id));
      return true;
    } catch {
      return false;
    }
  }

  /** Forget archived sessions that no longer exist, and temp files a crash left. */
  prune(exists: (id: string) => boolean): number {
    sweepTempFiles(this.dir, 3600e3, this.now());
    let n = 0;
    for (const id of this.list().keys()) if (!exists(id) && this.set(id, false)) n++;
    return n;
  }
}
