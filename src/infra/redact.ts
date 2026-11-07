/**
 * Removes personal data from text that may leave the machine (logs, diagnostics, bug reports):
 * email addresses, tokens and the home folder path. Session ids and account names stay: they
 * identify nothing outside this machine and are what a bug report needs.
 */
import * as os from 'node:os';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Anthropic keys and OAuth tokens (sk-ant-…), GitHub tokens, JWTs, long base64/hex secrets after "token=".
const TOKEN_RES: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{6,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /((?:token|secret|password|api[_-]?key)["'\s:=]+)[^\s"',]{8,}/gi,
];

export function redact(text: string, home: string = os.homedir()): string {
  let out = text;
  for (const re of TOKEN_RES) {
    out = out.replace(re, (match, prefix?: unknown) =>
      typeof prefix === 'string' ? `${prefix}<redacted>` : '<redacted>',
    );
  }
  out = out.replace(EMAIL_RE, '<email>');
  if (home && home.length > 1) {
    // Only the home folder itself, not a longer name that starts the same (/Users/al vs /Users/alex).
    out = out.replace(new RegExp(`${escapeRegExp(home)}(?=$|[/\\s"'):,;\\]])`, 'g'), '~');
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
