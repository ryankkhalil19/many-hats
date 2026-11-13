/**
 * macOS: processes through `ps`, logins in the Keychain.
 *
 * `ps -E` prints a process's environment after its command line. It can read the environment of
 * the user's own processes (but not of Apple's platform binaries), which covers every claude
 * process an editor starts.
 */
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import type { Platform, ProcessEnv } from './types';
import type { Runner } from '../infra/exec';

const ENV_CACHE_MAX = 500;

/** Reads `ps -E` output for the variables that decide an account. A token's value is never kept. */
export function parseProcessEnv(command: string): ProcessEnv {
  const dir = /(?:^|\s)CLAUDE_CONFIG_DIR=(.*?)(?=\s[A-Za-z_][A-Za-z0-9_]*=|\s*$)/.exec(command);
  const uuid = /(?:^|\s)CLAUDE_CODE_ACCOUNT_UUID=([0-9a-fA-F-]{36})(?=\s|$)/.exec(command);
  return {
    configDir: dir?.[1] ? dir[1] : undefined,
    viaLauncher: /(?:^|\s)MANY_HATS_LAUNCHER=1(?=\s|$)/.test(command),
    background: /(?:^|\s)MANY_HATS_BACKGROUND=1(?=\s|$)/.test(command),
    tokenAuth: /(?:^|\s)CLAUDE_CODE_OAUTH_TOKEN=\S/.test(command),
    tokenAccountUuid: uuid?.[1]?.toLowerCase(),
  };
}

/** The Keychain service Claude Code stores a config folder's login under. */
export function keychainService(configDir: string | undefined): string {
  if (!configDir) return 'Claude Code-credentials';
  const hash = crypto.createHash('sha256').update(configDir.normalize('NFC')).digest('hex').slice(0, 8);
  return `Claude Code-credentials-${hash}`;
}

export class DarwinPlatform implements Platform {
  readonly name = 'macOS';
  readonly supported = true;
  private readonly envCache = new Map<number, ProcessEnv>();

  constructor(private readonly run: Runner) {}

  async claudeChildren(parentPid: number): Promise<number[]> {
    const table = await this.run('ps', ['-A', '-o', 'pid=,ppid=,comm=']);
    const pids: number[] = [];
    for (const line of table.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
      if (m && Number(m[2]) === parentPid && path.basename((m[3] ?? '').trim()) === 'claude')
        pids.push(Number(m[1]));
    }
    return pids;
  }

  async processEnv(pid: number): Promise<ProcessEnv | undefined> {
    const hit = this.envCache.get(pid);
    if (hit) return hit;
    let command: string;
    try {
      command = await this.run('ps', ['-E', '-ww', '-o', 'command=', '-p', String(pid)]);
    } catch {
      return undefined; // it exited meanwhile
    }
    if (!command.trim()) return undefined;
    const env = parseProcessEnv(command);
    this.envCache.set(pid, env);
    if (this.envCache.size > ENV_CACHE_MAX) {
      const oldest = this.envCache.keys().next().value;
      if (oldest !== undefined) this.envCache.delete(oldest);
    }
    return env;
  }

  forgetEnv(pid: number): void {
    this.envCache.delete(pid);
  }

  pruneEnvCache(alive: ReadonlySet<number>): void {
    for (const pid of this.envCache.keys()) if (!alive.has(pid)) this.envCache.delete(pid);
  }

  async processesUsing(configDir: string): Promise<number> {
    const table = await this.run('ps', ['-A', '-o', 'pid=,comm=']);
    const target = path.resolve(configDir);
    let count = 0;
    for (const line of table.split('\n')) {
      const m = /^\s*(\d+)\s+(.+)$/.exec(line);
      if (!m || path.basename((m[2] ?? '').trim()) !== 'claude') continue;
      const env = await this.processEnv(Number(m[1]));
      if (env?.configDir && path.resolve(env.configDir) === target) count++;
    }
    return count;
  }

  async deleteStoredLogin(configDir: string): Promise<void> {
    // Named after this folder, so it can't be another login's entry. Missing is fine.
    await this.run('security', ['delete-generic-password', '-s', keychainService(configDir)]).catch(
      () => undefined,
    );
  }
}
