import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { isAccountBoundKey, isAccountLocal } from '../../src/claude/configFiles';
import { AccountStore } from '../../src/state/accounts';
import { emptyReport, describeReport } from '../../src/services/configSync';
import { fakeHome } from '../helpers/home';

const isLink = (p: string): boolean => fs.lstatSync(p).isSymbolicLink();
const mode = (p: string): number => fs.statSync(p).mode & 0o777;
const read = (p: string): string => fs.readFileSync(p, 'utf8');
/** What an atomic writer does to a symlinked file: put a real file in its place. */
function replaceLink(p: string, body: string, mtime?: Date): void {
  fs.unlinkSync(p);
  fs.writeFileSync(p, body);
  if (mtime) fs.utimesSync(p, mtime, mtime);
}

test('create: links shared entries, keeps login files apart, seeds an identity-free .claude.json', () => {
  const { claude, layout, store, sync } = fakeHome();
  const made = store.createFolder('work');
  const report = sync.sync('work');
  const dir = path.join(layout.accountsDir, 'work');
  assert.equal(made.dir, dir);
  assert.equal(mode(dir), 0o700);
  for (const e of [
    'CLAUDE.md',
    'settings.json',
    'history.jsonl',
    'projects',
    'skills',
    'plugins',
    'ide',
    'sessions',
  ]) {
    assert.equal(fs.readlinkSync(path.join(dir, e)), path.join(claude, e), e);
  }
  assert.ok(report.linked.includes('CLAUDE.md'));
  for (const e of [
    'cache',
    'telemetry',
    'backups',
    '.cc-writes',
    'policy-limits.json',
    'remote-settings.json.synced-at',
    'mcp-needs-auth-cache.json',
    '.last-cleanup',
    '.DS_Store',
  ]) {
    assert.equal(fs.existsSync(path.join(dir, e)), false, `${e} must stay per account`);
  }
  const config = path.join(dir, '.claude.json');
  assert.equal(isLink(config), false);
  assert.equal(mode(config), 0o600);
  assert.deepEqual(Object.keys(JSON.parse(read(config)) as object).sort(), [
    'hasCompletedOnboarding',
    'mcpServers',
    'migrationVersion',
    'opusProMigrationComplete',
    'projects',
    'tipsHistory',
  ]);
  assert.equal(made.seededKeys, 6);
  assert.equal(
    read(path.join(dir, 'projects/-Users-me-app/s1.jsonl')),
    'session\n',
    'history reachable through the link',
  );
  fs.appendFileSync(path.join(dir, 'history.jsonl'), '{"display":"from work"}\n');
  assert.match(
    read(path.join(claude, 'history.jsonl')),
    /from work/,
    'writing through a link lands in ~/.claude',
  );
});

