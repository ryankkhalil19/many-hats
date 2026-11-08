import assert from 'node:assert/strict';
import test from 'node:test';
import { parseToHost } from '../../src/shared/protocol';
import { A } from '../helpers/home';

test('webview messages: the known ones pass, checked field by field', () => {
  assert.deepEqual(parseToHost({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(parseToHost({ type: 'open', id: A }), { type: 'open', id: A });
  assert.deepEqual(
    parseToHost({ type: 'open', id: A, account: 'work' }),
    { type: 'open', id: A },
    'a session opens on its own account: an account sent along is dropped',
  );
  for (const type of ['move', 'copy'])
    assert.deepEqual(parseToHost({ type, id: A, account: 'default' }), { type, id: A, account: 'default' });
  assert.deepEqual(parseToHost({ type: 'archive', id: A, archived: false }), {
    type: 'archive',
    id: A,
    archived: false,
  });
  assert.deepEqual(parseToHost({ type: 'rename', id: A, title: 'New' }), {
    type: 'rename',
    id: A,
    title: 'New',
  });
  assert.deepEqual(parseToHost({ type: 'notice', command: 'manyHats.repair' }), {
    type: 'notice',
    command: 'manyHats.repair',
  });
  assert.deepEqual(parseToHost({ type: 'copyId', id: A }), { type: 'copyId', id: A });
  for (const t of ['new', 'pick', 'signIn', 'removeAccount', 'refreshUsage'])
    assert.deepEqual(parseToHost({ type: t, account: 'work' }), { type: t, account: 'work' });
});

test('webview messages: anything else is dropped', () => {
  for (const m of [
    null,
    'ready',
    { type: 'eval', code: 'x' },
    { type: 'open', id: '../../etc' },
    { type: 'move', id: A },
    { type: 'copy', id: A },
    { type: 'copy', id: A, account: '../x' },
    { type: 'copy', account: 'work' },
    { type: 'new', account: 'Work' },
    { type: 'archive', id: A, archived: 'yes' },
    { type: 'rename', id: A, title: 'x'.repeat(1001) },
    { type: 'notice', command: 'workbench.action.terminal.sendSequence' },
    { type: 'delete' },
  ]) {
    assert.equal(parseToHost(m), undefined, JSON.stringify(m));
  }
});
