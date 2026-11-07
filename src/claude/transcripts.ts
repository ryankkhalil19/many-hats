/**
 * Claude Code's transcripts: <config>/projects/<project key>/<session id>.jsonl, append-only.
 *
 * Claude Code appends the facts the sidebar shows as single short lines: {"type":"custom-title"}
 * (a rename), {"type":"ai-title"} (its automatic title), {"type":"summary"} and
 * {"type":"last-prompt"}. Each file is read once, then only the bytes appended since.
 *
 * Which account a session belongs to is deliberately NOT read from here. A transcript carries a
 * {"type":"session-owner"}, but that's the login the session was first saved under, which Claude
 * Code writes again unchanged on every resume. It says nothing about where the session runs now;
 * Many Hats keeps its own record of that (state/assignments).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Compat } from './compat';
import { UserError } from '../core/errors';
import { isSessionId } from '../core/ids';
import { lstatOrUndefined, readDirOrEmpty } from '../infra/fsx';
import { projectDir } from './paths';

export interface TranscriptFacts {
  customTitle?: string;
  aiTitle?: string;
  summary?: string;
  lastPrompt?: string;
}

export interface SessionInfo {
  id: string;
  file: string;
  title: string;
  renamed: boolean;
  mtimeMs: number;
  size: number;
}

// Claude Code writes these entries as single lines starting {"type":"…". Quotes inside message
// text are escaped (\"type\"), so these can't match what someone typed.
const MARKERS = ['"type":"custom-title"', '"type":"ai-title"', '"type":"last-prompt"', '"type":"summary"'];
const MAX_FACT_LINE = 256 * 1024;
const CHUNK = 1 << 20;
const NEWLINE = 0x0a;
const MAX_TITLE = 120;

interface CacheEntry {
  ino: number;
  size: number;
  facts: TranscriptFacts;
  carry: Buffer;
  firstLineChecked: boolean;
}

/** Reads transcripts incrementally; one instance per window keeps what it has read. */
export class TranscriptReader {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly compat?: Compat) {}

  /**
   * What a transcript says about its session. The first call reads the whole file; later calls
   * read only what was appended. A file that shrank or was replaced is read again from the top.
   * Lines are split on newline bytes, which never occur inside a multi-byte character.
   */
  facts(file: string): TranscriptFacts & { size: number; mtimeMs: number } {
    const st = fs.statSync(file);
    let entry = this.cache.get(file);
    if (!entry || entry.ino !== st.ino || st.size < entry.size) {
      entry = { ino: st.ino, size: 0, facts: {}, carry: Buffer.alloc(0), firstLineChecked: false };
    }
    if (st.size > entry.size) {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.allocUnsafe(CHUNK);
        let pos = entry.size;
        let carry = entry.carry;
        while (pos < st.size) {
          const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, st.size - pos), pos);
          if (n <= 0) break;
          pos += n;
          const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
          const last = data.lastIndexOf(NEWLINE);
          if (last < 0) {
            carry = Buffer.from(data);
            continue;
          }
          const lines = data.toString('utf8', 0, last).split('\n');
          if (!entry.firstLineChecked && lines[0] !== undefined) {
            entry.firstLineChecked = true;
            this.checkFirstLine(lines[0]);
          }
          for (const line of lines) absorb(entry.facts, line);
          carry = Buffer.from(data.subarray(last + 1));
        }
        entry.size = pos;
        entry.carry = carry;
      } finally {
        fs.closeSync(fd);
      }
      this.cache.set(file, entry);
    }
    return { ...entry.facts, size: st.size, mtimeMs: st.mtimeMs };
  }

  /** The sessions in a project folder, newest first. */
  listSessions(dir: string, limit = 200): SessionInfo[] {
    const found: { id: string; file: string; mtimeMs: number }[] = [];
    for (const name of readDirOrEmpty(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      if (!isSessionId(id)) continue;
      const file = path.join(dir, name);
      const st = lstatOrUndefined(file);
      if (st?.isFile()) found.push({ id: id.toLowerCase(), file, mtimeMs: st.mtimeMs });
    }
    found.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const sessions: SessionInfo[] = [];
    for (const { id, file } of found.slice(0, limit)) {
      let facts;
      try {
        facts = this.facts(file);
      } catch {
        continue; // gone meanwhile
      }
      sessions.push({
        id,
        file,
        title: titleOf(facts),
        renamed: Boolean(facts.customTitle),
        mtimeMs: facts.mtimeMs,
        size: facts.size,
      });
    }
    return sessions;
  }

  /** Forget files that no longer exist, so the cache can't grow without bound. */
  prune(keep: Set<string>): void {
    for (const file of this.cache.keys()) if (!keep.has(file)) this.cache.delete(file);
  }

  private checkFirstLine(line: string): void {
    if (!this.compat || !line.trim()) return;
    let ok: boolean;
    try {
      const v = JSON.parse(line) as unknown;
      ok = typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
    } catch {
      ok = false;
    }
    this.compat.observe(
      'transcripts',
      ok ? 1 : 0,
      ok ? 0 : 1,
      'transcript lines are not JSON entries with a type',
    );
  }
}

