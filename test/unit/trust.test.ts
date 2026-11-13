import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import test from 'node:test';
import { addTrust, PROJECT_DEFAULTS, readTrustedFolders, trustedFolders } from '../../src/claude/trust';
import { TrustSync } from '../../src/services/trustSync';
import { fakeHome, memoryLogger } from '../helpers/home';

const APP = '/Users/me/app';
const DEV = '/Users/me/Dev';

interface Config {
  projects: Record<string, Record<string, unknown>>;
  oauthAccount: { emailAddress: string };
  numStartups?: number;
}

function readJson(file: string): Config {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Config;
}

test('trustedFolders: only entries with hasTrustDialogAccepted true; unreadable configs say so', () => {
  assert.deepEqual(
    [
      ...(trustedFolders({
        projects: {
          [APP]: { hasTrustDialogAccepted: true },
          [DEV]: { hasTrustDialogAccepted: false },
          '/x': { hasTrustDialogAccepted: 'yes' },
          '/y': null,
        },
      }) ?? []),
    ],
    [APP],
  );
  assert.deepEqual([...(trustedFolders({}) ?? ['x'])], [], 'no projects yet');
  assert.equal(trustedFolders({ projects: [] }), undefined);
  assert.equal(trustedFolders('nope'), undefined);
});

test('trust sync: a folder trusted on one account is trusted on all, keeping everything else', () => {
  const h = fakeHome();
  h.addAccount('work', 'me@work.example');
  h.addAccount('play', 'me@play.example');
  const work = h.store.configFile('work');
  const play = h.store.configFile('play');
  // work trusts ~/Dev (Claude Code recorded it there); play has its own entry for it, untrusted.
  fs.writeFileSync(
    work,
    JSON.stringify(
      {
        oauthAccount: { emailAddress: 'me@work.example' },
        projects: { [DEV]: { hasTrustDialogAccepted: true } },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    play,
    JSON.stringify(
      {
        oauthAccount: { emailAddress: 'me@play.example' },
        projects: { [DEV]: { allowedTools: ['Bash(ls)'], hasTrustDialogAccepted: false } },
      },
      null,
      2,
    ) + '\n',
  );
  fs.chmodSync(play, 0o600);
  const log = memoryLogger();
  const report = new TrustSync({ store: h.store, log }).sync();

  assert.deepEqual(Object.fromEntries(report.added), { default: [DEV], work: [APP], play: [APP, DEV] });
  const def = readJson(h.store.configFile());
  assert.deepEqual(
    def.projects[DEV],
    { ...PROJECT_DEFAULTS, hasTrustDialogAccepted: true },
    'Claude Code’s own defaults',
  );
  assert.equal(def.numStartups, 9, 'nothing else changed');
  assert.equal(def.oauthAccount.emailAddress, 'me@example.com');
  assert.deepEqual(readJson(play).projects[DEV], {
    allowedTools: ['Bash(ls)'],
    hasTrustDialogAccepted: true,
  });
  assert.equal(readJson(work).projects[APP]?.hasTrustDialogAccepted, true);
  assert.equal(fs.statSync(play).mode & 0o777, 0o600, 'mode kept');
  assert.ok(fs.readFileSync(play, 'utf8').endsWith('}\n'), 'a trailing newline kept');
  assert.ok(fs.readFileSync(work, 'utf8').endsWith('}'), 'and none added');
  for (const f of [work, play, h.store.configFile()])
    assert.equal(fs.existsSync(`${f}.lock`), false, 'lock released');

  const before = fs.readFileSync(work, 'utf8');
  const again = new TrustSync({ store: h.store, log }).sync();
  assert.equal(again.added.size, 0, 'in step: nothing to do');
  assert.equal(fs.readFileSync(work, 'utf8'), before, 'and nothing rewritten');
});

test('trust sync never untrusts, and never trusts what no account trusts', () => {
  const h = fakeHome();
  h.addAccount('work', 'me@work.example');
  const work = h.store.configFile('work');
  fs.writeFileSync(work, JSON.stringify({ projects: { [DEV]: { hasTrustDialogAccepted: false } } }));
  new TrustSync({ store: h.store, log: memoryLogger() }).sync();
  assert.deepEqual([...(readTrustedFolders(work) ?? [])], [APP], 'only the folder default trusts');
  assert.deepEqual([...(readTrustedFolders(h.store.configFile()) ?? [])], [APP], 'default keeps its trust');
});

test('trust sync waits for Claude Code’s lock, and leaves configs it can’t read alone', () => {
  const h = fakeHome();
  h.addAccount('work', 'me@work.example');
  h.addAccount('odd', 'me@odd.example');
  const work = h.store.configFile('work');
  const odd = h.store.configFile('odd');
  fs.mkdirSync(`${work}.lock`); // Claude Code is saving
  fs.writeFileSync(odd, '{"projects": [');
  const report = new TrustSync({ store: h.store, log: memoryLogger() }).sync();
  assert.deepEqual(report.busy, ['work']);
  assert.equal(readTrustedFolders(work)?.size, 0, 'untouched while locked');
  assert.ok(fs.existsSync(`${work}.lock`), 'its lock is never broken');
  assert.equal(fs.readFileSync(odd, 'utf8'), '{"projects": [', 'garbled: left alone');
  fs.rmdirSync(`${work}.lock`);
  assert.deepEqual(Object.fromEntries(new TrustSync({ store: h.store, log: memoryLogger() }).sync().added), {
    work: [APP],
  });
});

test('addTrust: follows a linked config file to the real one and locks that', () => {
  const h = fakeHome();
  const real = h.store.configFile();
  const link = `${h.home}/linked.json`;
  fs.symlinkSync(real, link);
  assert.deepEqual(addTrust(link, [DEV]), { kind: 'added', folders: [DEV] });
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'the link stays a link');
  assert.equal(readTrustedFolders(real)?.has(DEV), true);
  assert.deepEqual(addTrust(`${h.home}/missing.json`, [DEV]), { kind: 'skipped' });
});

test('trust sync at startup: logs what it shared, and retries a locked file shortly', async () => {
  const h = fakeHome();
  h.addAccount('work', 'me@work.example');
  const work = h.store.configFile('work');
  fs.mkdirSync(`${work}.lock`);
  const log = memoryLogger();
  const sync = new TrustSync({ store: h.store, log, retryMs: 20 });
  sync.start();
  assert.equal(readTrustedFolders(work)?.size, 0, 'locked at first');
  fs.rmdirSync(`${work}.lock`);
  await new Promise((r) => setTimeout(r, 80));
  sync.dispose();
  assert.equal(readTrustedFolders(work)?.has(APP), true, 'shared on the retry');
  assert.match(
    log.lines.join('\n'),
    /trusted 1 folder\(s\) on work that another account trusts: \/Users\/me\/app/,
  );
});
