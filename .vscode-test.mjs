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

function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-it-')));
  const dirs = {
    home: path.join(base, 'home'),
    workspace: path.join(base, 'workspace'),
    claude: path.join(base, 'claude-default'),
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
    launchArgs: ['--disable-extension', 'anthropic.claude-code', '--disable-workspace-trust'],
  },
  {
    label: 'e2e',
    ...common(withClaude, 'stable'),
    installExtensions: ['anthropic.claude-code'],
    launchArgs: ['--disable-workspace-trust'],
  },
]);