function absorb(facts: TranscriptFacts, line: string): void {
  if (line.length > MAX_FACT_LINE || !MARKERS.some((m) => line.includes(m))) return;
  let e: unknown;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof e !== 'object' || e === null) return;
  const o = e as Record<string, unknown>;
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  switch (o.type) {
    case 'custom-title':
      facts.customTitle = text(o.customTitle) ?? facts.customTitle;
      break;
    case 'ai-title':
      facts.aiTitle = text(o.aiTitle) ?? facts.aiTitle;
      break;
    case 'summary':
      facts.summary = text(o.summary) ?? facts.summary;
      break;
    case 'last-prompt':
      facts.lastPrompt = text(o.lastPrompt) ?? facts.lastPrompt;
      break;
    default:
  }
}

/** The title Claude Code shows: a rename, else its own title, else the last prompt. */
export function titleOf(f: TranscriptFacts): string {
  const raw = f.customTitle ?? f.aiTitle ?? f.summary ?? f.lastPrompt?.split('\n')[0] ?? '';
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return 'Untitled';
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 3)}…` : t;
}

/**
 * Every session that has a transcript, in any project: for forgetting records of sessions that
 * are gone. undefined: the projects folder couldn't be read, so nothing should be forgotten.
 */
/**
 * Whether a session has been saved. Claude Code writes a session's transcript with its first
 * message, so a tab that was opened and never used has none, and nothing to reopen.
 * @param cwd the folder it runs in, where its transcript normally is (else every project is looked at)
 */
export function hasTranscript(claudeDir: string, sessionId: string, cwd?: string): boolean {
  const file = `${sessionId.toLowerCase()}.jsonl`;
  if (cwd && fs.existsSync(path.join(projectDir(claudeDir, cwd), file))) return true;
  const projects = path.join(claudeDir, 'projects');
  return readDirOrEmpty(projects).some((d) => fs.existsSync(path.join(projects, d, file)));
}

export function allSessionIds(claudeDir: string): Set<string> | undefined {
  const projects = path.join(claudeDir, 'projects');
  let dirs: string[];
  try {
    dirs = fs.readdirSync(projects);
  } catch {
    return undefined;
  }
  const ids = new Set<string>();
  for (const d of dirs) {
    for (const name of readDirOrEmpty(path.join(projects, d))) {
      if (!name.endsWith('.jsonl')) continue;
      const id = name.slice(0, -'.jsonl'.length);
      if (isSessionId(id)) ids.add(id.toLowerCase());
    }
  }
  return ids;
}

/**
 * Rename a session the way Claude Code does: append a custom-title line to its transcript.
 * Waits briefly if the last line is still being written, so two writers' lines never interleave.
 */
export async function renameSession(
  file: string,
  sessionId: string,
  title: string,
  sleep = defaultSleep,
): Promise<string> {
  if (!isSessionId(sessionId)) throw new UserError('That is not a session id.');
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) throw new UserError('A title can’t be empty.');
  if (clean.length > 200) throw new UserError('Keep titles under 200 characters.');
  for (let attempt = 0; ; attempt++) {
    const st = fs.statSync(file);
    if (st.size === 0 || endsWithNewline(file, st.size)) break;
    if (attempt >= 20) throw new UserError('Claude is still writing to this session. Try again in a moment.');
    await sleep(50);
  }
  fs.appendFileSync(file, `${JSON.stringify({ type: 'custom-title', sessionId, customTitle: clean })}\n`);
  return clean;
}

function endsWithNewline(file: string, size: number): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, size - 1);
    return b[0] === NEWLINE;
  } finally {
    fs.closeSync(fd);
  }
}

/** Everything on disk that belongs to one session: what Delete moves to the Trash. */
export function sessionPaths(claudeDir: string, projectFolder: string, sessionId: string): string[] {
  if (!isSessionId(sessionId)) return [];
  const candidates = [
    path.join(projectFolder, `${sessionId}.jsonl`),
    path.join(projectFolder, sessionId),
    path.join(claudeDir, 'file-history', sessionId),
    path.join(claudeDir, 'session-env', sessionId),
    path.join(claudeDir, 'tasks', sessionId),
    path.join(claudeDir, 'debug', `${sessionId}.txt`),
  ];
  for (const name of readDirOrEmpty(path.join(claudeDir, 'todos'))) {
    if (name.startsWith(sessionId)) candidates.push(path.join(claudeDir, 'todos', name));
  }
  return candidates.filter((p) => lstatOrUndefined(p) !== undefined);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
