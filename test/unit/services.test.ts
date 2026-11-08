import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { Compat } from '../../src/claude/compat';
import { cliEnv, cliEnvArgs, findClaudeBinary, LOGIN_OVERRIDE_VARS } from '../../src/claude/cli';
import { folderOfSession, projectDir } from '../../src/claude/paths';
import { TranscriptReader } from '../../src/claude/transcripts';
import { AccountsService } from '../../src/services/accounts';
import { NO_FOLDER_KEY, PickService, type TerminalEnv } from '../../src/services/pick';
import { Scanner } from '../../src/services/scanner';
import { SessionService } from '../../src/services/sessions';
import { UsageRefresher } from '../../src/services/usageRefresh';
import { Archive } from '../../src/state/archive';
import { Assignments } from '../../src/state/assignments';
import { NextTab } from '../../src/state/nextTab';
import { Picks } from '../../src/state/picks';
import { buildSidebarState } from '../../src/ui/sidebar/state';
import type { App } from '../../src/ui/app';
import { A, B, C, fakeHome, line, memoryLogger, tempDir } from '../helpers/home';
import { FakePlatform, FakeTabs, FakeTrash, noSleep } from '../helpers/fakes';

function memento() {
  const m = new Map<string, unknown>();
  return {
    get: (k: string) => m.get(k),
    update: (k: string, v: unknown) => (m.set(k, v), Promise.resolve()),
  };
}
function terminalEnv(): TerminalEnv & { vars: Map<string, string> } {
  const vars = new Map<string, string>();
  return {
    vars,
    persistent: false,
    description: undefined,
    replace: (k, v) => void vars.set(k, v),
    clear: () => vars.clear(),
  };
}

