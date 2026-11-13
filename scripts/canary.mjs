#!/usr/bin/env node
// The compatibility canary. Downloads the latest Claude Code extension and CLI, and checks every
// point Many Hats relies on. CI runs it nightly and opens an issue when one changes, so a Claude Code
// update that would break Many Hats is known before users report it.
//   node scripts/canary.mjs [--json]
//   MANY_HATS_CANARY_CLI=~/.local/bin/claude node scripts/canary.mjs   (a local CLI, no download)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REGISTRY = 'https://open-vsx.org/api/Anthropic/claude-code';
const TARGET = 'darwin-arm64';
/** The CLI's native build for the machine the canary runs on (in CI, linux-x64). */
const CLI_PACKAGE = `@anthropic-ai/claude-code-${process.platform}-${process.arch}`;

async function download() {
  const meta = await (await fetch(`${REGISTRY}/${TARGET}/latest`)).json();
  if (!meta?.files?.download) throw new Error(`no download for Claude Code ${TARGET} on Open VSX`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-canary-'));
  const file = path.join(dir, 'claude-code.vsix');
  fs.writeFileSync(file, Buffer.from(await (await fetch(meta.files.download)).arrayBuffer()));
  return { version: meta.version, file, dir };
}

/** The latest CLI from npm, unpacked: its package is one native `claude` binary. */
function downloadCli() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-canary-cli-'));
  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', `${CLI_PACKAGE}@latest`, '--json', '--pack-destination', dir], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  execFileSync('tar', ['-xzf', path.join(dir, packed.filename), '-C', dir]);
  const binary = path.join(dir, 'package', 'claude');
  fs.chmodSync(binary, 0o755);
  return { version: packed.version, binary, dir };
}

/** A command's --help, run with a throwaway home and config folder: it signs nothing in or out. */
function helpOf(cli, ...args) {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: cli.dir,
    CLAUDE_CONFIG_DIR: path.join(cli.dir, 'config'),
    DISABLE_AUTOUPDATER: '1',
  };
  try {
    return execFileSync(cli.binary, [...args, '--help'], { env, encoding: 'utf8', timeout: 60_000 });
  } catch {
    return '';
  }
}

/** The usage refresh's command line: the same as USAGE_ARGS in src/services/usageRefresh.ts. */
export const USAGE_ARGS = [
  '-p',
  '/usage',
  '--no-session-persistence',
  '--strict-mcp-config',
  '--settings',
  '{"disableAllHooks":true}',
];

/** A copy's command line: the same as forkArgs in src/claude/fork.ts. */
export function copyArgs(sourceFile, copyId, name) {
  return [
    '-p',
    `/rename ${name}`,
    '--resume',
    sourceFile,
    '--fork-session',
    '--session-id',
    copyId,
    '--strict-mcp-config',
    '--settings',
    '{"disableAllHooks":true}',
  ];
}

/** The session ID in test/fixtures/claude-code-2.1/conversation.jsonl. */
const FIXTURE_ID = '11111111-1111-4111-8111-111111111111';

/**
 * Copies a conversation exactly as Many Hats does, signed out, in a throwaway home: a two-message
 * conversation in Claude Code 2.1's format plus a Remote Control link and a folder move, which a
 * copy must leave behind, and a SessionStart hook that leaves a mark. The run's JSON result (asked
 * for here only) says how many turns it ran.
 */
