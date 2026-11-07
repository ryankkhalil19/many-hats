import assert from 'node:assert/strict';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { isTempFile, sweepTempFiles, writeFileAtomic } from '../../src/infra/atomicFile';
import { run } from '../../src/infra/exec';
import { isWithin, readJsonOrUndefined, readTextOrUndefined } from '../../src/infra/fsx';
import { redactingLogger } from '../../src/infra/log';
import { redact } from '../../src/infra/redact';
import { age, tempDir } from '../helpers/home';

test('writeFileAtomic: private by default, folders created 0700, no temp file left', () => {
  const dir = tempDir();
  const file = path.join(dir, 'deep', 'er', 'record');
  writeFileAtomic(file, 'one\n');
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  writeFileAtomic(file, Buffer.from('two\n'), { mode: 0o644 });
  assert.equal(fs.readFileSync(file, 'utf8'), 'two\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['record']);
});

test('writeFileAtomic: a failed write leaves the old file and no temp file', () => {
  const dir = tempDir();
  const file = path.join(dir, 'record');
  writeFileAtomic(file, 'old\n');
  fs.mkdirSync(path.join(dir, 'blocker'));
  // Renaming a file over a non-empty folder fails.
  fs.writeFileSync(path.join(dir, 'blocker', 'x'), '');
  assert.throws(() => writeFileAtomic(path.join(dir, 'blocker'), 'new'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'old\n');
  assert.deepEqual(fs.readdirSync(dir).filter(isTempFile), []);
});

test('many writers at once: every read sees a whole file', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'record');
  const script = `
    const { writeFileAtomic } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'src', 'infra', 'atomicFile.ts'))});
    for (let i = 0; i < 150; i++) writeFileAtomic(${JSON.stringify(file)}, (i % 2 ? 'dev' : 'work') + ' moved 2026-11-06T22:00:00.000Z\\n');`;
  const writers = [1, 2, 3].map(() =>
    cp.spawn(process.execPath, ['--import', 'tsx', '-e', script], { stdio: 'inherit' }),
  );
  let finished = false;
  const done = Promise.all(writers.map((w) => new Promise((r) => w.on('exit', r)))).then(
    () => (finished = true),
  );
  let reads = 0;
  let bad = 0;
  while (!finished) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      reads++;
      if (!/^(dev|work) moved \S+\n$/.test(text)) bad++;
    } catch {
      // not written yet
    }
    await new Promise((r) => setImmediate(r));
  }
  await done;
  assert.equal(bad, 0, `${bad} partial reads out of ${reads}`);
  assert.ok(reads > 0);
  assert.deepEqual(fs.readdirSync(dir), ['record'], 'no temp files left');
});

test('sweepTempFiles removes only stale temp files', () => {
  const dir = tempDir();
  const stale = path.join(dir, '.record.123.abcdef01.tmp');
  const fresh = path.join(dir, '.record.456.abcdef02.tmp');
  fs.writeFileSync(stale, '');
  fs.writeFileSync(fresh, '');
  fs.writeFileSync(path.join(dir, 'record'), '');
  age(stale, 2 * 3600e3);
  assert.equal(sweepTempFiles(dir), 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.record.456.abcdef02.tmp', 'record']);
  assert.equal(sweepTempFiles(path.join(dir, 'missing')), 0);
});

test('fsx: reads that never throw, size limits, containment', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'a.json'), '{"x":1}');
  fs.writeFileSync(path.join(dir, 'bad.json'), '{x');
  assert.deepEqual(readJsonOrUndefined(path.join(dir, 'a.json')), { x: 1 });
  assert.equal(readJsonOrUndefined(path.join(dir, 'bad.json')), undefined);
  assert.equal(readJsonOrUndefined(path.join(dir, 'missing.json')), undefined);
  assert.equal(readTextOrUndefined(path.join(dir, 'a.json'), 3), '{"x');
  assert.equal(isWithin(dir, path.join(dir, 'a', 'b')), true);
  assert.equal(isWithin(dir, dir), true);
  assert.equal(isWithin(dir, path.join(dir, '..', 'x')), false);
  assert.equal(isWithin(dir, `${dir}-sibling`), false);
});

test('redact: emails, tokens and the home folder never leave in a report', () => {
  const home = '/Users/someone';
  const text = [
    'signed in as me@example.com',
    'token sk-ant-oat01-AbCdEf123456 and ghp_abcdefghijklmnopqrstuvwxyz0123',
    // Built from parts so the repository holds no token-shaped string.
    `jwt ${['eyJhbGciOiJub25lIn0', 'eyJ0ZXN0IjoibWFueS1oYXRzIn0', 'c2lnbmF0dXJlLWZvci10ZXN0cw'].join('.')}`,
    'api_key=supersecretvalue123',
    'path /Users/someone/.many-hats/accounts/work and /Users/someoneelse/x',
  ].join('\n');
  const out = redact(text, home);
  assert.doesNotMatch(out, /me@example\.com|sk-ant-oat01-AbCdEf|ghp_abc|eyJhbGci|supersecretvalue/);
  assert.match(out, /<email>/);
  assert.match(out, /~\/\.many-hats\/accounts\/work/);
  assert.match(out, /\/Users\/someoneelse\/x/, 'a longer user name is not the home folder');
  const lines: string[] = [];
  const log = redactingLogger({
    debug: (m) => lines.push(m),
    info: (m) => lines.push(m),
    warn: (m) => lines.push(m),
    error: (m) => lines.push(m),
  });
  log.info('hello me@example.com');
  log.error('sk-ant-api03-zzzzzzzz');
  assert.deepEqual(lines, ['hello <email>', '<redacted>']);
});

test('run: output on success, an error with a timeout', async () => {
  assert.equal((await run('/bin/echo', ['hi'])).trim(), 'hi');
  await assert.rejects(run('/bin/sleep', ['5'], { timeoutMs: 100 }));
  await assert.rejects(run('/definitely/not/here', []));
});
