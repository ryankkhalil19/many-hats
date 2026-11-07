/**
 * Housekeeping, once shortly after startup and then daily: forget the records of sessions whose
 * transcripts are gone, and clear what crashed windows or launchers left behind.
 */
import type { Archive } from '../state/archive';
import type { Assignments } from '../state/assignments';
import type { NextTab } from '../state/nextTab';
import type { Picks } from '../state/picks';
import { allSessionIds } from '../claude/transcripts';
import { errorText } from '../core/errors';
import type { Logger } from '../infra/log';

export interface MaintenanceDeps {
  claudeDir: string;
  assignments: Assignments;
  archive: Archive;
  nextTab: NextTab;
  picks: Picks;
  log: Logger;
}

export function housekeeping(deps: MaintenanceDeps): void {
  const { claudeDir, assignments, archive, nextTab, picks, log } = deps;
  try {
    const live = allSessionIds(claudeDir);
    if (live) {
      const dropped = assignments.prune((id) => live.has(id));
      const unarchived = archive.prune((id) => live.has(id));
      if (dropped.length)
        log.info(`forgot the accounts of ${dropped.length} session(s) that no longer exist`);
      if (unarchived) log.info(`forgot ${unarchived} archived session(s) that no longer exist`);
    }
    nextTab.sweep();
    picks.sweep();
  } catch (e) {
    log.warn(`housekeeping failed: ${errorText(e)}`);
  }
}
