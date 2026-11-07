/** Fake homes and other shared fixtures. Tests never touch the real ~/.claude or ~/.many-hats. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ConfigSync } from '../../src/services/configSync';
import { AccountStore } from '../../src/state/accounts';
import { layoutFor, type Layout } from '../../src/state/layout';
import type { Logger } from '../../src/infra/log';

export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';
export const C = '33333333-3333-4333-8333-333333333333';
export const D = '44444444-4444-4444-8444-444444444444';
export const DAY = 24 * 3600e3;

/** The folders tempDir made in this test process: removed when it exits (MANY_HATS_KEEP_TMP=1 keeps them). */
const made: string[] = [];

export function tempDir(prefix = 'many-hats-test-'): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  if (!made.length) process.on('exit', removeTempDirs);
  made.push(dir);
  return dir;
}

function removeTempDirs(): void {
  if (process.env.MANY_HATS_KEEP_TMP) return;
  for (const dir of made) removeTree(dir);
}

/** Removes a folder, first making writable what fault-injection tests locked (never following links). */
function removeTree(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch {
    // A locked folder inside: open it up below.
  }
  const open = (p: string): void => {
    try {
      fs.chmodSync(p, 0o700);
      for (const e of fs.readdirSync(p, { withFileTypes: true }))
        if (e.isDirectory()) open(path.join(p, e.name));
    } catch {
      // Gone already, or not ours to change.
    }
  };
  open(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Left for the system's temp-folder cleanup.
  }
}

export interface FakeHome {
  home: string;
  claude: string;
  layout: Layout;
  store: AccountStore;
  sync: ConfigSync;
  /** Create an account folder and link it, as the extension does. */
  addAccount(name: string, email?: string): string;
}

/** A fake home whose ~/.claude looks like a real one. */
export function fakeHome(options: { inherited?: string } = {}): FakeHome {
  const home = tempDir();
  const claude = path.join(home, '.claude');
  for (const d of [
    'projects/-Users-me-app',
    'skills/synced/org_user',
    'plugins',
    'cache',
    'telemetry',
    'backups',
    '.cc-writes',
    'ide',
    'sessions',
  ]) {
    fs.mkdirSync(path.join(claude, d), { recursive: true });
  }
  const files: Record<string, string> = {
    'CLAUDE.md': '# my rules\n',
    'settings.json': '{"model":"opus"}\n',
    'history.jsonl': '{"display":"hi"}\n',
    'projects/-Users-me-app/s1.jsonl': 'session\n',
    '.claude.json': '{}',
    'policy-limits.json': '{}',
    'remote-settings.json.synced-at': '1',
    'mcp-needs-auth-cache.json': '{}',
    '.last-cleanup': '1',
    '.DS_Store': '',
  };
  for (const [f, body] of Object.entries(files)) fs.writeFileSync(path.join(claude, f), body);
  fs.writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({
      oauthAccount: {
        emailAddress: 'me@example.com',
        organizationName: 'Me Inc',
        accountUuid: 'AAAAAAAA-0000-4000-8000-000000000001',
      },
      userID: 'u1',
      primaryApiKey: 'sk-test',
      cachedGrowthBookFeatures: { x: 1 },
      modelAccessCache: {},
      hasAvailableSubscription: true,
      numStartups: 9,
      projects: { '/Users/me/app': { hasTrustDialogAccepted: true } },
      mcpServers: { tool: { command: 'tool' } },
      hasCompletedOnboarding: true,
      migrationVersion: 7,
      opusProMigrationComplete: true,
      tipsHistory: { a: 1 },
    }),
  );
  const layout = layoutFor(home);
  const store = new AccountStore({ layout, inheritedConfigDir: options.inherited });
  const sync = new ConfigSync(store);
  return {
    home,
    claude,
    layout,
    store,
    sync,
    addAccount(name: string, email?: string): string {
      store.createFolder(name);
      sync.sync(name);
      if (email)
        fs.writeFileSync(store.configFile(name), JSON.stringify({ oauthAccount: { emailAddress: email } }));
      return store.dir(name);
    },
  };
}

export interface MemoryLogger extends Logger {
  lines: string[];
}

export function memoryLogger(): MemoryLogger {
  const lines: string[] = [];
  return {
    lines,
    debug: (m) => lines.push(`debug ${m}`),
    info: (m) => lines.push(`info ${m}`),
    warn: (m) => lines.push(`warn ${m}`),
    error: (m) => lines.push(`error ${m}`),
  };
}

export const line = (o: unknown): string => `${JSON.stringify(o)}\n`;

/** Set a file's modification time to ageMs ago. */
export function age(file: string, ageMs: number): void {
  const s = (Date.now() - ageMs) / 1000;
  fs.utimesSync(file, s, s);
}