test('names: validated; default, duplicates and junk refused; only real accounts are listed', () => {
  const { layout, store } = fakeHome();
  for (const bad of ['default', '', 'Work', '-x', 'a b', '../x', 'x'.repeat(33), '.backups']) {
    assert.ok(store.nameProblem(bad), `"${bad}" should be refused`);
    assert.throws(() => store.createFolder(bad));
  }
  store.createFolder('work');
  store.createFolder('personal');
  assert.match(store.nameProblem('work') ?? '', /already an account/);
  assert.throws(() => store.createFolder('work'), /already an account/);
  fs.mkdirSync(path.join(layout.accountsDir, 'stray')); // a folder with no .claude.json
  fs.writeFileSync(path.join(layout.accountsDir, 'file'), '');
  assert.deepEqual(store.list(), ['personal', 'work']);
  assert.equal(store.exists('nope'), false);
  assert.equal(store.exists('stray'), false);
  assert.throws(() => store.dir('../x'), /isn't an account name/);
});

test('identity, plan and the email an account should sign in as', () => {
  const { store } = fakeHome();
  store.createFolder('work');
  assert.equal(store.profile().email, 'me@example.com');
  assert.equal(store.profile().org, 'Me Inc');
  assert.deepEqual(store.profile('work'), {}, 'a new account has no identity until it signs in');
  fs.writeFileSync(
    store.configFile('work'),
    JSON.stringify({ oauthAccount: { emailAddress: 'me@work.example' } }),
  );
  assert.equal(store.profile('work').email, 'me@work.example');
  assert.equal(store.expectedEmail('work'), undefined);
  store.setExpectedEmail('work', '  boss@work.example ');
  assert.equal(store.expectedEmail('work'), 'boss@work.example');
  assert.equal(mode(path.join(store.dir('work'), '.many-hats.json')), 0o600);
  assert.throws(() => store.setExpectedEmail('work', 'not an email'), /email address/);
  assert.throws(() => store.setExpectedEmail('nope', 'a@b.c'), /no account/);
  assert.equal(store.expectedEmail(undefined), undefined);
  const uuids = store.accountsByUuid();
  assert.equal(uuids.get('aaaaaaaa-0000-4000-8000-000000000001'), 'default', 'account ids are lowercased');
});

test('accountOfConfigDir: which account a process runs on, from its CLAUDE_CONFIG_DIR', () => {
  const { home, layout, store } = fakeHome();
  store.createFolder('dev');
  assert.equal(store.accountOfConfigDir(undefined), 'default');
  assert.equal(store.accountOfConfigDir(''), 'default');
  assert.equal(store.accountOfConfigDir(path.join(home, '.claude')), 'default');
  assert.equal(store.accountOfConfigDir(store.dir('dev')), 'dev');
  assert.equal(store.accountOfConfigDir(`${store.dir('dev')}/`), 'dev');
  assert.equal(store.accountOfConfigDir(path.join(home, 'elsewhere')), undefined);
  assert.equal(store.accountOfConfigDir(path.join(store.dir('dev'), 'sub')), undefined);
  assert.equal(store.accountOfConfigDir(layout.backupsDir), undefined);
  assert.equal(store.usable('default'), true);
  assert.equal(store.usable('dev'), true);
  assert.equal(store.usable('gone'), false);
  assert.equal(store.configFile('default'), store.defaultConfig);
  assert.equal(store.configDirOf(undefined), undefined);
  assert.equal(store.configDirOf('dev'), store.dir('dev'));
});

test('accountOfEnv: a login token decides the account whatever CLAUDE_CONFIG_DIR says', () => {
  const { store } = fakeHome();
  store.createFolder('dev');
  const U = 'f2bc76ac-6026-4f64-8fe2-35e253b9f163';
  const byUuid = new Map([[U, 'dev']]);
  const env = (o: Partial<{ configDir: string; tokenAuth: boolean; tokenAccountUuid: string }>) => ({
    configDir: undefined,
    viaLauncher: true,
    background: false,
    tokenAuth: false,
    tokenAccountUuid: undefined,
    ...o,
  });
  assert.equal(store.accountOfEnv(env({ configDir: store.dir('dev') })), 'dev');
  assert.equal(store.accountOfEnv(env({})), 'default');
  assert.equal(
    store.accountOfEnv(env({ tokenAuth: true, tokenAccountUuid: U }), byUuid),
    'dev',
    'the Claude desktop app: known by its account id',
  );
  assert.equal(
    store.accountOfEnv(
      env({ tokenAuth: true, tokenAccountUuid: '99999999-9999-4999-8999-999999999999' }),
      byUuid,
    ),
    undefined,
    'not one of these accounts',
  );
  assert.equal(
    store.accountOfEnv(env({ configDir: store.dir('dev'), tokenAuth: true }), byUuid),
    undefined,
    "a token with no account id: can't tell",
  );
  assert.equal(
    store.accountOfEnv(env({ tokenAuth: true, tokenAccountUuid: U })),
    undefined,
    'no account ids given',
  );
});

test('an inherited CLAUDE_CONFIG_DIR plays the part of ~/.claude; one of our own folders is ignored', () => {
  const { home, layout, store: base } = fakeHome();
  const other = path.join(home, 'other-claude');
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, 'CLAUDE.md'), '# other\n');
  fs.writeFileSync(
    path.join(other, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'x@y.example' }, theme: 'dark' }),
  );
  const store = new AccountStore({ layout, inheritedConfigDir: other });
  assert.equal(store.defaultDir, other);
  assert.equal(store.profile().email, 'x@y.example');
  store.createFolder('work');
  assert.deepEqual(JSON.parse(read(store.configFile('work'))), { theme: 'dark' });
  assert.equal(store.accountOfConfigDir(undefined), undefined, 'plain ~/.claude is then not the default');
  assert.equal(store.accountOfConfigDir(other), 'default');
  assert.equal(base.defaultDir, path.join(home, '.claude'));
  const ours = new AccountStore({ layout, inheritedConfigDir: store.dir('work') });
  assert.equal(ours.inherited, undefined);
  assert.equal(ours.defaultDir, path.join(home, '.claude'));
});