function copyRunOf(cli) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-canary-copy-')));
  try {
    const config = path.join(home, 'config');
    const work = path.join(home, 'work');
    const mark = path.join(home, 'hook-ran');
    const dir = path.join(config, 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'));
    fs.mkdirSync(work);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(config, 'settings.json'),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch "${mark}"` }] }] },
      }),
    );
    const source = randomUUID();
    const copy = randomUUID();
    const name = 'Canary copy';
    const fixture = fs
      .readFileSync(
        path.join(import.meta.dirname, '..', 'test', 'fixtures', 'claude-code-2.1', 'conversation.jsonl'),
        'utf8',
      )
      .replaceAll(FIXTURE_ID, source);
    const leftBehind = [
      { type: 'bridge-session', sessionId: source, bridgeSessionId: 'cse_canary', lastSequenceNum: 0 },
      { type: 'relocated', sessionId: source, relocatedCwd: path.join(home, 'elsewhere') },
    ];
    const original = `${fixture}${leftBehind.map((r) => `${JSON.stringify(r)}\n`).join('')}`;
    const sourceFile = path.join(dir, `${source}.jsonl`);
    fs.writeFileSync(sourceFile, original);
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: home,
      CLAUDE_CONFIG_DIR: config,
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
    };
    const r = spawnSync(cli.binary, [...copyArgs(sourceFile, copy, name), '--output-format', 'json'], {
      cwd: work,
      env,
      encoding: 'utf8',
      timeout: 90_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let turns;
    try {
      turns = JSON.parse(r.stdout ?? '').num_turns;
    } catch {
      turns = undefined;
    }
    const copyFile = path.join(dir, `${copy}.jsonl`);
    const records = fs.existsSync(copyFile)
      ? fs
          .readFileSync(copyFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .flatMap((l) => {
            try {
              return [JSON.parse(l)];
            } catch {
              return [];
            }
          })
      : null;
    return {
      code: r.status,
      records,
      copy,
      name,
      turns,
      sourceUnchanged: fs.readFileSync(sourceFile, 'utf8') === original,
      hookRan: fs.existsSync(mark),
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Runs the usage refresh exactly as Many Hats does, signed out, in a throwaway home whose settings
 * hold a SessionStart hook that leaves a mark, so the run shows whether hooks stayed off.
 */
function usageRunOf(cli) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-canary-usage-'));
  try {
    const config = path.join(home, 'config');
    const mark = path.join(home, 'hook-ran');
    fs.mkdirSync(config);
    fs.writeFileSync(
      path.join(config, 'settings.json'),
      JSON.stringify({
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `touch "${mark}"` }] }] },
      }),
    );
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: home,
      CLAUDE_CONFIG_DIR: config,
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
    };
    const r = spawnSync(cli.binary, USAGE_ARGS, { cwd: home, env, encoding: 'utf8', timeout: 90_000 });
    return { code: r.status, stdout: r.stdout ?? '', hookRan: fs.existsSync(mark) };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** A new project entry's defaults: the same as PROJECT_DEFAULTS in src/claude/trust.ts. */
export const PROJECT_DEFAULTS = {
  allowedTools: [],
  mcpContextUris: [],
  mcpServers: {},
  enabledMcpjsonServers: [],
  disabledMcpjsonServers: [],
  hasTrustDialogAccepted: false,
  hasClaudeMdExternalIncludesApproved: false,
  hasClaudeMdExternalIncludesWarningShown: false,
};

/**
 * Folder trust, as Many Hats shares it between accounts: what the CLI reports for a folder before
 * and after a trust record is written the way Many Hats writes it, whether a run that saves the
 * config keeps that record, and whether it takes `<file>.lock` while it saves.
 */
async function trustRunOf(cli) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-canary-trust-')));
  try {
    const config = path.join(home, 'config');
    const work = path.join(home, 'work');
    fs.mkdirSync(config);
    fs.mkdirSync(work);
    const file = path.join(config, '.claude.json');
    fs.writeFileSync(file, '{"numStartups": 1}');
    const env = {
      PATH: process.env.PATH ?? '',
      HOME: home,
      CLAUDE_CONFIG_DIR: config,
      DISABLE_AUTOUPDATER: '1',
      DISABLE_TELEMETRY: '1',
    };
    const report = () => {
      const r = spawnSync(cli.binary, ['--setting-sources', 'user', 'workspace-trust', '--json'], {
        cwd: work,
        env,
        encoding: 'utf8',
        timeout: 60_000,
      });
      try {
        return JSON.parse((r.stdout ?? '').trim().split('\n').pop() ?? '');
      } catch {
        return null;
      }
    };
    const before = report();
    const seed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const projects = { ...seed.projects, [work]: { ...PROJECT_DEFAULTS, hasTrustDialogAccepted: true } };
    fs.writeFileSync(file, JSON.stringify({ ...seed, projects }, null, 2));
    const after = report();
    // A run that saves the config (signed out, it still records its first start).
    const sawLock = await new Promise((resolve) => {
      const child = spawn(cli.binary, ['-p', 'hi', '--setting-sources', 'user'], {
        cwd: work,
        env,
        stdio: 'ignore',
      });
      let saw = false;
      const poll = setInterval(() => (saw ||= fs.existsSync(`${file}.lock`)), 2);
      const stop = setTimeout(() => child.kill(), 60_000);
      child.on('exit', () => (clearInterval(poll), clearTimeout(stop), resolve(saw)));
      child.on('error', () => (clearInterval(poll), clearTimeout(stop), resolve(false)));
    });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      work,
      before,
      after,
      sawLock,
      kept: saved.projects?.[work]?.hasTrustDialogAccepted === true,
      savedByCli: saved.numStartups !== 1 || 'firstStartTime' in saved,
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const unzipText = (file, entry) =>
  execFileSync('unzip', ['-p', file, entry], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });

function configurationKeys(contributes) {
  const blocks = Array.isArray(contributes?.configuration)
    ? contributes.configuration
    : [contributes?.configuration ?? {}];
  return new Set(blocks.flatMap((b) => Object.keys(b?.properties ?? {})));
}

export function check(manifest, mainSource) {
  const c = manifest.contributes ?? {};
  const commands = new Set((c.commands ?? []).map((x) => x.command));
  const views = new Set(
    Object.values(c.views ?? {})
      .flat()
      .map((v) => v.id),
  );
  const results = [
    {
      name: 'the process-wrapper setting exists',
      hard: true,
      ok: configurationKeys(c).has('claudeCode.claudeProcessWrapper'),
      why: 'Many Hats starts every Claude Code process through its launcher via this setting.',
    },
    {
      name: 'the process-wrapper setting is still used',
      hard: true,
      ok: /claudeProcessWrapper/.test(mainSource),
      why: 'If the extension stops reading it, tabs start without the launcher.',
    },
    {
      name: 'resumed sessions are started with --resume',
      hard: true,
      ok: /["'`]--resume["'`]/.test(mainSource),
      why: 'The launcher finds a resumed session’s account from this argument.',
    },
    {
      name: 'the open-tab command exists',
      hard: true,
      ok: commands.has('claude-vscode.editor.open'),
      why: 'Many Hats opens Claude Code tabs with it.',
    },
    ...['claudeVSCodeSidebar', 'claudeVSCodeSidebarSecondary', 'claudeVSCodeSessionsList'].map((id) => ({
      name: `view ${id} exists`,
      hard: false,
      ok: views.has(id),
      why: 'An activation event; Many Hats still activates at startup without it.',
    })),
  ];
  return results;
}

