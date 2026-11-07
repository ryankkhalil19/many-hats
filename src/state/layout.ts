/**
 * Where Many Hats keeps its data: ~/.many-hats, private to the user (0700).
 *
 *   accounts/<name>/           CLAUDE_CONFIG_DIR of extra account <name>. Shared entries of
 *                              ~/.claude are linked in; .claude.json holds that login's identity.
 *   assignments/<session id>   the account each session belongs to (state/assignments.ts)
 *   picks/<hash>.json          the account new tabs start on, per window (state/picks.ts)
 *   next/<extension host pid>  a one-shot account for the next tab one window opens (state/nextTab.ts)
 *   archive/<session id>       sessions archived in the sidebar (state/archive.ts)
 *   bin/launcher               Claude Code's process wrapper (src/launcher/launcher.sh)
 *   logs/launcher.log          the launcher's decisions, one line per Claude start
 *   backups/                   file versions a sync had to set aside
 *   VERSION                    the layout's version, for future migrations
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { UserError } from '../core/errors';
import { writeFileAtomic } from '../infra/atomicFile';
import { ensureDir, readTextOrUndefined } from '../infra/fsx';

export const DATA_DIR_NAME = '.many-hats';
export const LAYOUT_VERSION = 1;

export interface Layout {
  home: string;
  root: string;
  accountsDir: string;
  assignmentsDir: string;
  picksDir: string;
  nextDir: string;
  archiveDir: string;
  binDir: string;
  launcher: string;
  logsDir: string;
  launcherLog: string;
  backupsDir: string;
  versionFile: string;
}

export function layoutFor(home: string): Layout {
  const root = path.join(home, DATA_DIR_NAME);
  return {
    home,
    root,
    accountsDir: path.join(root, 'accounts'),
    assignmentsDir: path.join(root, 'assignments'),
    picksDir: path.join(root, 'picks'),
    nextDir: path.join(root, 'next'),
    archiveDir: path.join(root, 'archive'),
    binDir: path.join(root, 'bin'),
    launcher: path.join(root, 'bin', 'launcher'),
    logsDir: path.join(root, 'logs'),
    launcherLog: path.join(root, 'logs', 'launcher.log'),
    backupsDir: path.join(root, 'backups'),
    versionFile: path.join(root, 'VERSION'),
  };
}

export function readLayoutVersion(layout: Layout): number | undefined {
  const text = readTextOrUndefined(layout.versionFile, 64)?.trim();
  if (!text || !/^\d+$/.test(text)) return undefined;
  return Number(text);
}

/**
 * Create the data folder if needed and check its version. A folder written by a newer Many Hats
 * is never touched: an older version can't know what its records mean.
 */
export function ensureLayout(layout: Layout): { created: boolean } {
  const created = !fs.existsSync(layout.root);
  ensureDir(layout.root);
  try {
    fs.chmodSync(layout.root, 0o700);
  } catch {
    // not ours to change; health reports it
  }
  const version = readLayoutVersion(layout);
  if (version !== undefined && version > LAYOUT_VERSION) {
    throw new UserError(
      `${layout.root} was set up by a newer version of Many Hats (data version ${version}). Update Many Hats to use it.`,
    );
  }
  if (version === undefined) writeFileAtomic(layout.versionFile, `${LAYOUT_VERSION}\n`);
  return { created };
}
