/**
 * Running other programs: always with a timeout and a bounded output, never through a shell, and
 * with nothing on their input.
 */
import * as cp from 'node:child_process';

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  cwd?: string;
  /** Stops the program (SIGTERM) when aborted; the run then fails with an AbortError. */
  signal?: AbortSignal;
}

export type Runner = (file: string, args: readonly string[], options?: RunOptions) => Promise<string>;

export const run: Runner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = cp.execFile(
      file,
      args,
      {
        timeout: options.timeoutMs ?? 15000,
        maxBuffer: 16 * 1024 * 1024,
        env: options.env,
        cwd: options.cwd,
        signal: options.signal,
        windowsHide: true,
      },
      (err, stdout) => {
        if (err) reject(err instanceof Error ? err : new Error(`${file} failed`));
        else resolve(String(stdout));
      },
    );
    // Nothing is ever written to a child's input. Closing it at once spares a program that reads
    // it a wait: Claude Code's `-p` waits 3 seconds for input that would never come.
    child.stdin?.end();
  });