/** Everything wired as extension.ts does, against a fake home, platform and editor. */
function world(options: { wrapperIsOurs?: boolean; noCli?: boolean } = {}) {
  const h = fakeHome();
  h.addAccount('work', 'me@work.example');
  const log = memoryLogger();
  const compat = new Compat();
  const platform = new FakePlatform();
  const assignments = new Assignments(h.layout.assignmentsDir, (n) => h.store.usable(n));
  const picks = new Picks(h.layout.picksDir);
  const archive = new Archive(h.layout.archiveDir);
  const nextTab = new NextTab(h.layout.nextDir);
  const env: NodeJS.ProcessEnv = {};
  const term = terminalEnv();
  const pick = new PickService({
    store: h.store,
    picks,
    windowKey: '/code/app',
    memento: memento(),
    env,
    terminalEnv: term,
    log,
  });
  pick.init();
  const hostPid = 500;
  const wrapperIsOurs = (): boolean => options.wrapperIsOurs ?? true;
  const scanner = new Scanner({ platform, store: h.store, assignments, log, compat, hostPid, wrapperIsOurs });
  const tabs = new FakeTabs();
  const trash = new FakeTrash(path.join(h.home, '.Trash'));
  const alive = new Set<number>([process.pid]);
  /** Runs of Claude Code for copies, and what the fake one does: fork as Claude Code does. */
  const copyRuns: { file: string; args: readonly string[]; env?: NodeJS.ProcessEnv; cwd?: string }[] = [];
  const copies = { fork: fakeFork(h.claude), ids: [COPY, COPY2] };
  const sessions = new SessionService({
    store: h.store,
    assignments,
    archive,
    nextTab,
    scanner,
    platform,
    pick,
    tabs,
    trash,
    compat,
    log,
    hostPid,
    wrapperIsOurs,
    run: (file, args, o) => {
      copyRuns.push({ file, args, env: o?.env, cwd: o?.cwd });
      return copies.fork(args, o?.cwd ?? '');
    },
    claudeBinary: () => (options.noCli ? undefined : '/x/claude'),
    env: { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'leaked' },
    newId: () => copies.ids.shift() ?? COPY,
    sleep: noSleep,
    newTabTimeoutMs: 200,
    alive: (pid) => alive.has(pid),
  });
  const runs: { file: string; args: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
  const accounts = new AccountsService({
    store: h.store,
    sync: h.sync,
    picks,
    assignments,
    platform,
    trash,
    run: (file, args, o) => (runs.push({ file, args, env: o?.env }), Promise.resolve('')),
    log,
    claudeBinary: () => '/x/claude',
    env: { PATH: '/bin', CLAUDE_CODE_OAUTH_TOKEN: 'leaked' },
  });
  /** A live Claude process for a session, as Claude Code records it. */
  const live = (pid: number, sessionId: string, configDir?: string, status = 'idle') => {
    alive.add(pid);
    platform.env(pid, { configDir });
    fs.writeFileSync(
      path.join(h.claude, 'sessions', `${pid}.json`),
      JSON.stringify({ pid, sessionId, status, cwd: '/code/app' }),
    );
  };
  /** A session's first message: Claude Code saves its transcript then. */
  const talk = (sessionId: string, cwd = '/code/app') => {
    const dir = projectDir(h.claude, cwd);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${sessionId}.jsonl`),
      `${JSON.stringify({ type: 'user', sessionId })}\n`,
    );
  };
  return {
    ...h,
    log,
    compat,
    platform,
    assignments,
    picks,
    archive,
    nextTab,
    env,
    term,
    pick,
    scanner,
    tabs,
    trash,
    sessions,
    accounts,
    runs,
    copyRuns,
    copies,
    live,
    talk,
    hostPid,
  };
}

const COPY = '44444444-4444-4444-8444-444444444444';
const COPY2 = '55555555-5555-4555-8555-555555555555';
const COPY3 = '66666666-6666-4666-8666-666666666666';

/**
 * What Claude Code's fork does with Many Hats' arguments (checked against the real one by the
 * canary): the conversation under the new session ID, the original's Remote Control link left
 * behind, and /rename's title at the end.
 */
function fakeFork(claudeDir: string) {
  return (args: readonly string[], cwd: string): Promise<string> => {
    const arg = (flag: string): string => args[args.indexOf(flag) + 1] ?? '';
    const source = fs.readFileSync(arg('--resume'), 'utf8'); // the original's transcript file
    const copy = arg('--session-id');
    const name = arg('-p').replace(/^\/rename /, '');
    const lines = source
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((r) => r.type !== 'bridge-session' && r.type !== 'relocated')
      .map((r) => JSON.stringify({ ...r, sessionId: copy }));
    lines.push(JSON.stringify({ type: 'custom-title', customTitle: name, sessionId: copy }));
    // Claude Code writes into the project folder of the folder it runs in, by its real path.
    let real = cwd;
    try {
      real = fs.realpathSync(cwd);
    } catch {
      // a made-up folder: its path as given
    }
    const dir = projectDir(claudeDir, real);
    fs.mkdirSync(path.join(dir, copy), { recursive: true }); // its per-session folder
    fs.writeFileSync(path.join(dir, `${copy}.jsonl`), `${lines.join('\n')}\n`);
    return Promise.resolve(`Session renamed to: ${name}\n`);
  };
}

test('pick: new tabs and terminals follow the window’s account; saved per window', async () => {
  const w = world();
  assert.equal(w.pick.pick, undefined);
  assert.equal(w.env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(w.env.MANY_HATS_DEFAULT_DIR, '');
  await w.pick.set('work');
  assert.equal(w.env.CLAUDE_CONFIG_DIR, w.store.dir('work'));
  assert.equal(w.term.vars.get('CLAUDE_CONFIG_DIR'), w.store.dir('work'));
  assert.equal(w.picks.get('/code/app'), 'work');
  w.pick.pointTemporarilyAt(undefined);
  assert.equal(w.env.CLAUDE_CONFIG_DIR, undefined);
  w.pick.apply();
  assert.equal(w.env.CLAUDE_CONFIG_DIR, w.store.dir('work'), 'apply puts it back');
  await w.pick.set('default');
  assert.equal(w.env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(w.term.vars.size, 0);
  await assert.rejects(w.pick.set('nope'), /no account/);
});

test('pick: a saved account that was removed starts new tabs on default and says so; no-folder windows use their own storage', async () => {
  const w = world();
  w.picks.set('/code/app', 'gone');
  const pick = new PickService({
    store: w.store,
    picks: w.picks,
    windowKey: '/code/app',
    memento: memento(),
    env: {},
    log: w.log,
  });
  pick.init();
  assert.equal(pick.pick, undefined);
  assert.equal(pick.missing, 'gone');
  const m = memento();
  const noFolder = new PickService({
    store: w.store,
    picks: w.picks,
    windowKey: undefined,
    memento: m,
    env: {},
    log: w.log,
  });
  noFolder.init();
  await noFolder.set('work');
  assert.equal(m.get(NO_FOLDER_KEY), 'work');
  let changed = 0;
  noFolder.onDidChange(() => changed++);
  await noFolder.set(undefined);
  assert.equal(changed, 1);
});

test('scanner: tabs mapped to accounts; a session is adopted where it is first seen and never flips', async () => {
  const w = world();
  w.platform.children = [101, 102];
  w.live(101, A, w.store.dir('work'));
  w.live(102, B, undefined, 'busy');
  let changes = 0;
  w.scanner.onDidChange(() => changes++);
  await w.scanner.scan();
  assert.equal(w.assignments.get(A), undefined, 'a tab that was never used has nothing to reopen');
  assert.equal(w.assignments.get(B), undefined);
  w.talk(A);
  w.talk(B, '/somewhere/else'); // found even outside the folder its tab reports
  await w.scanner.scan();
  assert.deepEqual(
    w.scanner.running().map((r) => [r.pid, r.account, r.sessionId]),
    [
      [101, 'work', A],
      [102, 'default', B],
    ],
  );
  assert.equal(w.assignments.accountOf(A), 'work');
  assert.equal(w.assignments.accountOf(B), 'default');
  assert.match(w.log.lines.join('\n'), /belongs to work: first seen running there/);
  assert.equal(changes, 1);
  assert.ok(w.scanner.isHere(101));
  // Seen running elsewhere later: the record stays.
  w.platform.children = [103];
  w.live(103, A, undefined);
  await w.scanner.scan();
  assert.equal(w.assignments.accountOf(A), 'work');
  assert.equal(w.scanner.isHere(101), false, 'exited');
  assert.equal(w.scanner.pids().size, 1);
});

test('scanner: tabs that skip the launcher pause routing with a notice; ones running before Many Hats don’t count', async () => {
  const w = world();
  w.platform.children = [201];
  w.platform.env(201, { viaLauncher: false });
  for (let i = 0; i < 4; i++) await w.scanner.scan();
  assert.equal(w.compat.isDegraded('processWrapper'), false, 'it was already running at the first scan');
  w.platform.children = [201, 202];
  w.platform.env(202, { viaLauncher: false });
  for (let i = 0; i < 3; i++) await w.scanner.scan();
  assert.equal(w.compat.isDegraded('processWrapper'), true);
  w.platform.children = [201, 202, 203];
  w.platform.env(203, { viaLauncher: true });
  await w.scanner.scan();
  assert.equal(w.compat.isDegraded('processWrapper'), false, 'recovers when tabs come through it again');
});

test('scanner: a failing process list is logged once it repeats, never thrown', async () => {
  const w = world();
  w.platform.claudeChildren = () => Promise.reject(new Error('ps failed'));
  await w.scanner.scan();
  assert.equal(w.log.lines.length, 0);
  await w.scanner.scan();
  assert.match(
    w.log.lines.join('\n'),
    /couldn't list this window's Claude processes \(2 times in a row\): ps failed/,
  );
  w.scanner.start();
  w.scanner.setInteractive(true);
  w.scanner.dispose();
});

test('new session on another account: a one-shot record for exactly the next tab', async () => {
  const w = world();
  w.tabs.onOpen = () => {
    // The launcher claims the record and the tab starts on that account.
    fs.rmSync(w.nextTab.file(w.hostPid), { force: true });
    w.platform.children.push(301);
    w.platform.env(301, { configDir: w.store.dir('work') });
  };
  const out = await w.sessions.newSession('work');
  assert.deepEqual(out, { expected: 'work', started: true, startedOn: 'work' });
  assert.equal(w.env.CLAUDE_CONFIG_DIR, undefined, 'the window’s account for new tabs never changed');
  assert.equal(w.nextTab.isArmed(w.hostPid), false);
});

test('new session: another Claude process starting at the same moment isn’t taken for the tab', async () => {
  const w = world();
  let polls = 0;
  w.tabs.onOpen = () => {
    // Claude Code starts something else on the window's account first…
    w.platform.children.push(310);
    w.platform.env(310, {});
    fs.rmSync(w.nextTab.file(w.hostPid), { force: true });
  };
  const list = w.platform.claudeChildren.bind(w.platform);
  w.platform.claudeChildren = () => {
    // …and the tab's own process, on the account asked for, shows up a moment later.
    if (++polls === 3) {
      w.platform.children.push(311);
      w.platform.env(311, { configDir: w.store.dir('work') });
    }
    return list();
  };
  const out = await w.sessions.newSession('work');
  assert.deepEqual(out, { expected: 'work', started: true, startedOn: 'work' });
  assert.match(w.log.lines.join('\n'), /new tab \(pid 311\) started on work/);
});

test('new session: when only a process on another account starts, that’s what is reported', async () => {
  const w = world();
  w.tabs.onOpen = () => {
    w.platform.children.push(320);
    w.platform.env(320, {});
  };
  const out = await w.sessions.newSession('work');
  assert.deepEqual(out, { expected: 'work', started: true, startedOn: 'default' });
});

test('new session: unclaimed record is withdrawn; nothing started is reported; on the pick it just opens', async () => {
  const w = world();
  const none = await w.sessions.newSession('work');
  assert.deepEqual(none, { expected: 'work', started: false });
  assert.equal(w.nextTab.isArmed(w.hostPid), false, 'withdrawn after the timeout');
  assert.match(w.log.lines.join('\n'), /no tab claimed the request to open on work/);
  await w.pick.set('work');
  const same = await w.sessions.newSession('work');
  assert.deepEqual(same, { expected: 'work', started: true, startedOn: 'work' });
  await assert.rejects(w.sessions.newSession('nope'), /no account/);
});

test('new session with someone else’s process wrapper: new tabs point at the account until it starts', async () => {
  const w = world({ wrapperIsOurs: false });
  let seen: string | undefined;
  w.tabs.onOpen = () => {
    seen = w.env.CLAUDE_CONFIG_DIR;
    w.platform.children.push(302);
    w.platform.env(302, { configDir: w.store.dir('work') });
  };
  const out = await w.sessions.newSession('work');
  assert.equal(seen, w.store.dir('work'));
  assert.equal(out.startedOn, 'work');
  assert.equal(w.env.CLAUDE_CONFIG_DIR, undefined, 'back to the window’s account');
});

test('open and move: a closed session opens on its account; one open here comes forward; one open elsewhere is left there', async () => {
  const w = world();
  assert.deepEqual(await w.sessions.openSession(A), { kind: 'opened' });
  assert.deepEqual(w.tabs.opened, [A]);
  assert.equal(w.assignments.get(A), undefined, 'opening never changes a session’s account');
  // Open in this window on default: brought forward; moving it applies when it restarts.
  w.platform.children = [401];
  w.live(401, B, undefined);
  await w.scanner.scan();
  assert.deepEqual(await w.sessions.openSession(B), { kind: 'focused' });
  assert.deepEqual(await w.sessions.moveSession(B, 'work'), {
    changed: true,
    running: 'here',
    runsThere: false,
    signedIn: true,
  });
  // Open in another window: not one of this window's processes.
  w.live(9999, C, undefined);
  assert.deepEqual(await w.sessions.openSession(C), { kind: 'elsewhere' });
  const m = await w.sessions.moveSession(C, 'work');
  assert.equal(m.running, 'elsewhere');
  await assert.rejects(w.sessions.moveSession(A, 'nope'), /no account/);
});

test('copy: Claude Code forks the session on the account it’s for; the copy belongs there, named, and the original is untouched', async () => {
  const w = world();
  w.talk(A);
  const original = path.join(projectDir(w.claude, '/code/app'), `${A}.jsonl`);
  fs.appendFileSync(original, line({ type: 'bridge-session', sessionId: A, bridgeSessionId: 'cse_x' }));
  const before = fs.readFileSync(original, 'utf8');
  const real = fakeFork(w.claude);
  let during: string | undefined;
  w.copies.fork = (args, cwd) => {
    during = w.assignments.get(COPY)?.source; // the scanner could see the fork's process meanwhile
    return real(args, cwd);
  };
  const out = await w.sessions.copySession(A, 'work', '  My\n copy  ', '/code/app');
  assert.deepEqual(out, { id: COPY, name: 'My copy', signedIn: true });
  assert.equal(during, 'copied', 'it belongs to its account before Claude Code makes it');
  assert.equal(w.copyRuns.length, 1);
  const r = w.copyRuns[0];
  assert.equal(r?.file, '/x/claude');
  assert.deepEqual(r?.args, [
    '-p',
    '/rename My copy',
    '--resume',
    original,
    '--fork-session',
    '--session-id',
    COPY,
    '--strict-mcp-config',
    '--settings',
    '{"disableAllHooks":true}',
  ]);
  assert.equal(r?.cwd, '/code/app', 'run in the session’s folder, where its transcript is');
  assert.equal(r?.env?.CLAUDE_CONFIG_DIR, w.store.dir('work'), 'on the account the copy is for');
  assert.equal(r?.env?.CLAUDE_CODE_OAUTH_TOKEN, undefined, 'no inherited login');
  assert.equal(r?.env?.DISABLE_AUTOUPDATER, '1');
  assert.deepEqual(
    { ...w.assignments.get(COPY), at: undefined },
    { account: 'work', source: 'copied', at: undefined },
  );
  assert.equal(fs.readFileSync(original, 'utf8'), before, 'the original is only read');
  assert.equal(w.assignments.get(A), undefined, 'the original keeps its account');
  assert.match(w.log.lines.join('\n'), new RegExp(`session ${A} copied to work as ${COPY}`));
  // A duplicate on the default account: no CLAUDE_CONFIG_DIR, so Claude Code uses ~/.claude.
  const dup = await w.sessions.copySession(A, 'default', 'Twin', '/code/app');
  assert.equal(dup.id, COPY2);
  assert.equal(w.copyRuns[1]?.env?.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(w.assignments.accountOf(COPY2), 'default');
});

test('copy: an account that isn’t signed in still gets the copy, and the outcome says so', async () => {
  const w = world();
  w.addAccount('spare');
  w.talk(A);
  const out = await w.sessions.copySession(A, 'spare', 'For later', '/code/app');
  assert.equal(out.signedIn, false);
  assert.equal(w.assignments.accountOf(COPY), 'spare');
});

test('copy: refused with a reason, and nothing left behind, when it can’t be made', async () => {
  const w = world();
  const dir = projectDir(w.claude, '/code/app');
  await assert.rejects(w.sessions.copySession(A, 'work', 'x', '/code/app'), /isn’t saved in this folder/);
  w.talk(A);
  await assert.rejects(w.sessions.copySession(A, 'nope', 'x', '/code/app'), /no account "nope"/);
  await assert.rejects(w.sessions.copySession(A, 'work', ' \n ', '/code/app'), /Give the copy a name/);
  // Claude Code fails halfway: its partial file and folder go to the Trash, and its own error is shown.
  w.copies.fork = (args) => {
    const id = args[args.indexOf('--session-id') + 1] ?? '';
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), '{"type":"us');
    fs.mkdirSync(path.join(dir, id));
    const e = Object.assign(
      new Error('Command failed: /x/claude -p /rename x\nError: No conversation found'),
      {
        code: 1,
      },
    );
    return Promise.reject(e);
  };
  await assert.rejects(
    w.sessions.copySession(A, 'work', 'x', '/code/app'),
    /couldn’t copy the session: Error: No conversation found\.$/,
  );
  assert.equal(fs.existsSync(path.join(dir, `${COPY}.jsonl`)), false);
  assert.deepEqual(w.trash.trashed, [path.join(dir, `${COPY}.jsonl`), path.join(dir, COPY)]);
  assert.equal(w.assignments.get(COPY), undefined, 'its account, given before the run, is let go');
  assert.match(
    w.log.lines.join('\n'),
    /copying session \S+ to work failed: Command failed: [^\n]*\nError: No conversation found/,
    'all of it logged, every line of Claude Code’s error',
  );
  // Stopped after the time allowed.
  w.copies.fork = () => Promise.reject(Object.assign(new Error('Command failed'), { killed: true }));
  await assert.rejects(w.sessions.copySession(A, 'work', 'x', '/code/app'), /took too long/);
  // It ran but wrote the original's ID: not a copy, so it's refused and trashed.
  w.copies.ids = [COPY];
  w.copies.fork = () => {
    fs.writeFileSync(path.join(dir, `${COPY}.jsonl`), line({ type: 'user', sessionId: A }));
    return Promise.resolve('');
  };
  await assert.rejects(
    w.sessions.copySession(A, 'work', 'x', '/code/app'),
    /didn’t make the copy \(the copy still carries the original’s session ID\)/,
  );
  assert.equal(fs.existsSync(path.join(dir, `${COPY}.jsonl`)), false);
  // No CLI at all.
  const bare = world({ noCli: true });
  bare.talk(A);
  await assert.rejects(bare.sessions.copySession(A, 'work', 'x', '/code/app'), /CLI wasn’t found/);
});

test('copy: for a folder opened through a symlink, the copy is moved next to the original', async () => {
  const w = world();
  const base = tempDir();
  const realFolder = path.join(base, 'real-app');
  const link = path.join(base, 'linked-app');
  fs.mkdirSync(realFolder);
  fs.symlinkSync(realFolder, link);
  w.talk(A, link); // listed, and found by Claude Code, under the path the window opened
  const home = projectDir(w.claude, link);
  const out = await w.sessions.copySession(A, 'work', 'Linked', link);
  assert.ok(fs.existsSync(path.join(home, `${out.id}.jsonl`)), 'next to the original');
  assert.ok(fs.existsSync(path.join(home, out.id)), 'with its folder');
  const written = projectDir(w.claude, fs.realpathSync(realFolder));
  assert.notEqual(written, home);
  assert.equal(
    fs.existsSync(path.join(written, `${out.id}.jsonl`)),
    false,
    'nothing left where it was written',
  );
  assert.match(w.log.lines.join('\n'), new RegExp(`moved the copy ${out.id} next to its original`));
  assert.equal(w.assignments.get(out.id)?.source, 'copied');
});

test('folderOfSession: the window’s folder whose project folder holds the session', () => {
  const claude = tempDir();
  fs.mkdirSync(projectDir(claude, '/code/b'), { recursive: true });
  fs.writeFileSync(path.join(projectDir(claude, '/code/b'), `${A}.jsonl`), '');
  assert.equal(folderOfSession(claude, ['/code/a', '/code/b'], A), '/code/b');
  assert.equal(folderOfSession(claude, ['/code/a'], A), undefined);
  assert.equal(folderOfSession(claude, [], A), undefined);
});

test('copy: if /rename didn’t name it, Many Hats does; copies run one at a time', async () => {
  const w = world();
  const dir = projectDir(w.claude, '/code/app');
  w.talk(A);
  // A Claude Code whose /rename wrote no title: the copy is still good, and gets its name.
  w.copies.fork = (args) => {
    const id = args[args.indexOf('--session-id') + 1] ?? '';
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), line({ type: 'user', sessionId: id }));
    return Promise.resolve('');
  };
  await w.sessions.copySession(A, 'work', 'Named after', '/code/app');
  assert.match(fs.readFileSync(path.join(dir, `${COPY}.jsonl`), 'utf8'), /"customTitle":"Named after"/);
  // Two at once: the second starts when the first is done.
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const real = fakeFork(w.claude);
  w.copies.fork = async (args, cwd) => {
    const id = args[args.indexOf('--session-id') + 1] ?? '';
    order.push(`start ${id}`);
    if (id === COPY2) await gate;
    const out = await real(args, cwd);
    order.push(`end ${id}`);
    return out;
  };
  w.copies.ids = [COPY2, COPY3];
  const first = w.sessions.copySession(A, 'work', 'One', '/code/app');
  const second = w.sessions.copySession(A, 'work', 'Two', '/code/app');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, [`start ${COPY2}`], 'the second waits for the first');
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, [`start ${COPY2}`, `end ${COPY2}`, `start ${COPY3}`, `end ${COPY3}`]);
});

test('rename, archive and delete (to the Trash, never while open)', async () => {
  const w = world();
  const dir = projectDir(w.claude, '/code/app');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${A}.jsonl`);
  fs.writeFileSync(file, line({ type: 'ai-title', aiTitle: 'Old', sessionId: A }));
  assert.equal(await w.sessions.rename(file, A, 'New'), 'New');
  assert.equal(w.sessions.setArchived(A, true), true);
  w.assignments.set(A, 'work', 'moved');
  fs.mkdirSync(path.join(w.claude, 'file-history', A), { recursive: true });
  assert.equal(await w.sessions.deleteSession(A, dir), 2);
  assert.equal(fs.existsSync(file), false);
  assert.equal(w.archive.has(A), false);
  assert.equal(w.assignments.get(A), undefined);
  w.live(process.pid, B, undefined);
  await assert.rejects(w.sessions.deleteSession(B, dir), /open/);
});

