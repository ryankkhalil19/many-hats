import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import test from 'node:test';
import { editorOf, userSettingsDir } from '../../src/uninstall/editors';
import { runUninstallHook } from '../../src/uninstall';
import { removeWrapperFrom, settingsFiles, withoutWrapper } from '../../src/uninstall/settings';
import { layoutFor } from '../../src/state/layout';
import { tempDir } from '../helpers/home';

const OURS = '/Users/me/.many-hats/bin/launcher';

test('which editor an installed extension belongs to', () => {
  const home = '/Users/me';
  assert.equal(
    editorOf('/Users/me/.cursor/extensions/ryankkhalil19.many-hats-1.0.0-darwin-arm64/dist', home),
    'Cursor',
  );
  assert.equal(editorOf('/Users/me/.vscode/extensions/ryankkhalil19.many-hats-1.0.0/dist', home), 'Code');
  assert.equal(editorOf('/Users/me/.vscode-oss/extensions/x/dist', home), 'VSCodium');
  assert.equal(editorOf('/Users/me/.unknown/extensions/x', home), undefined);
  assert.equal(editorOf('/opt/elsewhere/x', home), undefined);
  assert.equal(editorOf('/Users/me/.cursor/not-extensions/x', home), undefined);
  assert.equal(userSettingsDir('Cursor', home), '/Users/me/Library/Application Support/Cursor/User');
});

test('withoutWrapper: removes only our setting and keeps comments and formatting', () => {
  const text = `{
    // my settings
    "editor.fontSize": 13,
    "claudeCode.claudeProcessWrapper": "${OURS}", // set by Many Hats
    "files.autoSave": "afterDelay",
}
`;
  const out = withoutWrapper(text, [OURS]);
  assert.ok(out);
  assert.doesNotMatch(out, /claudeProcessWrapper/);
  assert.match(out, /\/\/ my settings/);
  assert.match(out, /"files\.autoSave": "afterDelay"/);
  assert.match(out, /\n {4}"editor\.fontSize": 13,/, 'indentation kept');
  assert.equal(
    withoutWrapper(text.replace(OURS, '/usr/local/bin/their-wrapper'), [OURS]),
    undefined,
    'someone else’s wrapper stays',
  );
  assert.equal(withoutWrapper('{ "a": 1 }', [OURS]), undefined, 'nothing to do');
  assert.equal(
    withoutWrapper('{ "claudeCode.claudeProcessWrapper": "' + OURS + '", oops', [OURS]),
    undefined,
    'a broken file is left exactly as it is',
  );
  assert.equal(withoutWrapper('[]', [OURS]), undefined);
  const tabs = `{\n\t"claudeCode.claudeProcessWrapper": "${OURS}",\n\t"a": 1\n}\n`;
  assert.equal(withoutWrapper(tabs, [OURS]), '{\n\t"a": 1\n}\n');
});

test('the uninstall hook unhooks Claude Code in that editor only, in every profile', () => {
  const home = tempDir();
  const launcher = layoutFor(home).launcher;
  const cursor = userSettingsDir('Cursor', home);
  const code = userSettingsDir('Code', home);
  fs.mkdirSync(path.join(cursor, 'profiles', 'p1'), { recursive: true });
  fs.mkdirSync(code, { recursive: true });
  const setting = `{\n  "claudeCode.claudeProcessWrapper": "${launcher}",\n  "x": 1\n}\n`;
  fs.writeFileSync(path.join(cursor, 'settings.json'), setting, { mode: 0o600 });
  fs.writeFileSync(path.join(cursor, 'profiles', 'p1', 'settings.json'), setting);
  fs.writeFileSync(path.join(code, 'settings.json'), setting);
  assert.equal(settingsFiles(cursor).length, 2);
  const extensionFile = path.join(
    home,
    '.cursor',
    'extensions',
    'ryankkhalil19.many-hats-1.0.0-darwin-arm64',
    'dist',
  );
  const out = runUninstallHook(extensionFile, home);
  assert.equal(out.length, 2);
  for (const f of [
    path.join(cursor, 'settings.json'),
    path.join(cursor, 'profiles', 'p1', 'settings.json'),
  ]) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /claudeProcessWrapper/);
    assert.match(fs.readFileSync(f, 'utf8'), /"x": 1/);
  }
  assert.equal(fs.statSync(path.join(cursor, 'settings.json')).mode & 0o777, 0o600, 'mode kept');
  assert.match(
    fs.readFileSync(path.join(code, 'settings.json'), 'utf8'),
    /claudeProcessWrapper/,
    'VS Code still has Many Hats installed: untouched',
  );
  assert.deepEqual(runUninstallHook(extensionFile, home), [], 'running it again changes nothing');
  assert.match(runUninstallHook('/somewhere/else', home)[0] ?? '', /unknown editor/);
  assert.equal(removeWrapperFrom(path.join(home, 'missing.json'), [launcher]), false);
});

test('the bundled hook runs with plain Node and never fails', () => {
  const dist = path.join(__dirname, '..', '..', 'dist', 'uninstall.js');
  if (!fs.existsSync(dist)) return; // built by `npm run build`
  const home = tempDir();
  const r = spawnSync(process.execPath, [dist], { env: { HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /unknown editor/, 'run from the repo, it is not in any editor');
});
