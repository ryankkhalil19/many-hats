/**
 * Claude Code's registry of running sessions: <config>/sessions/<pid>.json, one file per live
 * Claude process, holding its session id and whether it's working. Files of processes that have
 * exited can linger, so each pid is checked.
 */
import * as path from 'node:path';
import type { Compat } from './compat';
import { liveSessionsDir } from './paths';
import { isSessionId } from '../core/ids';
import { isRecord, readDirOrEmpty, readJsonOrUndefined } from '../infra/fsx';

export interface LiveSession {
  pid: number;
  sessionId: string;
  status: 'busy' | 'idle';
  /** The name Claude Code shows for it, if any. */
  name?: string;
  /** The folder it runs in, where its transcript is saved. */
  cwd?: string;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** One record, if it's readable and its process is alive. */
export function parseLiveSession(pid: number, raw: unknown): LiveSession | undefined {
  if (!isRecord(raw) || !isSessionId(raw.sessionId)) return undefined;
  const s: LiveSession = {
    pid,
    sessionId: raw.sessionId.toLowerCase(),
    status: raw.status === 'busy' ? 'busy' : 'idle',
  };
  if (typeof raw.name === 'string' && raw.name) s.name = raw.name;
  if (typeof raw.cwd === 'string' && path.isAbsolute(raw.cwd)) s.cwd = raw.cwd;
  return s;
}

export function readLiveSession(claudeDir: string, pid: number): LiveSession | undefined {
  return parseLiveSession(
    pid,
    readJsonOrUndefined(path.join(liveSessionsDir(claudeDir), `${pid}.json`), 1024 * 1024),
  );
}

/**
 * Every live session, by session id.
 * @param alive checks a pid (injected by tests)
 */
export function readLiveSessions(
  claudeDir: string,
  alive: (pid: number) => boolean = isAlive,
  compat?: Compat,
): Map<string, LiveSession> {
  const out = new Map<string, LiveSession>();
  let ok = 0;
  let bad = 0;
  for (const name of readDirOrEmpty(liveSessionsDir(claudeDir))) {
    const m = /^(\d+)\.json$/.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!alive(pid)) continue;
    const s = readLiveSession(claudeDir, pid);
    if (s) {
      ok++;
      out.set(s.sessionId, s);
    } else {
      bad++;
    }
  }
  compat?.observe('liveSessions', ok, bad, 'session records have no session id');
  return out;
}
