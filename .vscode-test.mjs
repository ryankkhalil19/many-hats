// Tests in a real VS Code (npm run test:integration; npm run test:e2e for the end-to-end run).
// Everything runs against a throwaway home and Claude config folder, so it never touches your
// accounts: CLAUDE_CONFIG_DIR points the default account at an empty folder with no login.
//
//   integration  Many Hats alone (Claude Code disabled): activation, commands, sidebar, setup checks.
//                Reliable anywhere, including CI.
//   e2e          With the real Claude Code extension, signed out: opens real Claude Code tabs and
//                checks in the launcher's log which account each started on. Downloads Claude Code.
import { defineConfig } from '@vscode/test-cli';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Earlier runs: a Claude process that outlives its test editor can write a few files back after
// the cleanup below, so sandboxes over an hour old are swept when the next run starts.
for (const name of fs.readdirSync(os.tmpdir())) {
  if (!name.startsWith('many-hats-it-')) continue;
  const dir = path.join(os.tmpdir(), name);
  try {
    if (Date.now() - fs.statSync(dir).mtimeMs > 3600e3) fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // gone already
  }
}

const sandboxes = [];
// Removed after a passing run; kept after a failing one, with the editor's profile and logs.
process.on('exit', (code) => {
  for (const base of sandboxes) {
    if (code === 0) fs.rmSync(base, { recursive: true, force: true });
    else console.log(`Kept the test sandbox for a look: ${base}`);
  }
});

function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-it-')));
  sandboxes.push(base);
  const dirs = {
    home: path.join(base, 'home'),
    workspace: path.join(base, 'workspace'),
    claude: path.join(base, 'claude-default'),
    // A fresh editor profile for every run. The shared default (.vscode-test/user-data) keeps an
    // earlier run's settings, such as Claude Code's process wrapper pointing at that run's
    // launcher, which Many Hats rightly leaves alone as another program's.
    userData: path.join(base, 'user-data'),
  };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return dirs;
}

const common = (dirs, version) => ({
  files: 'out/integration/**/*.test.js',
  version: process.env.VSCODE_VERSION ?? version,
  workspaceFolder: dirs.workspace,
  // HOME stays the real one: the editor needs it (its keychain, for one). Many Hats uses MANY_HATS_HOME.
  env: { MANY_HATS_HOME: dirs.home, CLAUDE_CONFIG_DIR: dirs.claude, MANY_HATS_TEST: '1' },
  mocha: { ui: 'tdd', timeout: 60_000 },
});

const alone = sandbox();
const withClaude = sandbox();

export default defineConfig([
  // The oldest VS Code Many Hats supports (package.json engines), so no newer API slips in.
  {
    label: 'integration',
    ...common(alone, '1.96.0'),
    launchArgs: [
      `--user-data-dir=${alone.userData}`,
      '--disable-extension',
      'anthropic.claude-code',
      '--disable-workspace-trust',
    ],
  },
  {
    label: 'e2e',
    ...common(withClaude, 'stable'),
    installExtensions: ['anthropic.claude-code'],
    launchArgs: [`--user-data-dir=${withClaude.userData}`, '--disable-workspace-trust'],
  },
]);
