/**
 * What the sidebar shows: every account with its usage, and this window's Claude Code sessions
 * with the account each belongs to.
 *
 * A session's account:
 *  - open: the account its process actually runs on (from its environment). A session seen
 *    running for the first time is assigned to that account.
 *  - closed: its assignment, the same record the launcher starts it from.
 *  - neither: none yet ("Unassigned"). It starts on the window's account for new tabs and is
 *    assigned there.
 * An open session whose assignment differs (it was moved) shows "→ <account>".
 */
import * as path from 'node:path';
import type { App } from '../app';
import type { HealthCheck } from '../../services/health';
import { isAlive, readLiveSessions } from '../../claude/liveSessions';
import { projectDir } from '../../claude/paths';
import { usageFromConfig } from '../../claude/profile';
import { DEFAULT_ACCOUNT } from '../../core/ids';
import { errorText } from '../../core/errors';
import type { AccountView, Notice, SessionView, SidebarState } from '../../shared/protocol';

export interface KnownSession {
  file: string;
  projectFolder: string;
  title: string;
  running: boolean;
}

export async function buildSidebarState(
  app: App,
  folders: readonly string[],
  health: readonly HealthCheck[],
  now = Date.now(),
): Promise<{ state: SidebarState; known: Map<string, KnownSession> }> {
  const { store, assignments, archive, scanner, platform, compat, transcripts, log } = app;
  const pick = app.pick.pick;
  const names: (string | undefined)[] = [undefined, ...store.list()];
  const uuids = new Map<string, string>();
  const accounts: AccountView[] = names.map((n) => {
    const config = store.readConfig(n);
    const profile = store.profile(n);
    if (profile.accountUuid && !uuids.has(profile.accountUuid))
      uuids.set(profile.accountUuid, n ?? DEFAULT_ACCOUNT);
    const view: AccountView = {
      name: n ?? DEFAULT_ACCOUNT,
      signedIn: Boolean(profile.email),
      isPick: n === pick,
      openHere: 0,
    };
    if (profile.email) view.email = profile.email;
    const expected = store.expectedEmail(n);
    if (expected) view.expectedEmail = expected;
    if (profile.plan) view.plan = profile.plan;
    if (profile.tier) view.tier = profile.tier;
    if (profile.org) view.org = profile.org;
    const usage = usageFromConfig(config, profile.accountUuid, now, compat);
    if (usage) view.usage = usage;
    return view;
  });
  const running = readLiveSessions(store.defaultDir, isAlive, compat);
  const archived = archive.list();
  const known = new Map<string, KnownSession>();
  const sessions: SessionView[] = [];
  const files = new Set<string>();
  for (const folder of folders) {
    const dir = projectDir(store.defaultDir, folder);
    for (const s of transcripts.listSessions(dir)) {
      files.add(s.file);
      const run = running.get(s.id);
      let assigned = assignments.accountOf(s.id);
      let account: string | undefined;
      if (run) {
        const env = await platform.processEnv(run.pid);
        account = env ? store.accountOfEnv(env, uuids) : undefined;
        if (account && !store.usable(account)) account = undefined;
        if (account && !assigned) {
          try {
            if (assignments.adopt(s.id, account))
              log.info(`session ${s.id} ("${s.title}") belongs to ${account}: first seen running there`);
            assigned = account;
          } catch (e) {
            log.warn(`couldn't record session ${s.id}'s account: ${errorText(e)}`);
          }
        }
      } else {
        account = assigned;
      }
      const here = Boolean(run && scanner.isHere(run.pid));
      sessions.push({
        id: s.id,
        title: s.title,
        renamed: s.renamed,
        updatedAt: s.mtimeMs,
        account: account ?? null,
        running: run ? { status: run.status, here } : null,
        movingTo: run && assigned && assigned !== account ? assigned : null,
        archived: archived.has(s.id),
        folder: path.basename(folder),
      });
      known.set(s.id, { file: s.file, projectFolder: dir, title: s.title, running: Boolean(run) });
      if (here && account) {
        const a = accounts.find((x) => x.name === account);
        if (a) a.openHere++;
      }
    }
  }
  transcripts.prune(files);
  const notices: Notice[] = [];
  if (app.pick.missing) {
    notices.push({
      id: 'missing-pick',
      level: 'warning',
      text: `This window was set to "${app.pick.missing}", which no longer exists, so new tabs start on default.`,
    });
  }
  for (const c of health) {
    const n: Notice = { id: c.id, level: c.level === 'error' ? 'error' : 'warning', text: c.title };
    if (c.action) n.action = c.action;
    else if (c.repair) n.action = { label: 'Repair', command: 'manyHats.repair' };
    notices.push(n);
  }
  return {
    state: {
      pick: pick ?? DEFAULT_ACCOUNT,
      folders: folders.map((f) => path.basename(f)),
      accounts,
      sessions,
      notices,
    },
    known,
  };
}
