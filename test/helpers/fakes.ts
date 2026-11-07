/** Stand-ins for the operating system and the editor, for service tests. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Platform, ProcessEnv } from '../../src/platform/types';
import type { ClaudeTabs, Trash } from '../../src/services/sessions';

export class FakePlatform implements Platform {
  readonly name = 'test';
  readonly supported = true;
  children: number[] = [];
  envs = new Map<number, ProcessEnv>();
  deletedLogins: string[] = [];
  usersOf = new Map<string, number>();

  env(pid: number, env: Partial<ProcessEnv>): void {
    this.envs.set(pid, {
      configDir: undefined,
      viaLauncher: true,
      tokenAuth: false,
      tokenAccountUuid: undefined,
      ...env,
    });
  }
  claudeChildren(): Promise<number[]> {
    return Promise.resolve([...this.children]);
  }
  processEnv(pid: number): Promise<ProcessEnv | undefined> {
    return Promise.resolve(this.envs.get(pid));
  }
  forgetEnv(): void {}
  pruneEnvCache(): void {}
  processesUsing(dir: string): Promise<number> {
    return Promise.resolve(this.usersOf.get(dir) ?? 0);
  }
  deleteStoredLogin(dir: string): Promise<void> {
    this.deletedLogins.push(dir);
    return Promise.resolve();
  }
}

/** Claude Code's "open a tab" command; onOpen lets a test start a fake process. */
export class FakeTabs implements ClaudeTabs {
  opened: (string | undefined)[] = [];
  onOpen: (sessionId?: string) => void = () => {};
  open(sessionId?: string): Promise<void> {
    this.opened.push(sessionId);
    this.onOpen(sessionId);
    return Promise.resolve();
  }
}

/** Moves things into a trash folder, like the editor does. */
export class FakeTrash implements Trash {
  trashed: string[] = [];
  constructor(private readonly dir: string) {}
  trash(p: string): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.renameSync(p, path.join(this.dir, `${this.trashed.length}-${path.basename(p)}`));
    this.trashed.push(p);
    return Promise.resolve();
  }
}

export const noSleep = (): Promise<void> => Promise.resolve();
