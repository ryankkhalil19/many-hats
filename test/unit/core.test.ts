import assert from 'node:assert/strict';
import test from 'node:test';
import { UserError, errnoCode, errorDetails, errorText } from '../../src/core/errors';
import {
  accountNameProblem,
  extraOrUndefined,
  isAccountName,
  isExtraAccountName,
  isSessionId,
} from '../../src/core/ids';
import { A } from '../helpers/home';

test('account names: lowercase, short, safe in a path; "default" is the main login', () => {
  for (const bad of ['', 'Work', '-x', '_x', 'a b', '../x', 'x'.repeat(33), '.backups', 'a/b', 'é']) {
    assert.ok(accountNameProblem(bad), `"${bad}" must be refused`);
    assert.equal(isExtraAccountName(bad), false, bad);
  }
  for (const good of ['work', 'personal-2', 'a_b', '9', 'x'.repeat(32)]) {
    assert.equal(accountNameProblem(good), undefined, good);
    assert.ok(isExtraAccountName(good));
  }
  assert.match(accountNameProblem('default') ?? '', /main Claude Code login/);
  assert.equal(isAccountName('default'), true);
  assert.equal(isExtraAccountName('default'), false);
  assert.equal(isAccountName(42), false);
  assert.equal(extraOrUndefined('default'), undefined);
  assert.equal(extraOrUndefined(null), undefined);
  assert.equal(extraOrUndefined('work'), 'work');
});

test('session ids: exactly a UUID, so they are safe as file names', () => {
  assert.ok(isSessionId(A));
  assert.ok(isSessionId(A.toUpperCase()));
  for (const bad of ['', 'not-an-id', `${A}/../x`, `${A}x`, '../../etc/passwd', 7])
    assert.equal(isSessionId(bad), false, String(bad));
});

test('errors: user errors and bugs read well', () => {
  const e = new UserError('Nope.');
  assert.equal(errorText(e), 'Nope.');
  assert.equal(e.name, 'UserError');
  assert.equal(errorText('plain'), 'plain');
  assert.equal(errorText({ a: 1 }), '{"a":1}');
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(errorText(circular), '[object Object]');
  assert.match(errorDetails(new Error('boom')), /Error: boom\n\s+at /);
  assert.equal(errorDetails('x'), 'x');
  assert.equal(errnoCode(Object.assign(new Error('x'), { code: 'ENOENT' })), 'ENOENT');
  assert.equal(errnoCode(new Error('x')), undefined);
});
