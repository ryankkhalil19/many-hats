// A copy is Claude Code's own fork: Many Hats builds its command line and checks what it wrote.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { checkCopy, copyName, defaultCopyName, forkArgs, MAX_COPY_NAME } from '../../src/claude/fork';
import { A, B, line, tempDir } from '../helpers/home';

const COPY = '44444444-4444-4444-8444-444444444444';
const chars = (s: string): number => Array.from(s).length;

test('fork: the name /rename gets is one trimmed line, not too long, never cutting a character', () => {
  assert.equal(copyName('  faceless\treels\n (copy)  '), 'faceless reels (copy)');
  assert.equal(copyName(' \n '), '');
  assert.equal(copyName('x'.repeat(500)).length, MAX_COPY_NAME);
  assert.equal(
    copyName(`${'a'.repeat(MAX_COPY_NAME - 1)} b`),
    'a'.repeat(MAX_COPY_NAME - 1),
    'no trailing space',
  );
  const emoji = copyName(`${'a'.repeat(MAX_COPY_NAME - 1)}🎬🎬`);
  assert.equal(chars(emoji), MAX_COPY_NAME);
  assert.ok(emoji.endsWith('🎬'), 'the emoji is kept whole, not split into half a character');
});

test('fork: the name a copy is offered always ends in (copy), however long the original’s', () => {
  assert.equal(defaultCopyName('faceless reels'), 'faceless reels (copy)');
  assert.equal(defaultCopyName('  two\n lines '), 'two lines (copy)');
  const long = defaultCopyName('t'.repeat(300));
  assert.equal(chars(long), MAX_COPY_NAME);
  assert.ok(long.endsWith(' (copy)'));
  assert.equal(copyName(long), long, 'and /rename takes it as it is');
  const spaced = defaultCopyName(`${'w '.repeat(60)}`);
  assert.ok(!spaced.includes('  '), 'no double space before the suffix');
});

test('fork: Claude Code resumes the original’s transcript into the new ID, named, with hooks and MCP servers off', () => {
  const file = `/home/me/.claude/projects/-code-app/${A}.jsonl`;
  assert.deepEqual(forkArgs(file, COPY, ' Plan  B '), [
    '-p',
    '/rename Plan B',
    '--resume',
    file,
    '--fork-session',
    '--session-id',
    COPY,
    '--strict-mcp-config',
    '--settings',
    '{"disableAllHooks":true}',
  ]);
});

test('fork: a copy passes when both its ends carry only the new ID, and says whether it was named', () => {
  const dir = tempDir();
  const file = path.join(dir, `${COPY}.jsonl`);
  const write = (...records: object[]): void => fs.writeFileSync(file, records.map((r) => line(r)).join(''));

  assert.deepEqual(checkCopy(file, A, COPY, 'x'), { ok: false, why: 'no copy was written' });
  write({ type: 'user', sessionId: COPY }, { type: 'custom-title', customTitle: 'Plan B', sessionId: COPY });
  assert.deepEqual(checkCopy(file, A, COPY, ' Plan  B'), { ok: true, named: true });
  assert.deepEqual(checkCopy(file, A, COPY, 'Other'), { ok: true, named: false });
  write({ type: 'user', sessionId: A });
  assert.deepEqual(checkCopy(file, A, COPY, 'x'), {
    ok: false,
    why: 'the copy still carries the original’s session ID',
  });
  write({ type: 'user', sessionId: B });
  assert.deepEqual(checkCopy(file, A, COPY, 'x'), {
    ok: false,
    why: 'the copy carries another session’s ID',
  });
  fs.writeFileSync(file, '{"type":"us');
  assert.deepEqual(checkCopy(file, A, COPY, 'x'), { ok: false, why: 'the copy has no conversation in it' });
  // Windows line endings: still whole records.
  fs.writeFileSync(file, `${JSON.stringify({ type: 'user', sessionId: COPY })}\r\n`);
  assert.deepEqual(checkCopy(file, A, COPY, 'x'), { ok: true, named: false });
});

test('fork: a big copy is checked from its two ends only', () => {
  const dir = tempDir();
  const file = path.join(dir, `${COPY}.jsonl`);
  const filler = line({ type: 'assistant', sessionId: COPY, text: 'x'.repeat(4000) });
  // Over a megabyte: the head and the tail are read, the middle never is.
  const middle = `${line({ type: 'user', sessionId: A })}`; // would fail if it were read
  fs.writeFileSync(
    file,
    filler.repeat(150) +
      middle +
      filler.repeat(150) +
      line({ type: 'custom-title', customTitle: 'Big', sessionId: COPY }),
  );
  assert.ok(fs.statSync(file).size > 1_000_000);
  assert.deepEqual(checkCopy(file, A, COPY, 'Big'), { ok: true, named: true });
  // A record at the end with another session's ID is read, and fails the check.
  fs.appendFileSync(file, line({ type: 'user', sessionId: B }));
  assert.equal(checkCopy(file, A, COPY, 'Big').ok, false);
});