/** The usage refresh, from a run of it (usageRunOf). */
export function checkUsage(run) {
  return [
    {
      name: 'the CLI runs /usage without a prompt',
      hard: true,
      ok: run.code === 0 && run.stdout.trim().length > 0,
      why: 'Many Hats refreshes each account’s usage this way.',
    },
    {
      name: 'hooks stay off for the usage refresh',
      hard: true,
      ok: run.code === 0 && !run.hookRan,
      why: 'A usage refresh must never run the user’s hooks.',
    },
  ];
}

/** Copy to account, from a run of it (copyRunOf). */
export function checkCopy(run) {
  const records = run.records ?? [];
  const ids = records.map((r) => r?.sessionId).filter((id) => typeof id === 'string');
  return [
    {
      name: 'the CLI copies a session with --fork-session',
      hard: true,
      ok: run.code === 0 && records.some((r) => r?.type === 'user'),
      why: 'Copy to account has Claude Code fork the session this way.',
    },
    {
      name: 'the copy carries only its own session ID',
      hard: true,
      ok: ids.length > 0 && ids.every((id) => id === run.copy),
      why: 'A copy must be a session of its own, not the original under another file name.',
    },
    {
      name: 'the copy leaves the original’s Remote Control link behind',
      hard: true,
      ok: run.records !== null && !records.some((r) => r?.type === 'bridge-session'),
      why: 'A copy on another account must not take over the original’s Remote Control session.',
    },
    {
      name: 'the copy leaves the original’s folder move behind',
      hard: true,
      ok: run.records !== null && !records.some((r) => r?.type === 'relocated'),
      why: 'A folder move carried over would tie the copy to the folder the original moved to.',
    },
    {
      name: 'no turn runs for a copy',
      hard: true,
      ok: run.turns === 0,
      why: 'A copy must never send anything to the model, which would cost the account.',
    },
    {
      name: 'copying leaves the original untouched',
      hard: true,
      ok: run.sourceUnchanged === true,
      why: 'The original is only read.',
    },
    {
      name: 'hooks stay off for a copy',
      hard: true,
      ok: run.code === 0 && !run.hookRan,
      why: 'A copy must never run the user’s hooks.',
    },
    {
      name: '/rename names the copy',
      hard: false,
      ok: records.some((r) => r?.type === 'custom-title' && r.customTitle === run.name),
      why: 'Many Hats names the copy itself when /rename doesn’t, so this only warns.',
    },
  ];
}

