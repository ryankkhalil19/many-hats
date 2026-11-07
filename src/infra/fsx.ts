/**
 * Small file-system helpers that never throw for "it isn't there": most of what Many Hats reads
 * belongs to Claude Code or to another window and can change or vanish at any moment.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export function lstatOrUndefined(p: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(p);
  } catch {
    return undefined;
  }
}

export function statOrUndefined(p: string): fs.Stats | undefined {
  try {
    return fs.statSync(p);
  } catch {
    return undefined;
  }
}

export function readDirOrEmpty(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** A file's text, or undefined. Reads at most maxBytes (default 4 MiB) so a huge file can't stall a window. */
export function readTextOrUndefined(file: string, maxBytes = 4 * 1024 * 1024): string | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size, maxBytes));
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8', 0, n);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}

/** A JSON file's value, or undefined if it's missing or isn't JSON. */
export function readJsonOrUndefined(file: string, maxBytes?: number): unknown {
  const text = readTextOrUndefined(file, maxBytes);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Whether p is root itself or inside it, after resolving "..". Guards every path built from data. */
export function isWithin(root: string, p: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** mkdir -p with a mode for any folder it creates. */
export function ensureDir(dir: string, mode = 0o700): void {
  fs.mkdirSync(dir, { recursive: true, mode });
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A non-empty string, or undefined. */
export function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
