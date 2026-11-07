/**
 * A redacted report for bug reports: versions, health checks, Claude Code format issues, counts
 * and the launcher's recent decisions. No emails, tokens or home path; account names are replaced
 * by "account-1", "account-2"… since they can name a client or employer.
 */
import * as fs from 'node:fs';
import type { HealthCheck, WrapperSetting } from './health';
import type { CompatIssue } from '../claude/compat';
import { redact } from '../infra/redact';

export interface DiagnosticsInput {
  extensionVersion: string;
  editor: { name: string; version: string };
  os: { platform: string; release: string; arch: string };
  claudeExtensionVersion: string | undefined;
  cliVersion: string | undefined;
  layoutVersion: number | undefined;
  wrapper: WrapperSetting;
  launcherPath: string;
  accounts: { names: string[]; signedIn: number };
  assignments: number;
  runningTabs: number;
  health: readonly HealthCheck[];
  compat: readonly CompatIssue[];
  launcherLog: string[];
}

export function diagnosticsReport(input: DiagnosticsInput, home?: string): string {
  const alias = new Map<string, string>(input.accounts.names.map((n, i) => [n, `account-${i + 1}`]));
  const anonymize = (text: string): string => {
    let out = text;
    for (const [name, a] of alias)
      out = out.replace(new RegExp(`(^|[\\s=/"'])${escape(name)}(?=$|[\\s,"'/)])`, 'g'), `$1${a}`);
    return out;
  };
  const wrapper = (v: string | undefined): string =>
    v === undefined ? 'unset' : v === input.launcherPath ? 'Many Hats launcher' : 'another program';
  const lines = [
    '## Many Hats diagnostics',
    '',
    `- Many Hats: ${input.extensionVersion}`,
    `- Editor: ${input.editor.name} ${input.editor.version}`,
    `- OS: ${input.os.platform} ${input.os.release} (${input.os.arch})`,
    `- Claude Code extension: ${input.claudeExtensionVersion ?? 'not installed'}`,
    `- Claude Code CLI: ${input.cliVersion ?? 'not found'}`,
    `- Data layout version: ${input.layoutVersion ?? 'none'}`,
    `- Process wrapper: global ${wrapper(input.wrapper.global)}, workspace ${wrapper(input.wrapper.workspace)}, folder ${wrapper(input.wrapper.workspaceFolder)}`,
    `- Accounts: ${input.accounts.names.length} extra, ${input.accounts.signedIn} signed in (including default)`,
    `- Sessions with an account: ${input.assignments}; tabs running in this window: ${input.runningTabs}`,
    '',
    '### Health',
    ...(input.health.length
      ? input.health.map((c) => `- [${c.level}] ${c.title}${c.detail ? ` ${c.detail}` : ''}`)
      : ['- all checks pass']),
    '',
    '### Claude Code format checks',
    ...(input.compat.length
      ? input.compat.map((i) => `- ${i.feature}: ${i.detail} (since ${new Date(i.since).toISOString()})`)
      : ['- no issues']),
    '',
    '### Recent launcher decisions',
    '```',
    ...(input.launcherLog.length ? input.launcherLog : ['(none)']),
    '```',
  ];
  return redact(anonymize(lines.join('\n')), home);
}

/** The last n lines of a text file (reads at most the last 64 KiB). */
export function tailLines(file: string, n: number): string[] {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 64 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    const lines = buf.toString('utf8').split('\n').filter(Boolean);
    if (len < size) lines.shift(); // probably cut in the middle
    return lines.slice(-n);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
