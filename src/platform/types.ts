/**
 * What Many Hats needs from the operating system. macOS is the one implementation today
 * (platform/darwin.ts); a Linux port implements this interface and nothing else changes.
 */

/** What decides a Claude process's account. Never a token: only whether one is there. */
export interface ProcessEnv {
  /** Its CLAUDE_CONFIG_DIR; undefined: the default ~/.claude. */
  configDir: string | undefined;
  /** Started through the Many Hats launcher. */
  viaLauncher: boolean;
  /**
   * Started with CLAUDE_CODE_OAUTH_TOKEN (the Claude desktop app does this): it runs on that
   * token's account whatever CLAUDE_CONFIG_DIR says.
   */
  tokenAuth: boolean;
  /** The account id given with the token (CLAUDE_CODE_ACCOUNT_UUID), lowercase. */
  tokenAccountUuid: string | undefined;
}

export interface Platform {
  readonly name: string;
  readonly supported: boolean;
  /** Pids of the claude processes a process started: by default this window's extension host. */
  claudeChildren(parentPid: number): Promise<number[]>;
  /** A process's account-relevant environment. A process's environment can't change, so it's read once per pid. */
  processEnv(pid: number): Promise<ProcessEnv | undefined>;
  forgetEnv(pid: number): void;
  pruneEnvCache(alive: ReadonlySet<number>): void;
  /** How many Claude processes, in any window or terminal, run on this config folder. */
  processesUsing(configDir: string): Promise<number>;
  /** Delete a config folder's stored login (the Keychain entry on macOS): a backstop after `claude auth logout`. */
  deleteStoredLogin(configDir: string): Promise<void>;
}
