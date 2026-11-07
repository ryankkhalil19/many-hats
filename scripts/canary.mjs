#!/usr/bin/env node
// The compatibility canary. Downloads the latest Claude Code extension and checks every point
// Many Hats relies on. CI runs it nightly and opens an issue when one changes, so a Claude Code
// update that would break Many Hats is known before users report it.
//   node scripts/canary.mjs [--json]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REGISTRY = 'https://open-vsx.org/api/Anthropic/claude-code';
const TARGET = 'darwin-arm64';

async function download() {
  const meta = await (await fetch(`${REGISTRY}/${TARGET}/latest`)).json();
  if (!meta?.files?.download) throw new Error(`no download for Claude Code ${TARGET} on Open VSX`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-canary-'));
  const file = path.join(dir, 'claude-code.vsix');
  fs.writeFileSync(file, Buffer.from(await (await fetch(meta.files.download)).arrayBuffer()));
  return { version: meta.version, file, dir };
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const { version, file, dir } = await download();
  try {
    const manifest = JSON.parse(unzipText(file, 'extension/package.json'));
    const main = unzipText(file, `extension/${String(manifest.main ?? 'extension.js').replace(/^\.\//, '')}`);
    const results = check(manifest, main);
    const failed = results.filter((r) => !r.ok && r.hard);
    if (process.argv.includes('--json')) console.log(JSON.stringify({ version, results }, null, 2));
    else {
      console.log(`Claude Code ${version} (${TARGET}, Open VSX)`);
      for (const r of results)
        console.log(`${r.ok ? '✔' : r.hard ? '✖' : '⚠'} ${r.name}${r.ok ? '' : `: ${r.why}`}`);
    }
    process.exit(failed.length ? 1 : 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