test('sync: a newer copy written over a shared link goes to ~/.claude; the old version is backed up', () => {
  const { claude, layout, store, sync } = fakeHome();
  store.createFolder('work');
  sync.sync('work');
  const link = path.join(store.dir('work'), 'settings.json');
  replaceLink(link, '{"model":"sonnet"}\n', new Date(Date.now() + 60_000));
  assert.deepEqual(sync.sync('work').pushed, ['settings.json']);
  assert.equal(read(path.join(claude, 'settings.json')), '{"model":"sonnet"}\n');
  assert.ok(isLink(link));
  const saved = fs.readdirSync(layout.backupsDir);
  assert.equal(saved.length, 1);
  assert.match(saved[0] ?? '', /^default-settings\.json\./);
  assert.equal(read(path.join(layout.backupsDir, saved[0] ?? '')), '{"model":"opus"}\n');
});

test('sync: an older copy is set aside and ~/.claude is left as it is', () => {
  const { claude, layout, store, sync } = fakeHome();
  store.createFolder('work');
  sync.sync('work');
  const link = path.join(store.dir('work'), 'CLAUDE.md');
  replaceLink(link, '# stale\n', new Date(Date.now() - 60_000));
  assert.deepEqual(sync.sync('work').dropped, ['CLAUDE.md']);
  assert.equal(read(path.join(claude, 'CLAUDE.md')), '# my rules\n');
  assert.ok(isLink(link));
  assert.match(fs.readdirSync(layout.backupsDir)[0] ?? '', /^work-CLAUDE\.md\./);
});

test('sync: an identical copy is simply relinked, with no backup', () => {
  const { layout, store, sync } = fakeHome();
  store.createFolder('work');
  sync.sync('work');
  const link = path.join(store.dir('work'), 'settings.json');
  replaceLink(link, '{"model":"opus"}\n');
  assert.deepEqual(sync.sync('work').relinked, ['settings.json']);
  assert.ok(isLink(link));
  assert.equal(fs.existsSync(layout.backupsDir), false);
});

test('sync: entries made in the account first move into ~/.claude; login-local ones stay put', () => {
  const { claude, store, sync } = fakeHome();
  store.createFolder('work');
  sync.sync('work');
  const dir = store.dir('work');
  fs.mkdirSync(path.join(dir, 'todos'));
  fs.writeFileSync(path.join(dir, 'todos', 't.json'), '[]');
  fs.mkdirSync(path.join(dir, 'statsig'));
  assert.deepEqual(sync.sync('work').adopted, ['todos']);
  assert.ok(isLink(path.join(dir, 'todos')));
  assert.equal(read(path.join(claude, 'todos', 't.json')), '[]');
  assert.equal(isLink(path.join(dir, 'statsig')), false);
  assert.equal(fs.existsSync(path.join(claude, 'statsig')), false);
});

