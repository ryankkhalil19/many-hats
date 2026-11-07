/**
 * The accounts: "default" (the user's own Claude Code login: ~/.claude, or the CLAUDE_CONFIG_DIR
 * the editor was started with) and the extra accounts under ~/.many-hats/accounts.
 *
 * Logins: Claude Code names its macOS Keychain entry after the config folder, so each account
 * folder gets its own login and no token is ever copied or read.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Layout } from './layout';
import type { ProcessEnv } from '../platform/types';
import { isAccountBoundKey } from '../claude/configFiles';
import { profileFromConfig, type Profile } from '../claude/profile';
import type { Compat } from '../claude/compat';
import { UserError } from '../core/errors';
import { DEFAULT_ACCOUNT, accountNameProblem, isExtraAccountName } from '../core/ids';
import { writeFileAtomic } from '../infra/atomicFile';
import {
  ensureDir,
  isRecord,
  isWithin,
  lstatOrUndefined,
  readDirOrEmpty,
  readJsonOrUndefined,
} from '../infra/fsx';

const META_FILE = '.many-hats.json';
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

export interface AccountStoreOptions {
  layout: Layout;
  /** A CLAUDE_CONFIG_DIR the editor itself was started with; it then plays ~/.claude's part. */
  inheritedConfigDir?: string | undefined;
  compat?: Compat;
}

export class AccountStore {
  readonly layout: Layout;
  readonly home: string;
  /** The default account's config folder when it isn't ~/.claude. */
  readonly inherited: string | undefined;
  /** The default account's config folder. */
  readonly defaultDir: string;
  /** The file holding the default account's identity. */
  readonly defaultConfig: string;
  private readonly compat: Compat | undefined;

  constructor(options: AccountStoreOptions) {
    this.layout = options.layout;
    this.home = options.layout.home;
    this.compat = options.compat;
    const inherited = options.inheritedConfigDir ? path.resolve(options.inheritedConfigDir) : undefined;
    // An editor started from a terminal running one of our accounts would otherwise make that
    // account the default: ignore it.
    this.inherited = inherited && !isWithin(this.layout.accountsDir, inherited) ? inherited : undefined;
    this.defaultDir = this.inherited ?? path.join(this.home, '.claude');
    this.defaultConfig = this.inherited
      ? path.join(this.inherited, '.claude.json')
      : path.join(this.home, '.claude.json');
  }

  /** Why a name can't be used for a new account, or undefined. */
  nameProblem(name: string): string | undefined {
    return (
      accountNameProblem(name) ??
      (this.exists(name) ? `There's already an account called "${name}".` : undefined)
    );
  }

  /** An extra account's folder. */
  dir(name: string): string {
    if (!isExtraAccountName(name)) throw new UserError(`"${name as string}" isn't an account name.`);
    return path.join(this.layout.accountsDir, name);
  }

  /** An extra account is a folder with a valid name and its own .claude.json. */
  exists(name: string): boolean {
    if (!isExtraAccountName(name)) return false;
    const dir = path.join(this.layout.accountsDir, name);
    return (
      lstatOrUndefined(dir)?.isDirectory() === true &&
      lstatOrUndefined(path.join(dir, '.claude.json'))?.isFile() === true
    );
  }

  /** "default" or an extra account that exists. */
  usable(name: string): boolean {
    return name === DEFAULT_ACCOUNT || this.exists(name);
  }

  /** The extra accounts, by name. */
  list(): string[] {
    return readDirOrEmpty(this.layout.accountsDir)
      .filter((n) => this.exists(n))
      .sort();
  }

  /** CLAUDE_CONFIG_DIR for an account; undefined: the default without an inherited folder. */
  configDirOf(name: string | undefined): string | undefined {
    return name && name !== DEFAULT_ACCOUNT ? this.dir(name) : this.inherited;
  }

