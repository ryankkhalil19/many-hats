/**
 * Crash-safe writes. Several windows and every Claude start read Many Hats' records while others
 * write them, so a record is never edited in place: the new content goes to a temp file in the
 * same folder, is flushed to disk, then renamed over the old one. A reader sees the old file or
 * the new one, never half of either, and a crash leaves at worst a temp file that sweepTempFiles
 * removes later.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureDir } from './fsx';

const TEMP_RE = /^\..+\.[0-9a-f]{8}\.tmp$/;

export interface AtomicWriteOptions {
  /** Mode of the file (default 0o600). */
  mode?: number;
  /** Mode of any folder created on the way (default 0o700). */
  dirMode?: number;
}

export function writeFileAtomic(file: string, data: string | Buffer, options: AtomicWriteOptions = {}): void {
  const dir = path.dirname(file);
  ensureDir(dir, options.dirMode ?? 0o700);
  const tmp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`,
  );
  const fd = fs.openSync(tmp, 'wx', options.mode ?? 0o600);
  try {
    fs.writeSync(fd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
    fs.fsyncSync(fd);
  } catch (e) {
    fs.closeSync(fd);
    removeQuietly(tmp);
    throw e;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    removeQuietly(tmp);
    throw e;
  }
  syncDir(dir);
}

/** Remove temp files a crash left behind in dir, once they're older than maxAgeMs. */
export function sweepTempFiles(dir: string, maxAgeMs = 3600e3, now = Date.now()): number {
  let removed = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!TEMP_RE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs > maxAgeMs) {
        fs.unlinkSync(file);
        removed++;
      }
    } catch {
      // gone meanwhile
    }
  }
  return removed;
}

export function isTempFile(name: string): boolean {
  return TEMP_RE.test(name);
}

function removeQuietly(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // already gone
  }
}

/** Make a rename durable: flush the folder that holds it. Best effort; not every file system allows it. */
function syncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    // not supported here
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