test('sync: links what ~/.claude gains later, drops links to what it lost, keeps hand-made links', () => {
  const { home, claude, store, sync } = fakeHome();
  store.createFolder('work');
  sync.sync('work');
  const dir = store.dir('work');
  fs.mkdirSync(path.join(claude, 'agents'));
  fs.rmSync(path.join(claude, 'ide'), { recursive: true });
  const elsewhere = path.join(home, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.unlinkSync(path.join(dir, 'skills'));
  fs.symlinkSync(elsewhere, path.join(dir, 'skills'));
  const r = sync.sync('work');
  assert.deepEqual(r.linked, ['agents']);
  assert.deepEqual(r.unlinked, ['ide']);
  assert.equal(fs.readlinkSync(path.join(dir, 'skills')), elsewhere);
  assert.deepEqual(sync.sync('work'), emptyReport(), 'a second sync has nothing to do');
});

test('sync: a real folder in both places is reported and left alone; non-accounts are refused', () => {
  const { claude, layout, store, sync } = fakeHome();
  store.createFolder('work');
  sync.sync('work');
  const dir = store.dir('work');
  fs.unlinkSync(path.join(dir, 'plugins'));
  fs.mkdirSync(path.join(dir, 'plugins'));
  fs.writeFileSync(path.join(dir, 'plugins', 'mine.json'), '{}');
  assert.deepEqual(sync.sync('work').separate, ['plugins']);
  assert.equal(read(path.join(dir, 'plugins', 'mine.json')), '{}');
  assert.equal(fs.existsSync(path.join(claude, 'plugins', 'mine.json')), false);
  fs.mkdirSync(path.join(layout.accountsDir, 'stray'));
  assert.throws(() => sync.sync('stray'), /not an account/);
  assert.equal(
    fs.readdirSync(path.join(layout.accountsDir, 'stray')).length,
    0,
    'nothing linked into a non-account',
  );
});

test('sync: per-login dot-files and stray files are never shared or adopted', () => {
  const { claude, store, sync } = fakeHome();
  store.createFolder('dev');
  sync.sync('dev');
  const dir = store.dir('dev');
  fs.writeFileSync(path.join(dir, '.oauth_refresh.lock.owner'), '{"pid":1}');
  fs.mkdirSync(path.join(dir, '.oauth_refresh.lock'));
  fs.writeFileSync(path.join(dir, 'some-new-cache.json'), '{}');
  fs.writeFileSync(path.join(dir, 'keybindings.json'), '[]');
  fs.mkdirSync(path.join(dir, 'agents'));
  fs.writeFileSync(path.join(claude, '.oauth_refresh.lock.owner'), '{"pid":2}');
  assert.deepEqual(
    sync.sync('dev').adopted.sort(),
    ['agents', 'keybindings.json'],
    'only folders and known shared files',
  );
  for (const e of ['.oauth_refresh.lock.owner', '.oauth_refresh.lock', 'some-new-cache.json']) {
    assert.equal(isLink(path.join(dir, e)), false, `${e} stays with the login`);
  }
  assert.equal(
    read(path.join(claude, '.oauth_refresh.lock.owner')),
    '{"pid":2}',
    "the default login's lock is untouched",
  );
  assert.equal(fs.existsSync(path.join(claude, 'some-new-cache.json')), false);
});

test('unlinkShared removes the links only; shared data is untouched', () => {
  const { claude, store, sync } = fakeHome();
  store.createFolder('work');
  sync.sync('work');
  const dir = store.dir('work');
  const links = fs.readdirSync(dir).filter((e) => isLink(path.join(dir, e))).length;
  assert.equal(sync.unlinkShared('work'), links);
  assert.deepEqual(fs.readdirSync(dir), ['.claude.json']);
  assert.equal(read(path.join(claude, 'projects/-Users-me-app/s1.jsonl')), 'session\n');
  assert.equal(read(path.join(claude, 'CLAUDE.md')), '# my rules\n');
});

test('what counts as per-login', () => {
  for (const e of [
    '.claude.json',
    '.claude.json.backup',
    '.credentials.json',
    'cache',
    'telemetry',
    'statsig',
    'backups',
    '.cc-writes',
    'policy-limits.json',
    'policy-limits.json.stamp.json',
    'remote-settings.json',
    'remote-settings.json.signature.json',
    'mcp-needs-auth-cache.json',
    '.last-update-result.json',
    '.many-hats.json',
    'x.lock',
  ]) {
    assert.ok(isAccountLocal(e), e);
  }
  for (const e of [
    'CLAUDE.md',
    'settings.json',
    'history.jsonl',
    'projects',
    'plugins',
    'skills',
    'sessions',
    'ide',
    'plans',
    'file-history',
  ]) {
    assert.ok(!isAccountLocal(e), e);
  }
  for (const k of [
    'oauthAccount',
    'primaryApiKey',
    'userID',
    'modelAccessCache',
    'cachedGrowthBookFeatures',
    'orgModelDefaultCache',
  ])
    assert.ok(isAccountBoundKey(k), k);
  for (const k of ['projects', 'mcpServers', 'migrationVersion', 'hasCompletedOnboarding', 'tipsHistory'])
    assert.ok(!isAccountBoundKey(k), k);
});

test('describeReport: one log line per kind of change', () => {
  const r = emptyReport();
  r.linked.push('a', 'b');
  r.pushed.push('settings.json');
  assert.deepEqual(describeReport('work', r, 'window opened'), [
    'work: linked a, b (window opened)',
    'work: pushed settings.json (window opened)',
  ]);
});