/** Folder trust shared between accounts, from a run of it (trustRunOf). */
export function checkTrust(run) {
  return [
    {
      name: 'the CLI reports a folder’s trust with workspace-trust --json',
      hard: true,
      ok: run.before?.trusted === false && run.before?.directory === run.work,
      why: 'Claude Code’s extension asks this before each window’s sessions; Many Hats keeps the answer the same on every account.',
    },
    {
      name: 'a trust record written as Many Hats writes it counts',
      hard: true,
      ok: run.after?.trusted === true,
      why: 'Many Hats copies a folder’s trust to every account as projects[folder].hasTrustDialogAccepted.',
    },
    {
      name: 'saving its config keeps a trust record Many Hats wrote',
      hard: true,
      ok: run.kept === true && run.savedByCli === true,
      why: 'Claude Code must re-read its config before saving, or a shared trust record is lost.',
    },
    {
      name: 'the CLI locks its config with <file>.lock while saving',
      hard: false,
      ok: run.sawLock === true,
      why: 'Many Hats writes trust records under the same lock. Seeing it is timing-dependent, so this only warns.',
    },
  ];
}

/** The CLI commands Many Hats runs, from their --help. */
export function checkCli(loginHelp, logoutHelp) {
  return [
    {
      name: 'the CLI signs in with claude auth login',
      hard: true,
      ok: /Usage: claude auth login\b/.test(loginHelp),
      why: 'Many Hats signs each account in through it.',
    },
    {
      name: 'claude auth login takes --email',
      hard: true,
      ok: /--email\b/.test(loginHelp),
      why: 'Sign-in passes the account’s email, so the browser signs in the right account.',
    },
    {
      name: 'the CLI signs out with claude auth logout',
      hard: true,
      ok: /Usage: claude auth logout\b/.test(logoutHelp),
      why: 'Removing an account signs it out first, so no login is left behind.',
    },
  ];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = [];
  const tested = [];
  const ext = await download();
  try {
    const manifest = JSON.parse(unzipText(ext.file, 'extension/package.json'));
    const main = unzipText(
      ext.file,
      `extension/${String(manifest.main ?? 'extension.js').replace(/^\.\//, '')}`,
    );
    results.push(...check(manifest, main));
    tested.push(`Claude Code ${ext.version} (${TARGET}, Open VSX)`);
  } finally {
    fs.rmSync(ext.dir, { recursive: true, force: true });
  }
  let cli;
  const local = process.env.MANY_HATS_CANARY_CLI;
  try {
    cli = local
      ? {
          version: 'local',
          binary: local,
          dir: fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-canary-cli-')),
        }
      : downloadCli();
    results.push(...checkCli(helpOf(cli, 'auth', 'login'), helpOf(cli, 'auth', 'logout')));
    results.push(...checkUsage(usageRunOf(cli)));
    results.push(...checkCopy(copyRunOf(cli)));
    results.push(...checkTrust(await trustRunOf(cli)));
    tested.push(
      local ? `Claude Code CLI at ${local}` : `Claude Code CLI ${cli.version} (${CLI_PACKAGE}, npm)`,
    );
  } catch (e) {
    results.push({
      name: `the CLI package ${CLI_PACKAGE} can be downloaded`,
      hard: true,
      ok: false,
      why: e instanceof Error ? e.message.split('\n')[0] : String(e),
    });
  } finally {
    if (cli) fs.rmSync(cli.dir, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r.ok && r.hard);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ tested, results }, null, 2));
  else {
    for (const line of tested) console.log(line);
    for (const r of results)
      console.log(`${r.ok ? '✔' : r.hard ? '✖' : '⚠'} ${r.name}${r.ok ? '' : `: ${r.why}`}`);
  }
  process.exit(failed.length ? 1 : 0);
}
