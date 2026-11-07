import assert from 'node:assert/strict';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { Archive } from '../../src/state/archive';
import { Assignments, parseAssignment } from '../../src/state/assignments';
import { LAYOUT_VERSION, ensureLayout, layoutFor, readLayoutVersion } from '../../src/state/layout';
import { NextTab } from '../../src/state/nextTab';
import { Picks } from '../../src/state/picks';
import { A, B, C, DAY, age, tempDir } from '../helpers/home';

function book(accounts = ['default', 'dev', 'work']) {
  const root = tempDir();
  const usable = new Set(accounts);
  return { root, usable, book: new Assignments(path.join(root, 'assignments'), (n) => usable.has(n)) };
}
const files = (dir: string): string[] => fs.readdirSync(dir).sort();

test('assignments: one small private file per session, written whole', () => {
  const t = book();
  assert.equal(t.book.get(A), undefined);
  assert.equal(t.book.set(A, 'dev', 'observed'), true);
  const text = fs.readFileSync(path.join(t.book.dir, A), 'utf8');
  assert.match(text, /^dev observed \d{4}-\d\d-\d\dT[\d:.]+Z\n$/);
  assert.equal(fs.statSync(path.join(t.book.dir, A)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(t.book.dir).mode & 0o777, 0o700);
  const a = t.book.get(A);
  assert.equal(a?.account, 'dev');
  assert.equal(a?.source, 'observed');
  assert.ok(Math.abs((a?.at ?? 0) - Date.now()) < 60_000);
  assert.equal(t.book.accountOf(A), 'dev');
  assert.equal(t.book.accountOf(A.toUpperCase()), 'dev', 'ids are case-insensitive');
  assert.deepEqual(files(t.book.dir), [A], 'no temp files left behind');
});

test('assignments: refuse bad ids and unusable accounts; the same account is a no-op', () => {
  const t = book();
  assert.throws(() => t.book.set('not-an-id', 'dev', 'moved'), /not a session id/);
  assert.throws(() => t.book.set(`${A}/../x`, 'dev', 'moved'), /not a session id/);
  assert.throws(() => t.book.set(A, 'gone', 'moved'), /no account "gone"/);
  assert.throws(() => t.book.set(A, '../etc', 'moved'), /no account/);
  assert.throws(() => t.book.set(A, 'dev', 'guess' as 'moved'), /Unknown assignment source/);
  t.book.set(A, 'dev', 'observed');
  const ino = fs.statSync(path.join(t.book.dir, A)).ino;
  assert.equal(t.book.set(A, 'dev', 'moved'), false, 'already there');
  assert.equal(fs.statSync(path.join(t.book.dir, A)).ino, ino, 'not rewritten');
  assert.equal(t.book.set(A, 'default', 'moved'), true);
  assert.deepEqual([t.book.get(A)?.account, t.book.get(A)?.source], ['default', 'moved']);
});

test('assignments: the first account a session is seen on sticks; seeing it elsewhere never flips it', () => {
  const t = book();
  assert.equal(t.book.adopt(A, 'dev'), true);
  assert.equal(t.book.adopt(A, 'default'), false, 'it already belongs to dev');
  assert.equal(t.book.accountOf(A), 'dev');
  t.book.set(B, 'work', 'moved');
  assert.equal(t.book.adopt(B, 'dev'), false, 'a move is never undone by being seen elsewhere');
  assert.equal(t.book.adopt(C, 'gone'), false, 'never onto an account that is gone');
  assert.equal(t.book.adopt('nope', 'dev'), false);
  // The account it belonged to was removed: the next sighting re-homes it.
  t.usable.delete('work');
  assert.equal(t.book.accountOf(B), undefined, 'an assignment to a removed account counts as none');
  assert.equal(t.book.get(B)?.account, 'work', 'but the record is still there');
  assert.equal(t.book.adopt(B, 'dev'), true);
  assert.deepEqual([t.book.get(B)?.account, t.book.get(B)?.source], ['dev', 'observed']);
});

test("assignments: another process's writes are seen at once; damaged files are ignored", () => {
  const t = book();
  t.book.set(A, 'dev', 'observed');
  const tmp = path.join(t.book.dir, '.other.tmp');
  fs.writeFileSync(tmp, 'work moved 2026-11-06T22:00:00.000Z\n');
  fs.renameSync(tmp, path.join(t.book.dir, A));
  assert.equal(t.book.accountOf(A), 'work');
  fs.unlinkSync(path.join(t.book.dir, A));
  assert.equal(t.book.get(A), undefined, 'deleted elsewhere');
  for (const [body, why] of [
    ['', 'empty'],
    ['../x moved\n', 'path'],
    ['DEV moved\n', 'uppercase'],
    ['\n', 'blank line'],
  ] as const) {
    fs.writeFileSync(path.join(t.book.dir, B), body);
    assert.equal(t.book.get(B), undefined, why);
  }
  fs.writeFileSync(path.join(t.book.dir, B), 'dev');
  assert.deepEqual(
    t.book.get(B),
    { account: 'dev', source: 'unknown', at: undefined },
    'no newline, no source: still dev',
  );
  fs.mkdirSync(path.join(t.book.dir, C));
  assert.equal(t.book.get(C), undefined, 'a folder is not a record');
});

test('assignments: the line format the launcher also reads', () => {
  assert.deepEqual(parseAssignment('default moved 2026-11-06T22:00:00.000Z\n'), {
    account: 'default',
    source: 'moved',
    at: Date.parse('2026-11-06T22:00:00.000Z'),
  });
  assert.deepEqual(parseAssignment('dev\tobserved\tnot-a-time\nextra line\n'), {
    account: 'dev',
    source: 'observed',
    at: undefined,
  });
  assert.equal(parseAssignment('Dev moved'), undefined);
  const t = book();
  t.book.set(A, 'dev', 'moved');
  const r = cp.spawnSync(
    '/bin/sh',
    [
      '-c',
      '{ read -r account _rest < "$1"; } 2>/dev/null; printf %s "$account"',
      'sh',
      path.join(t.book.dir, A),
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.stdout, 'dev');
});

test('assignments: remove, list, removeAccount', () => {
  const t = book();
  t.book.set(A, 'dev', 'observed');
  t.book.set(B, 'dev', 'moved');
  t.book.set(C, 'work', 'observed');
  fs.writeFileSync(path.join(t.book.dir, 'junk'), 'dev');
  assert.deepEqual([...t.book.list().keys()].sort(), [A, B, C]);
  assert.equal(t.book.removeAccount('dev'), 2);
  assert.deepEqual([...t.book.list().keys()], [C]);
  assert.equal(t.book.remove(C), true);
  assert.equal(t.book.remove(C), false, 'twice is fine');
  assert.equal(t.book.remove('../junk'), false);
  assert.ok(fs.existsSync(path.join(t.book.dir, 'junk')), 'only session records are touched');
  assert.equal(new Assignments(path.join(t.root, 'nowhere'), () => true).list().size, 0);
});

test('assignments: prune drops gone sessions once old enough, and stale temp files', () => {
  const t = book();
  for (const id of [A, B, C]) t.book.set(id, 'dev', 'observed');
  age(path.join(t.book.dir, A), 10 * DAY); // gone and old: dropped
  age(path.join(t.book.dir, B), 1 * DAY); // gone but new (no transcript yet): kept
  age(path.join(t.book.dir, C), 10 * DAY); // old but still exists: kept
  const staleTmp = `.${A}.1.abcdef01.tmp`;
  fs.writeFileSync(path.join(t.book.dir, staleTmp), 'dev');
  age(path.join(t.book.dir, staleTmp), 2 * 3600e3);
  const liveTmp = `.${B}.2.abcdef02.tmp`;
  fs.writeFileSync(path.join(t.book.dir, liveTmp), 'dev'); // a write in progress
  assert.deepEqual(
    t.book.prune((id) => id === C),
    [A],
  );
  assert.deepEqual(files(t.book.dir), [liveTmp, B, C]);
  assert.deepEqual(
    new Assignments(path.join(t.root, 'nowhere'), () => true).prune(() => false),
    [],
  );
});

test('picks: per window, one file each, hashed names; forgetting an account', () => {
  const root = tempDir();
  const picks = new Picks(path.join(root, 'picks'));
  picks.set('/code/a', 'work');
  picks.set('/code/b', 'work');
  picks.set('/code/c', 'personal');
  picks.set('/code/with spaces/and "quotes"', 'work');
  assert.equal(picks.get('/code/a'), 'work');
  assert.equal(picks.get('/code/with spaces/and "quotes"'), 'work');
  assert.equal(picks.get('/code/z'), undefined);
  assert.equal(fs.readdirSync(picks.dir).length, 4);
  for (const f of fs.readdirSync(picks.dir)) {
    assert.match(f, /^[0-9a-f]{32}\.json$/);
    assert.equal(fs.statSync(path.join(picks.dir, f)).mode & 0o777, 0o600);
  }
  picks.set('/code/c', 'default');
  assert.equal(picks.get('/code/c'), undefined);
  picks.set('/code/c', undefined);
  assert.equal(picks.forgetAccount('work'), 3);
  assert.deepEqual(picks.list(), []);
  assert.throws(() => picks.set('/x', '../evil'));
  fs.mkdirSync(picks.dir, { recursive: true });
  fs.writeFileSync(path.join(picks.dir, 'broken.json'), '{nope');
  assert.deepEqual(picks.list(), [], 'a damaged record is ignored');
});

test('archive: one marker per session; pruning forgets sessions that are gone', () => {
  const root = tempDir();
  const archive = new Archive(path.join(root, 'archive'));
  assert.equal(archive.list().size, 0);
  assert.equal(archive.set(A, true), true);
  assert.equal(archive.set(A, true), false, 'already archived');
  archive.set(B, true);
  assert.equal(archive.set('bogus', true), false);
  assert.deepEqual([...archive.list().keys()].sort(), [A, B]);
  assert.ok((archive.list().get(A) ?? 0) > 0);
  assert.equal(fs.statSync(path.join(archive.dir, A)).mode & 0o777, 0o600);
  assert.equal(archive.has(A), true);
  assert.equal(archive.set(A, false), true);
  assert.equal(archive.set(A, false), false);
  assert.deepEqual([...archive.list().keys()], [B]);
  assert.equal(
    archive.prune(() => false),
    1,
  );
  assert.equal(archive.list().size, 0);
});

test('next tab: armed for one window, claimed once, swept when stale', () => {
  const root = tempDir();
  const next = new NextTab(path.join(root, 'next'));
  next.arm(4242, 'work');
  assert.equal(fs.readFileSync(next.file(4242), 'utf8'), 'work\n');
  assert.equal(next.isArmed(4242), true);
  assert.equal(next.disarm(4242), true, 'still there: nobody claimed it');
  assert.equal(next.disarm(4242), false);
  assert.throws(() => next.arm(1, '../x'));
  next.arm(1, 'default');
  fs.writeFileSync(path.join(next.dir, '7.claimed.99'), 'dev\n'); // a launcher died mid-claim
  age(next.file(1), 10 * 60_000);
  age(path.join(next.dir, '7.claimed.99'), 10 * 60_000);
  assert.equal(next.sweep(), 2);
  assert.deepEqual(fs.readdirSync(next.dir), []);
});

test('layout: created private with a version; a newer layout is refused', () => {
  const home = tempDir();
  const layout = layoutFor(home);
  assert.equal(layout.launcher, path.join(home, '.many-hats', 'bin', 'launcher'));
  assert.deepEqual(ensureLayout(layout), { created: true });
  assert.equal(fs.statSync(layout.root).mode & 0o777, 0o700);
  assert.equal(readLayoutVersion(layout), LAYOUT_VERSION);
  assert.deepEqual(ensureLayout(layout), { created: false });
  fs.writeFileSync(layout.versionFile, `${LAYOUT_VERSION + 1}\n`);
  assert.throws(() => ensureLayout(layout), /newer version of Many Hats/);
  fs.writeFileSync(layout.versionFile, 'garbage');
  assert.equal(readLayoutVersion(layout), undefined);
  ensureLayout(layout);
  assert.equal(readLayoutVersion(layout), LAYOUT_VERSION, 'a damaged version file is rewritten');
});
