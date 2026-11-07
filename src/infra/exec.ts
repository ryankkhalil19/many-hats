/** Running other programs: always with a timeout and a bounded output, never through a shell. */
import * as cp from 'node:child_process';

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cwd?: string;
}

export type Runner = (file: string, args: readonly string[], options?: RunOptions) => Promise<string>;

export const run: Runner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    cp.execFile(
      file,
      args,
      {
        timeout: options.timeoutMs ?? 15000,
        maxBuffer: 16 * 1024 * 1024,
        env: options.env,
        cwd: options.cwd,
        windowsHide: true,
      },
      (err, stdout) => {
        if (err) reject(err instanceof Error ? err : new Error(`${file} failed`));
        else resolve(String(stdout));
      },
    );
  });
