/**
 * Contract tests: Many Hats against files in Claude Code's own formats (test/fixtures/claude-code-*),
 * and what happens when those formats change. When Claude Code changes a format, add a fixture
 * folder for the new version and make these pass for both.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { Compat } from '../../src/claude/compat';
import { isAlive, parseLiveSession, readLiveSessions } from '../../src/claude/liveSessions';
import { projectDir, projectKey } from '../../src/claude/paths';
import { clamp, money, profileFromConfig, usageFromConfig } from '../../src/claude/profile';
import {
  TranscriptReader,
  allSessionIds,
  renameSession,
  sessionPaths,
  titleOf,
} from '../../src/claude/transcripts';
import { A, B, C, line, tempDir } from '../helpers/home';

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const versions = fs.readdirSync(FIXTURES).filter((d) => d.startsWith('claude-code-'));
const NOW = Date.parse('2026-11-06T07:00:00Z');
const UUID = '6ec4376e-92dd-4d4f-991a-37a622d8d1dd';
const fixture = (version: string, file: string): string =>
  fs.readFileSync(path.join(FIXTURES, version, file), 'utf8');

for (const version of versions) {
  test(`${version}: identity, plan and usage windows`, () => {
    const config = JSON.parse(fixture(version, 'claude.json')) as Record<string, unknown>;
    const compat = new Compat();
    assert.deepEqual(profileFromConfig(config, compat), {
      email: 'dev@example.com',
      org: 'Example Co',
      accountUuid: UUID,
      plan: 'Team',
      tier: 'Max 5x',
      role: 'member',
    });
    const usage = usageFromConfig(config, UUID, NOW, compat);
    assert.ok(usage);
    assert.deepEqual(
      usage.limits.map((l) => [l.label, l.kind, l.percent, l.level, l.active]),
      [
        ['Session (5hr)', 'session', 26, 'normal', true],
        ['Weekly (7 day)', 'weekly_all', 3, 'normal', false],
        ['Fable limit', 'weekly_scoped', 0, 'normal', false],
      ],
    );
    assert.equal(usage.limits[0]?.resetsAt, Date.parse('2026-11-06T10:39:59.875905+00:00'));
    assert.equal(usage.credits, undefined, 'credits only when turned on');
    assert.deepEqual(compat.issues(), []);
  });

  test(`${version}: live session records`, () => {
    const claude = tempDir();
    fs.mkdirSync(path.join(claude, 'sessions'));
    fs.writeFileSync(
      path.join(claude, 'sessions', `${process.pid}.json`),
      fixture(version, 'session-record.json'),
    );
    fs.writeFileSync(
      path.join(claude, 'sessions', '999999.json'),
      JSON.stringify({ sessionId: B, status: 'idle' }),
    );
    fs.writeFileSync(path.join(claude, 'sessions', 'junk.json'), '{}');
    const running = readLiveSessions(claude, (pid) => pid === process.pid);
    assert.deepEqual([...running.keys()], [A]);
    assert.deepEqual(running.get(A), {
      pid: process.pid,
      sessionId: A,
      status: 'busy',
      name: 'Fix the login bug',
    });
  });

  test(`${version}: transcript titles; the session-owner line is never used`, () => {
    const dir = path.join(tempDir(), 'projects', 'x');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${A}.jsonl`), fixture(version, 'transcript.jsonl'));
    const compat = new Compat();
    const [s] = new TranscriptReader(compat).listSessions(dir);
    assert.equal(s?.title, 'Fix login after token refresh');
    assert.equal(s?.renamed, false);
    assert.equal(
      Object.keys(s ?? {}).some((k) => /owner/i.test(k)),
      false,
    );
    assert.deepEqual(compat.issues(), []);
  });
}

test('usage: past a reset it shows as reset; warning and critical levels; new kinds are named', () => {
  const config = {
    cachedUsageUtilization: {
      accountUuid: UUID,
      utilization: {
        limits: [
          { kind: 'session', percent: 80, resets_at: '2026-11-06T06:00:00Z', severity: 'normal' },
          { kind: 'weekly_all', percent: 75, resets_at: '2026-11-08T00:00:00Z', severity: 'normal' },
          {
            kind: 'weekly_scoped',
            percent: 95,
            resets_at: '2026-11-08T00:00:00Z',
            scope: { model: { display_name: 'Opus' } },
          },
          { kind: 'odd_new_kind', percent: 10, resets_at: '2026-11-08T00:00:00Z', severity: 'warning' },
          { kind: 'broken', percent: 'n/a' },
        ],
      },
    },
  };
  const u = usageFromConfig(config, UUID, NOW);
  assert.deepEqual(
    u?.limits.map((l) => [l.label, l.percent, l.reset, l.level]),
    [
      ['Session (5hr)', 0, true, 'normal'],
      ['Weekly (7 day)', 75, false, 'warning'],
      ['Opus limit', 95, false, 'critical'],
      ['Odd new kind', 10, false, 'warning'],
    ],
  );
  assert.equal(u?.limits[0]?.resetsAt, undefined);
});

test('usage: older caches without a limits list; another login’s cache; credits', () => {
  const base = (u: Record<string, unknown>) => ({
    cachedUsageUtilization: { accountUuid: UUID, fetchedAtMs: NOW, utilization: u },
  });
  const old = usageFromConfig(
    base({
      five_hour: { utilization: 26 },
      seven_day: { utilization: 3 },
      seven_day_opus: { utilization: 5, resets_at: '2026-11-08T00:00:00Z' },
    }),
    UUID,
    NOW,
  );
  assert.deepEqual(
    old?.limits.map((l) => [l.label, l.kind, l.percent]),
    [
      ['Session (5hr)', 'session', 26],
      ['Weekly (7 day)', 'weekly_all', 3],
      ['Opus limit', 'weekly_scoped', 5],
    ],
  );
  assert.equal(usageFromConfig(base({}), 'someone-else', NOW), undefined, 'left from a previous login');
  assert.equal(usageFromConfig({}, UUID, NOW), undefined);
  const paid = usageFromConfig(
    base({
      limits: [{ kind: 'session', percent: 1 }],
      spend: { used: { amount_minor: 1234, currency: 'USD', exponent: 2 }, percent: 12, enabled: true },
    }),
    UUID,
    NOW,
  );
  assert.deepEqual(paid?.credits, { used: '$12.34', percent: 12 });
  assert.equal(money({ amount_minor: 5, currency: 'NOT-A-CURRENCY', exponent: 0 }), '5');
  assert.equal(money(null), '');
  assert.equal(clamp(140), 100);
  assert.equal(clamp(-3), 0);
  assert.equal(clamp('x'), 0);
});

test('format change: records that stop making sense pause the feature, and it recovers by itself', () => {
  const compat = new Compat(() => 1000);
  const changes: string[] = [];
  compat.onDidChange(() =>
    changes.push(
      compat
        .issues()
        .map((i) => i.feature)
        .join(','),
    ),
  );
  const unknownIdentity = { oauthAccount: { email: 'moved@example.com' } };
  for (let i = 0; i < 2; i++) profileFromConfig(unknownIdentity, compat);
  assert.equal(compat.isDegraded('identity'), false, 'two strange reads in a row are not enough');
  profileFromConfig(unknownIdentity, compat);
  assert.equal(compat.isDegraded('identity'), true);
  assert.deepEqual(compat.issues(), [
    { feature: 'identity', detail: 'oauthAccount has no emailAddress', since: 1000 },
  ]);
  profileFromConfig({ oauthAccount: { emailAddress: 'ok@example.com' } }, compat);
  assert.equal(compat.isDegraded('identity'), false, 'recovers as soon as records make sense again');
  assert.deepEqual(changes, ['identity', '']);
  // Nothing found says nothing.
  compat.observe('liveSessions', 0, 0);
  assert.deepEqual(compat.issues(), []);
});

test('format change: live session records without a session id', () => {
  const claude = tempDir();
  fs.mkdirSync(path.join(claude, 'sessions'));
  fs.writeFileSync(
    path.join(claude, 'sessions', `${process.pid}.json`),
    JSON.stringify({ pid: process.pid, conversation: A }),
  );
  const compat = new Compat();
  for (let i = 0; i < 3; i++) assert.equal(readLiveSessions(claude, isAlive, compat).size, 0);
  assert.equal(compat.isDegraded('liveSessions'), true);
  assert.equal(parseLiveSession(1, { sessionId: 'not-a-uuid' }), undefined);
  assert.equal(parseLiveSession(1, null), undefined);
});

test('format change: transcripts that are not JSON entries', () => {
  const dir = path.join(tempDir(), 'projects', 'x');
  fs.mkdirSync(dir, { recursive: true });
  const compat = new Compat();
  const reader = new TranscriptReader(compat);
  for (const id of [A, B, C]) {
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), 'plain text now\n');
    reader.listSessions(dir);
  }
  assert.equal(compat.isDegraded('transcripts'), true);
});

test('projectKey matches Claude Code’s folder names', () => {
  assert.equal(projectKey('/Users/me/Dev/my-app_2'), '-Users-me-Dev-my-app-2');
  assert.equal(projectKey('/a/b.c d'), '-a-b-c-d');
  assert.equal(projectDir('/h/.claude', '/a/b'), '/h/.claude/projects/-a-b');
});

test('titles: a rename wins over Claude’s own title; else its title; else the last prompt', () => {
  const dir = path.join(tempDir(), 'projects', 'x');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${A}.jsonl`),
    [
      line({ type: 'user', message: { content: 'hi' } }),
      line({ type: 'ai-title', aiTitle: 'Fix the login', sessionId: A }),
      line({ type: 'custom-title', sessionId: A, customTitle: 'Login bug' }),
      line({ type: 'ai-title', aiTitle: 'A later automatic title', sessionId: A }),
    ].join(''),
  );
  fs.writeFileSync(
    path.join(dir, `${B}.jsonl`),
    line({ type: 'last-prompt', lastPrompt: 'Make the build faster\nand smaller', sessionId: B }),
  );
  // A message that merely contains the marker text (escaped, as JSON stores it) is not a title.
  fs.writeFileSync(
    path.join(dir, `${C}.jsonl`),
    [
      line({ type: 'user', message: { content: '{"type":"custom-title","customTitle":"evil"}' } }),
      line({ type: 'ai-title', aiTitle: 'Real title', sessionId: C }),
    ].join(''),
  );
  fs.writeFileSync(path.join(dir, 'not-a-session.jsonl'), '');
  const t0 = Date.now() / 1000;
  fs.utimesSync(path.join(dir, `${A}.jsonl`), t0 - 30, t0 - 30);
  fs.utimesSync(path.join(dir, `${B}.jsonl`), t0 - 10, t0 - 10);
  fs.utimesSync(path.join(dir, `${C}.jsonl`), t0 - 20, t0 - 20);
  const list = new TranscriptReader().listSessions(dir);
  assert.deepEqual(
    list.map((s) => s.id),
    [B, C, A],
    'newest first',
  );
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.equal(byId[A]?.title, 'Login bug');
  assert.equal(byId[A]?.renamed, true);
  assert.equal(byId[B]?.title, 'Make the build faster');
  assert.equal(byId[C]?.title, 'Real title');
  assert.equal(titleOf({}), 'Untitled');
  assert.equal(titleOf({ aiTitle: 'x'.repeat(200) }), `${'x'.repeat(117)}…`);
});

test('transcripts are read incrementally, survive a split multi-byte character, and re-read when replaced', () => {
  const dir = tempDir();
  const file = path.join(dir, `${A}.jsonl`);
  const reader = new TranscriptReader();
  const title = line({ type: 'custom-title', sessionId: A, customTitle: 'Café ☕ ünïcödé' });
  const at = Buffer.from(title).indexOf(Buffer.from('é'));
  const fillerBytes = (1 << 20) - 1 - at; // that 2-byte character straddles the 1 MiB read boundary
  const head = '{"type":"user","message":"';
  const tail = '"}\n';
  fs.writeFileSync(file, head + 'x'.repeat(fillerBytes - head.length - tail.length) + tail + title);
  assert.equal(reader.facts(file).customTitle, 'Café ☕ ünïcödé');
  fs.appendFileSync(file, line({ type: 'last-prompt', lastPrompt: 'Ship it', sessionId: A }));
  fs.appendFileSync(file, '{"type":"ai-title","aiTi'); // half-written line: not read yet
  assert.equal(reader.facts(file).lastPrompt, 'Ship it');
  assert.equal(reader.facts(file).aiTitle, undefined);
  fs.appendFileSync(file, 'tle":"Done now","sessionId":"x"}\n');
  assert.equal(reader.facts(file).aiTitle, 'Done now', 'the rest of the line arrived');
  fs.writeFileSync(`${file}.new`, line({ type: 'ai-title', aiTitle: 'Rewritten', sessionId: A }));
  fs.renameSync(`${file}.new`, file);
  const facts = reader.facts(file);
  assert.equal(facts.aiTitle, 'Rewritten');
  assert.equal(facts.customTitle, undefined, 'a replaced file is read again from the top');
  reader.prune(new Set());
});

test('allSessionIds: every session with a transcript, in any project; undefined when it can’t tell', () => {
  const claude = tempDir();
  const dir = projectDir(claude, '/Users/me/app');
  const other = projectDir(claude, '/Users/me/other');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(dir, `${A}.jsonl`), '');
  fs.writeFileSync(path.join(other, `${B}.jsonl`), '');
  fs.writeFileSync(path.join(other, 'notes.jsonl'), '');
  fs.mkdirSync(path.join(dir, C)); // a session's side folder, not a transcript
  fs.writeFileSync(path.join(claude, 'projects', 'stray-file'), '');
  assert.deepEqual([...(allSessionIds(claude) ?? [])].sort(), [A, B]);
  assert.equal(allSessionIds(path.join(claude, 'missing')), undefined);
});

test('renameSession appends a custom-title line like Claude Code, after any half-written line', async () => {
  const dir = tempDir();
  const file = path.join(dir, `${A}.jsonl`);
  fs.writeFileSync(file, line({ type: 'ai-title', aiTitle: 'Old', sessionId: A }));
  assert.equal(await renameSession(file, A, '  New   name  '), 'New name');
  const last = fs.readFileSync(file, 'utf8').trim().split('\n').pop() ?? '';
  assert.deepEqual(JSON.parse(last), { type: 'custom-title', sessionId: A, customTitle: 'New name' });
  await assert.rejects(renameSession(file, A, '   '), /empty/);
  await assert.rejects(renameSession(file, A, 'x'.repeat(201)), /200/);
  await assert.rejects(renameSession(file, 'nope', 'x'), /session id/);
  fs.appendFileSync(file, '{"type":"assistant","message":"partial'); // Claude mid-write
  setTimeout(() => fs.appendFileSync(file, '"}\n'), 120);
  await renameSession(file, A, 'After the write');
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(
    (JSON.parse(lines.at(-2) ?? '{}') as { type?: string }).type,
    'assistant',
    'the half-written line was completed first',
  );
  assert.equal((JSON.parse(lines.at(-1) ?? '{}') as { customTitle?: string }).customTitle, 'After the write');
  fs.appendFileSync(file, '{"stuck":');
  await assert.rejects(
    renameSession(file, A, 'Never', () => Promise.resolve()),
    /still writing/,
  );
});

test('sessionPaths finds everything that belongs to one session', () => {
  const claude = tempDir();
  const dir = projectDir(claude, '/Users/me/app');
  fs.mkdirSync(dir, { recursive: true });
  const made = [
    path.join(dir, `${A}.jsonl`),
    path.join(dir, A),
    path.join(claude, 'file-history', A),
    path.join(claude, 'session-env', A),
    path.join(claude, 'todos', `${A}-agent-1.json`),
  ];
  fs.writeFileSync(made[0] ?? '', '');
  for (const d of made.slice(1, 4)) fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(claude, 'todos'), { recursive: true });
  fs.writeFileSync(made[4] ?? '', '[]');
  fs.writeFileSync(path.join(claude, 'todos', `${B}-agent-1.json`), '[]');
  assert.deepEqual(sessionPaths(claude, dir, A).sort(), made.sort());
  assert.deepEqual(sessionPaths(claude, dir, '../../etc'), []);
});
