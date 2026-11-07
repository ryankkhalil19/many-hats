/**
 * The launcher on disk: ~/.many-hats/bin/launcher. It lives outside the extension's own folder so
 * Claude Code keeps starting if the extension is disabled or updated.
 */
import * as fs from 'node:fs';
import type { Layout } from '../state/layout';
import { writeFileAtomic } from '../infra/atomicFile';
import { readTextOrUndefined, statOrUndefined } from '../infra/fsx';

export type LauncherStatus = 'ok' | 'missing' | 'outdated' | 'not-executable';

export function launcherStatus(layout: Layout, script: string): LauncherStatus {
  const st = statOrUndefined(layout.launcher);
  if (!st?.isFile()) return 'missing';
  if (readTextOrUndefined(layout.launcher, 1024 * 1024) !== script) return 'outdated';
  return (st.mode & 0o111) === 0o111 ? 'ok' : 'not-executable';
}

/** Write the launcher if it differs, and make it executable. @returns whether anything changed */
export function installLauncher(layout: Layout, script: string): boolean {
  const status = launcherStatus(layout, script);
  if (status === 'ok') return false;
  if (status !== 'not-executable') writeFileAtomic(layout.launcher, script, { mode: 0o755 });
  fs.chmodSync(layout.launcher, 0o755);
  return true;
}
