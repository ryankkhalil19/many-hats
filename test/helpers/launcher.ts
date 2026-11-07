/** A fake home with the launcher installed and a fake Claude binary that reports how it was started. */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { installLauncher } from '../../src/services/launcher';
import { layoutFor, type Layout } from '../../src/state/layout';
import { tempDir } from './home';

export const SCRIPT = fs.readFileSync(
  path.join(__dirname, '..', '..', 'src', 'launcher', 'launcher.sh'),
  'utf8',
);

export interface Rig {
  home: string;
  layout: Layout;
  claude: string;
  dev: string;
  logFile: string;
  assign(id: string, line: string): void;
}

export function rig(): Rig {
  const home = tempDir('many-hats-launch-');
  const layout = layoutFor(home);
  const dev = path.join(layout.accountsDir, 'dev');
  fs.mkdirSync(dev, { recursive: true }); // all the launcher checks: the folder is there
  installLauncher(layout, SCRIPT);
  const claude = path.join(home, 'bundled', 'claude');
  fs.mkdirSync(path.dirname(claude));
  fs.writeFileSync(
    claude,
    [
      '#!/bin/sh',
      'echo "CONFIG=${CLAUDE_CONFIG_DIR-<unset>}"',
      'echo "LAUNCHER=${MANY_HATS_LAUNCHER-}"',
      'echo "TOKEN=${CLAUDE_CODE_OAUTH_TOKEN-<unset>}"',
      'echo "IDENTITY=${CLAUDE_CODE_ACCOUNT_UUID-<unset>}/${CLAUDE_CODE_USER_EMAIL-<unset>}/${CLAUDE_CODE_ORGANIZATION_UUID-<unset>}"',
      'echo "PID=$$"',
      'for a in "$@"; do echo "ARG=$a"; done',
      'exit "${FAKE_EXIT:-0}"',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  return {
    home,
    layout,
    claude,
    dev,
    logFile: layout.launcherLog,
    assign: (id, text) => {
      fs.mkdirSync(layout.assignmentsDir, { recursive: true });
      fs.writeFileSync(path.join(layout.assignmentsDir, id), text);
    },
  };
}

export function launch(
  t: Rig,
  args: string[],
  env: Record<string, string> = {},
  input?: string,
): { status: number | null; out: string; err: string } {
  const r = spawnSync(t.layout.launcher, args, {
    env: { PATH: '/usr/bin:/bin', HOME: t.home, ...env },
    encoding: 'utf8',
    input,
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}