test('accounts: create links and remembers the email; sign-in runs claude auth login for exactly that folder', () => {
  const w = world();
  const made = w.accounts.create('client-a', 'me@client.example');
  assert.equal(w.store.exists('client-a'), true);
  assert.ok(made.report.linked.includes('CLAUDE.md'));
  assert.equal(w.store.expectedEmail('client-a'), 'me@client.example');
  const t = w.accounts.signInTerminal('client-a');
  assert.equal(t.shellPath, '/usr/bin/env');
  assert.deepEqual(t.shellArgs.slice(-6), [
    `CLAUDE_CONFIG_DIR=${w.store.dir('client-a')}`,
    '/x/claude',
    'auth',
    'login',
    '--email',
    'me@client.example',
  ]);
  for (const v of LOGIN_OVERRIDE_VARS)
    assert.ok(t.shellArgs.join(' ').includes(`-u ${v}`), `${v} is unset first`);
  const main = w.accounts.signInTerminal(undefined);
  assert.ok(
    main.shellArgs.includes('-u') && main.shellArgs.includes('CLAUDE_CONFIG_DIR'),
    'the default login: CLAUDE_CONFIG_DIR unset',
  );
  assert.equal(main.email, 'me@example.com');
  w.accounts.dispose();
});

test('accounts: remove signs out, trashes only its own files, and forgets it everywhere', async () => {
  const w = world();
  w.assignments.set(A, 'work', 'moved');
  w.talk(A);
  w.assignments.set(B, 'work', 'observed'); // a tab that was never used: not a conversation
  w.picks.set('/code/other', 'work');
  w.accounts.startWatching();
  assert.deepEqual(w.accounts.removalImpact('work'), { conversations: 1, windows: 1 });
  assert.deepEqual(w.accounts.removalImpact('default'), { conversations: 0, windows: 0 });
  const dir = w.store.dir('work');
  const out = await w.accounts.remove('work');
  assert.deepEqual(out, { conversations: 1, windowsReset: 1 });
  assert.equal(w.assignments.get(B), undefined, 'every record of it goes');
  assert.match(
    w.log.lines.join('\n'),
    /removed account work; 1 conversation\(s\) no longer belong to it, 1 window\(s\)/,
  );
  assert.equal(w.store.exists('work'), false);
  assert.deepEqual(w.trash.trashed, [dir]);
  const trashed = fs.readdirSync(path.join(w.home, '.Trash', '0-work'));
  assert.deepEqual(trashed.sort(), ['.claude.json'], 'the links to ~/.claude were removed first');
  assert.ok(fs.existsSync(path.join(w.claude, 'CLAUDE.md')), 'shared data untouched');
  const logout = w.runs.find((r) => r.args.join(' ') === 'auth logout');
  assert.equal(logout?.env?.CLAUDE_CONFIG_DIR, dir);
  assert.equal(
    logout?.env?.CLAUDE_CODE_OAUTH_TOKEN,
    undefined,
    'a leaked token can’t sign out the wrong login',
  );
  assert.deepEqual(w.platform.deletedLogins, [dir]);
  await assert.rejects(w.accounts.remove('work'), /no account/);
  assert.equal(await w.accounts.usersOf('missing'), 0);
  w.accounts.dispose();
});

