/**
 * Errors. A UserError is an expected failure whose message is written for the person using the
 * extension and is shown as is; anything else is a bug, shown with an offer to copy the details.
 */

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}

/** Message and stack, for a bug report. */
export function errorDetails(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`;
  return errorText(e);
}

/** The errno code of a Node.js file-system error, if it has one. */
export function errnoCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e && typeof e.code === 'string'
    ? e.code
    : undefined;
}
