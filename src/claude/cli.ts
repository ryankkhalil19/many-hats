/**
 * The Claude Code CLI, used only for what the CLI itself does best: signing a config folder in
 * (`claude auth login`) and out (`claude auth logout`), its own /usage, and its own fork to copy a
 * session. Many Hats never handles a token.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * A background run shouldn't update Claude Code or send its analytics. MANY_HATS_BACKGROUND marks
 * it as Many Hats' own, so the scanner doesn't take it for a tab that skipped the launcher.
 */
export const QUIET_ENV = {
  MANY_HATS_BACKGROUND: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
} as const;

/** Environment variables that make Claude use a login other than its config folder's. */
export const LOGIN_OVERRIDE_VARS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_ACCOUNT_UUID',
  'CLAUDE_CODE_USER_EMAIL',
  'CLAUDE_CODE_ORGANIZATION_UUID',
  'CLAUDE_CODE_SUBSCRIPTION_TYPE',
  'CLAUDE_CODE_RATE_LIMIT_TIER',
] as const;

/**
 * The CLI to run: the one bundled with the Claude Code extension, else a usual install.
 * @param extensionPath the Claude Code extension's folder, if installed
 */
export function findClaudeBinary(home: string, extensionPath?: string): string | undefined {
  const candidates = [
    extensionPath && path.join(extensionPath, 'resources', 'native-binary', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'local', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  return candidates.find((p): p is string => {
    if (!p) return false;
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Arguments for /usr/bin/env that run the CLI on one config folder with no inherited login
 * override, so it signs in or out exactly that folder.
 * @param configDir undefined: the user's own ~/.claude
 */
export function cliEnvArgs(binary: string, configDir: string | undefined, args: readonly string[]): string[] {
  const unset = LOGIN_OVERRIDE_VARS.flatMap((v) => ['-u', v]);
  const dir = configDir ? [`CLAUDE_CONFIG_DIR=${configDir}`] : ['-u', 'CLAUDE_CONFIG_DIR'];
  return [...unset, ...dir, binary, ...args];
}

/** The same environment as an object, for running the CLI as a child process. */
export function cliEnv(base: NodeJS.ProcessEnv, configDir: string | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const v of LOGIN_OVERRIDE_VARS) delete env[v];
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  return env;
}