test('cli: a binary is found where Claude Code and installers put it; environments never carry a token', () => {
  const home = tempDir();
  assert.equal(findClaudeBinary(home), undefined);
  const local = path.join(home, '.local', 'bin', 'claude');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(findClaudeBinary(home), local);
  const ext = path.join(home, 'ext');
  const bundled = path.join(ext, 'resources', 'native-binary', 'claude');
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(bundled, '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(findClaudeBinary(home, ext), bundled, 'the one bundled with Claude Code first');
  const env = cliEnv({ A: '1', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: '/old' }, undefined);
  assert.deepEqual(env, { A: '1' });
  assert.deepEqual(cliEnvArgs('/c', '/d', ['x']).slice(-3), ['CLAUDE_CONFIG_DIR=/d', '/c', 'x']);
});

test('sidebar state: accounts with usage, sessions by account, notices', async () => {
  const w = world();
  const folder = '/code/app';
  const dir = projectDir(w.claude, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${A}.jsonl`),
    line({ type: 'ai-title', aiTitle: 'Running on work', sessionId: A }),
  );
  fs.writeFileSync(
    path.join(dir, `${B}.jsonl`),
    line({ type: 'ai-title', aiTitle: 'Closed, moved to work', sessionId: B }),
  );
  fs.writeFileSync(
    path.join(dir, `${C}.jsonl`),
    line({ type: 'ai-title', aiTitle: 'Never seen', sessionId: C }),
  );
  w.live(process.pid, A, w.store.dir('work'), 'busy');
  w.assignments.set(B, 'work', 'moved');
  w.archive.set(C, true);
  w.platform.children = [process.pid];
  await w.scanner.scan();
  // Usage: work's refresh failed; the default's is under way.
  let release = (): void => undefined;
  const usage = new UsageRefresher({
    layout: w.store.layout,
    store: w.store,
    run: (_file, _args, options) =>
      options?.env?.CLAUDE_CONFIG_DIR
        ? Promise.reject(Object.assign(new Error('Command failed'), { code: 1 }))
        : new Promise<string>((resolve) => (release = () => resolve(''))),
    claudeBinary: () => '/fake/claude',
    env: {},
    log: w.log,
    onChange: () => undefined,
  });
  await usage.refresh('work');
  const underWay = usage.refresh('default');
  const app = {
    usage,
    store: w.store,
    assignments: w.assignments,
    archive: w.archive,
    scanner: w.scanner,
    platform: w.platform,
    compat: w.compat,
    transcripts: new TranscriptReader(),
    log: w.log,
    pick: w.pick,
  } as unknown as App;
  const { state, known } = await buildSidebarState(
    app,
    [folder],
    [
      {
        id: 'launcher',
        level: 'error',
        title: 'The Many Hats launcher is missing.',
        repair: () => Promise.resolve(),
      },
    ],
  );
  assert.deepEqual(
    state.accounts.map((a) => [a.name, a.email, a.openHere]),
    [
      ['default', 'me@example.com', 0],
      ['work', 'me@work.example', 1],
    ],
  );
  const byId = Object.fromEntries(state.sessions.map((s) => [s.id, s]));
  assert.deepEqual([byId[A]?.account, byId[A]?.running], ['work', { status: 'busy', here: true }]);
  assert.equal(byId[B]?.account, 'work');
  assert.equal(byId[C]?.account, null);
  assert.equal(byId[C]?.archived, true);
  assert.equal(known.get(A)?.running, true);
  assert.deepEqual(state.notices, [
    {
      id: 'launcher',
      level: 'error',
      text: 'The Many Hats launcher is missing.',
      action: { label: 'Repair', command: 'manyHats.repair' },
    },
  ]);
  assert.equal(state.pick, 'default');
  assert.deepEqual(state.folders, ['app']);
  const [mine, work] = state.accounts;
  assert.equal(mine?.usageRefreshing, true);
  assert.equal(work?.usageRefreshing, undefined);
  assert.equal(work?.usageError, 'Claude Code’s CLI failed (exit code 1).');
  release();
  await underWay;
});
