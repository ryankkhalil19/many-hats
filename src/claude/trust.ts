/**
 * Folder trust in Claude Code's config file (.claude.json): `projects[<folder>].hasTrustDialogAccepted`.
 *
 * Claude Code keeps that config per config folder, so each account has its own list of trusted
 * folders. Its own messages say to fix a missing record by setting the field to true in that
 * file, which is all addTrust does, the way Claude Code writes the file itself:
 *  - under its lock: a `<file>.lock` folder (proper-lockfile), which Claude Code takes before
 *    every save;
 *  - re-reading the file inside the lock, so nothing Claude Code wrote is lost;
 *  - a new project entry gets Claude Code's own defaults, as one it creates would;
 *  - replaced in one rename, keeping the file's mode and formatting.
 * A lock held by Claude Code is never broken: the caller tries again later.
 */
import * as fs from 'node:fs';
import { writeFileAtomic } from '../infra/atomicFile';
import { isRecord, readTextOrUndefined } from '../infra/fsx';

/** Claude Code's defaults for a project entry it creates (its `projects` default, 2.1.323). */
export const PROJECT_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  allowedTools: [],
  mcpContextUris: [],
  mcpServers: {},
  enabledMcpjsonServers: [],
  disabledMcpjsonServers: [],
  hasTrustDialogAccepted: false,
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false,
});

const MAX_BYTES = 32 * 1024 * 1024;

/**
 * The folders a parsed config trusts; undefined when it isn't a config whose projects can be read
 * (then nothing is copied from it or written to it).
 */
export function trustedFolders(config: unknown): Set<string> | undefined {
  if (!isRecord(config)) return undefined;
  const projects = config.projects;
  if (projects === undefined) return new Set();
  if (!isRecord(projects)) return undefined;
  const out = new Set<string>();
  for (const [folder, entry] of Object.entries(projects)) {
    if (isRecord(entry) && entry.hasTrustDialogAccepted === true) out.add(folder);
  }
  return out;
}

/** Reads one config file's trusted folders; undefined: missing, unreadable or not understood. */
export function readTrustedFolders(file: string): Set<string> | undefined {
  const text = readTextOrUndefined(file, MAX_BYTES);
  if (text === undefined) return undefined;
  try {
    return trustedFolders(JSON.parse(text));
  } catch {
    return undefined;
  }
}

export type AddTrustResult =
  | { kind: 'added'; folders: string[] }
  | { kind: 'unchanged' }
  /** Claude Code holds the file's lock: try again later. */
  | { kind: 'busy' }
  /** Missing, unreadable or not understood: left alone. */
  | { kind: 'skipped' };

/** Marks folders trusted in one config file, under Claude Code's lock. */
export function addTrust(file: string, folders: Iterable<string>): AddTrustResult {
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return { kind: 'skipped' };
  }
  const lock = `${real}.lock`;
  try {
    fs.mkdirSync(lock);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return { kind: 'busy' };
    throw e;
  }
  try {
    const text = readTextOrUndefined(real, MAX_BYTES);
    if (text === undefined) return { kind: 'skipped' };
    let config: unknown;
    try {
      config = JSON.parse(text);
    } catch {
      return { kind: 'skipped' };
    }
    if (!isRecord(config) || trustedFolders(config) === undefined) return { kind: 'skipped' };
    const projects: Record<string, unknown> = isRecord(config.projects) ? { ...config.projects } : {};
    const added: string[] = [];
    for (const folder of folders) {
      const entry = projects[folder];
      if (isRecord(entry) && entry.hasTrustDialogAccepted === true) continue;
      projects[folder] = { ...(isRecord(entry) ? entry : PROJECT_DEFAULTS), hasTrustDialogAccepted: true };
      added.push(folder);
    }
    if (!added.length) return { kind: 'unchanged' };
    const out = JSON.stringify({ ...config, projects }, null, 2) + (text.endsWith('\n') ? '\n' : '');
    writeFileAtomic(real, out, { mode: fs.statSync(real).mode & 0o777 });
    return { kind: 'added', folders: added };
  } finally {
    try {
      fs.rmdirSync(lock);
    } catch {
      // Left behind, it goes stale in 10 s and Claude Code takes it over.
    }
  }
}
