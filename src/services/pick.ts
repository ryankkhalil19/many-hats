/**
 * The account new Claude Code tabs in this window start on: "the pick".
 *
 * Claude Code starts each tab's claude process with this extension host's environment as it is at
 * that moment, so the pick is CLAUDE_CONFIG_DIR in this process's environment. Changing it affects
 * only tabs opened afterwards. The window's terminals get the same variable, so `claude` typed in
 * a terminal runs on the pick too.
 *
 * The pick is saved per window (state/picks.ts); a window with no folder keeps it in the editor's
 * per-window storage instead.
 */
import type { Picks } from '../state/picks';
import type { AccountStore } from '../state/accounts';
import { UserError } from '../core/errors';
import { extraOrUndefined } from '../core/ids';
import type { Logger } from '../infra/log';

export const NO_FOLDER_KEY = 'manyHats.pick';

export interface Memento {
  get(key: string): unknown;
  update(key: string, value: unknown): Thenable<void>;
}

export interface TerminalEnv {
  persistent: boolean;
  description: unknown;
  replace(variable: string, value: string): void;
  clear(): void;
}

export interface PickDeps {
  store: AccountStore;
  picks: Picks;
  /** This window's key: its .code-workspace file or first folder; undefined: no folder open. */
  windowKey: string | undefined;
  memento: Memento;
  env: NodeJS.ProcessEnv;
  terminalEnv?: TerminalEnv | undefined;
  log: Logger;
}

export class PickService {
  private current: string | undefined;
  private missingName: string | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: PickDeps) {}

  /** The extra account new tabs start on; undefined: the default. */
  get pick(): string | undefined {
    return this.current;
  }

  /** A saved pick whose account no longer exists (new tabs start on the default instead). */
  get missing(): string | undefined {
    return this.missingName;
  }

  /** Read the saved pick and apply it. Synchronous, so it runs before anything can start Claude. */
  init(): void {
    const { windowKey, picks, memento, store } = this.deps;
    const raw = windowKey ? picks.get(windowKey) : memento.get(NO_FOLDER_KEY);
    const saved = typeof raw === 'string' ? extraOrUndefined(raw) : undefined;
    if (saved && !store.exists(saved)) {
      this.missingName = saved;
      this.current = undefined;
    } else {
      this.current = saved;
    }
    this.apply();
  }

  /** CLAUDE_CONFIG_DIR for new tabs, here and in this window's terminals. */
  apply(): void {
    const { store, env, terminalEnv } = this.deps;
    env.MANY_HATS_DEFAULT_DIR = store.inherited ?? '';
    const dir = this.current ? store.dir(this.current) : store.inherited;
    if (dir) env.CLAUDE_CONFIG_DIR = dir;
    else delete env.CLAUDE_CONFIG_DIR;
    if (!terminalEnv) return;
    terminalEnv.persistent = true;
    if (this.current) {
      terminalEnv.replace('CLAUDE_CONFIG_DIR', store.dir(this.current));
      terminalEnv.description = `claude in this window's terminals runs on the "${this.current}" account (Many Hats)`;
    } else {
      terminalEnv.clear();
    }
  }

  /**
   * Point new tabs at another account until apply() runs again: for one tab, when the launcher
   * can't be used (someone else's process wrapper is set).
   */
  pointTemporarilyAt(account: string | undefined): void {
    const dir = this.deps.store.configDirOf(extraOrUndefined(account));
    if (dir) this.deps.env.CLAUDE_CONFIG_DIR = dir;
    else delete this.deps.env.CLAUDE_CONFIG_DIR;
  }

  /** @param name undefined or "default": the default account */
  async set(name: string | undefined): Promise<void> {
    const next = extraOrUndefined(name);
    if (next && !this.deps.store.exists(next)) throw new UserError(`There is no account "${next}".`);
    this.current = next;
    this.missingName = undefined;
    const { windowKey, picks, memento } = this.deps;
    if (windowKey) picks.set(windowKey, next);
    else await memento.update(NO_FOLDER_KEY, next);
    this.apply();
    this.deps.log.info(`new tabs in this window now start on ${next ?? 'default'}`);
    this.emit();
  }

  onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
