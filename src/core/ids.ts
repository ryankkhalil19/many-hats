/**
 * Names and ids every layer agrees on. Pure: no I/O, no editor API.
 *
 * - An account is "default" (the user's own Claude Code login, ~/.claude) or an extra account
 *   with a short lowercase name, which is also its folder name and safe in a file path.
 * - A session id is Claude Code's UUID for a conversation. It names files too, so anything that
 *   isn't exactly a UUID is rejected before it gets near a path.
 */

export const DEFAULT_ACCOUNT = 'default';

/** An extra account's name: 1-32 of a-z, 0-9, "-" and "_", starting with a letter or digit. */
export const ACCOUNT_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "default" or a valid extra account name. */
export function isAccountName(name: unknown): name is string {
  return typeof name === 'string' && (name === DEFAULT_ACCOUNT || ACCOUNT_NAME_RE.test(name));
}

/** A valid name for an extra account (never "default"). */
export function isExtraAccountName(name: unknown): name is string {
  return typeof name === 'string' && name !== DEFAULT_ACCOUNT && ACCOUNT_NAME_RE.test(name);
}

/** Why a name can't be used for a new account, or undefined if it can. */
export function accountNameProblem(name: string): string | undefined {
  if (name === DEFAULT_ACCOUNT) return '"default" is your main Claude Code login.';
  if (!ACCOUNT_NAME_RE.test(name)) {
    return 'Use up to 32 lowercase letters, digits, "-" or "_", starting with a letter or digit.';
  }
  return undefined;
}

export function isSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id);
}

/** The account name, with undefined standing for "default". */
export function accountLabel(name: string | undefined): string {
  return name ?? DEFAULT_ACCOUNT;
}

/** undefined for "default", the name otherwise: how the code passes "no extra account". */
export function extraOrUndefined(name: string | undefined | null): string | undefined {
  return name && name !== DEFAULT_ACCOUNT ? name : undefined;
}
