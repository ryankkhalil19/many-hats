/** User-facing text that appears in more than one place. Product names stay out of reach of templates. */
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_ACCOUNT } from '../core/ids';

export const PRODUCT = 'Many Hats';
export const ISSUES_URL = 'https://github.com/ryankkhalil19/many-hats/issues/new?template=bug_report.yml';
export const USAGE_PAGE = 'https://claude.ai/settings/usage';
export const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';
export const OPEN_CLAUDE_TAB = 'claude-vscode.editor.open';

export function label(name: string | undefined): string {
  return name ?? DEFAULT_ACCOUNT;
}

/** A path with the home folder shown as ~. */
export function tildify(p: string, home = os.homedir()): string {
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

export const notSignedIn = (name: string): string =>
  `"${name}" isn't signed in yet. Sign in before opening a Claude Code tab on it.`;
