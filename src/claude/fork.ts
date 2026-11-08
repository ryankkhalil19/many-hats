/**
 * Copying a session is Claude Code's own fork (--resume <transcript> --fork-session), run headless
 * on the account the copy is for. Claude Code writes the copy under a new session ID in the project
 * folder of the folder it runs in. It keeps what belongs to the conversation, drops what belongs to
 * the original session (its Remote Control link, a folder move), and records the account that ran
 * it as the copy's owner. /rename names the copy and is a local command, so no turn is run and
 * nothing is sent to the model. The original is only read.
 *
 * The nightly canary checks, with the latest Claude Code: that the copy is written, carries only its
 * own ID, leaves the Remote Control link and folder move behind, gets its name, runs no turn, keeps
 * hooks off and leaves the original untouched. (The owner stamp needs a signed-in account, so it's
 * checked by hand, not nightly.)
 */
import * as fs from 'node:fs';

/** The longest name passed to /rename, in characters. */
export const MAX_COPY_NAME = 100;

const COPY_SUFFIX = ' (copy)';

/** At most `max` characters, never splitting one (an emoji is one character, two UTF-16 units). */
function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** A copy's name as /rename takes it: one line, trimmed, at most MAX_COPY_NAME characters. */
export function copyName(name: string): string {
  return clip(name.replace(/\s+/g, ' ').trim(), MAX_COPY_NAME).trimEnd();
}

/** The name a copy is offered: the original's, shortened if need be so " (copy)" always fits. */
export function defaultCopyName(title: string): string {
  return `${clip(copyName(title), MAX_COPY_NAME - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;
}

/**
 * Claude Code's arguments for a copy. It resumes the original from its transcript file, so the copy
 * is of exactly that conversation (a session ID can be in more than one project folder), with no
 * lookup. The user's hooks and MCP servers stay off: a background copy shouldn't run their hooks or
 * start their servers.
 */
export function forkArgs(sourceFile: string, copyId: string, name: string): string[] {
  return [
    '-p',
    `/rename ${copyName(name)}`,
    '--resume',
    sourceFile,
    '--fork-session',
    '--session-id',
    copyId,
    '--strict-mcp-config',
    '--settings',
    '{"disableAllHooks":true}',
  ];
}

/** named: whether its end has the name (/rename ran); if not, the caller names it. */
export type CopyCheck = { ok: true; named: boolean } | { ok: false; why: string };

/** How much of each end of the copy is read to check it. */
const EDGE_BYTES = 256 * 1024;

/**
 * Whether Claude Code wrote the copy: the records at both ends carry the copy's ID (none the
 * original's), and whether its end names it. Only the two ends are read, so a big copy is checked
 * quickly.
 */
export function checkCopy(file: string, sourceId: string, copyId: string, name: string): CopyCheck {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return { ok: false, why: 'no copy was written' };
  }
  try {
    const size = fs.fstatSync(fd).size;
    const read = (at: number, length: number): string => {
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, at);
      return buf.subarray(0, n).toString('utf8');
    };
    const head = records(read(0, Math.min(size, EDGE_BYTES)), 'head');
    const tail = size > EDGE_BYTES ? records(read(size - EDGE_BYTES, EDGE_BYTES), 'tail') : head;
    const ids = [...head, ...tail]
      .map((r) => r.sessionId)
      .filter((id): id is string => typeof id === 'string');
    if (!ids.length) return { ok: false, why: 'the copy has no conversation in it' };
    const want = copyId.toLowerCase();
    if (ids.some((id) => id.toLowerCase() === sourceId.toLowerCase()))
      return { ok: false, why: 'the copy still carries the original’s session ID' };
    if (ids.some((id) => id.toLowerCase() !== want))
      return { ok: false, why: 'the copy carries another session’s ID' };
    const clean = copyName(name);
    return { ok: true, named: tail.some((r) => r.type === 'custom-title' && r.customTitle === clean) };
  } finally {
    fs.closeSync(fd);
  }
}

/** The whole JSON records in a slice of a JSONL file; a line cut off by the slice is skipped. */
function records(text: string, edge: 'head' | 'tail'): Record<string, unknown>[] {
  const lines = text.split('\n');
  // A head may stop mid-line and a tail may start mid-line: that part of a line is dropped.
  if (edge === 'head') lines.pop();
  else lines.shift();
  const out: Record<string, unknown>[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      // not a whole record
    }
  }
  return out;
}
