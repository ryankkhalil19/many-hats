#!/usr/bin/env node
// The compatibility canary. Downloads the latest Claude Code extension and CLI, and checks every
// point Many Hats relies on. CI runs it nightly and opens an issue when one changes, so a Claude Code
// update that would break Many Hats is known before users report it.
//   node scripts/canary.mjs [--json]
import { execFileSync } from 'node:child_process';
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
  try {
    cli = downloadCli();
    results.push(...checkCli(helpOf(cli, 'auth', 'login'), helpOf(cli, 'auth', 'logout')));
    tested.push(`Claude Code CLI ${cli.version} (${CLI_PACKAGE}, npm)`);
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