  /** The .claude.json holding an account's identity. */
  configFile(name?: string): string {
    return name && name !== DEFAULT_ACCOUNT ? path.join(this.dir(name), '.claude.json') : this.defaultConfig;
  }

  readConfig(name?: string): unknown {
    return readJsonOrUndefined(this.configFile(name), 32 * 1024 * 1024);
  }

  profile(name?: string): Profile {
    return profileFromConfig(this.readConfig(name), this.compat);
  }

  /** The email an account should sign in as, given when it was added. */
  expectedEmail(name?: string): string | undefined {
    if (!name || name === DEFAULT_ACCOUNT || !this.exists(name)) return undefined;
    const meta = readJsonOrUndefined(path.join(this.dir(name), META_FILE), 64 * 1024);
    const email = isRecord(meta) ? meta.email : undefined;
    return typeof email === 'string' && EMAIL_RE.test(email) ? email : undefined;
  }

  setExpectedEmail(name: string, email: string): void {
    if (!this.exists(name)) throw new UserError(`There is no account "${name}".`);
    const v = email.trim();
    if (!EMAIL_RE.test(v)) throw new UserError('That doesn’t look like an email address.');
    writeFileAtomic(path.join(this.dir(name), META_FILE), `${JSON.stringify({ email: v }, null, 2)}\n`);
  }

  /** Which account a config folder is; undefined: not one of these accounts. */
  accountOfConfigDir(configDir: string | undefined): string | undefined {
    if (!configDir) return this.inherited ? undefined : DEFAULT_ACCOUNT;
    const resolved = path.resolve(configDir);
    if (resolved === path.resolve(this.defaultDir)) return DEFAULT_ACCOUNT;
    const rel = path.relative(this.layout.accountsDir, resolved);
    return rel && !rel.includes(path.sep) && isExtraAccountName(rel) ? rel : undefined;
  }

  /**
   * Which account a Claude process runs on. A process given a login token (the Claude desktop
   * app does this) runs on that token's account whatever its CLAUDE_CONFIG_DIR says, and is
   * known only by its account id.
   * @param byUuid account id → account name, for token-started processes
   */
  accountOfEnv(env: ProcessEnv, byUuid?: ReadonlyMap<string, string>): string | undefined {
    if (env.tokenAuth) return env.tokenAccountUuid ? byUuid?.get(env.tokenAccountUuid) : undefined;
    return this.accountOfConfigDir(env.configDir);
  }

  /** account id → account name, for every signed-in account. */
  accountsByUuid(): Map<string, string> {
    const out = new Map<string, string>();
    for (const name of [DEFAULT_ACCOUNT, ...this.list()]) {
      const uuid = this.profile(name === DEFAULT_ACCOUNT ? undefined : name).accountUuid;
      if (uuid && !out.has(uuid)) out.set(uuid, name);
    }
    return out;
  }

  /**
   * A new account's folder with an identity-free .claude.json: the default login's app state
   * (onboarding, finished migrations, per-project trust, MCP servers), never its identity, keys
   * or anything cached for its plan or organization. Linking the shared entries is ConfigSync's job.
   */
  createFolder(name: string): { dir: string; seededKeys: number } {
    const problem = this.nameProblem(name);
    if (problem) throw new UserError(problem);
    const dir = path.join(this.layout.accountsDir, name);
    if (lstatOrUndefined(dir))
      throw new UserError(`${dir} already exists. Remove it or choose another name.`);
    ensureDir(this.layout.accountsDir);
    fs.mkdirSync(dir, { mode: 0o700 });
    const seed: Record<string, unknown> = {};
    const source = readJsonOrUndefined(this.defaultConfig, 32 * 1024 * 1024);
    if (isRecord(source)) {
      for (const [key, value] of Object.entries(source)) if (!isAccountBoundKey(key)) seed[key] = value;
    }
    fs.writeFileSync(path.join(dir, '.claude.json'), `${JSON.stringify(seed, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    });
    return { dir, seededKeys: Object.keys(seed).length };
  }
}
