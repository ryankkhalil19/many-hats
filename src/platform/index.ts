import { DarwinPlatform } from './darwin';
import type { Platform, ProcessEnv } from './types';
import type { Runner } from '../infra/exec';

export type { Platform, ProcessEnv };

/** A platform Many Hats doesn't support yet: it lists nothing and changes nothing. */
class UnsupportedPlatform implements Platform {
  readonly supported = false;
  constructor(readonly name: string) {}
  claudeChildren(): Promise<number[]> {
    return Promise.resolve([]);
  }
  processEnv(): Promise<ProcessEnv | undefined> {
    return Promise.resolve(undefined);
  }
  forgetEnv(): void {}
  pruneEnvCache(): void {}
  processesUsing(): Promise<number> {
    return Promise.resolve(0);
  }
  deleteStoredLogin(): Promise<void> {
    return Promise.resolve();
  }
}

export function platformFor(os: NodeJS.Platform, run: Runner): Platform {
  return os === 'darwin' ? new DarwinPlatform(run) : new UnsupportedPlatform(os);
}
