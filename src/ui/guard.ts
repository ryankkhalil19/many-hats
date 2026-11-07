/**
 * The error boundary every command and webview message runs inside. An expected failure
 * (UserError) is shown as is. Anything else is a bug: it's logged with its stack and shown with an
 * offer to copy the details (redacted) for a bug report. Nothing reaches the editor as an
 * unhandled rejection.
 */
import * as vscode from 'vscode';
import { UserError, errorDetails, errorText } from '../core/errors';
import type { Logger } from '../infra/log';
import { redact } from '../infra/redact';

export function reportError(log: Logger, e: unknown, context: string): void {
  if (e instanceof UserError) {
    void vscode.window.showErrorMessage(e.message);
    return;
  }
  log.error(`${context}: ${errorDetails(e)}`);
  void vscode.window.showErrorMessage(`Many Hats: ${errorText(e)}`, 'Copy Details').then((choice) => {
    if (choice) void vscode.env.clipboard.writeText(redact(`${context}\n${errorDetails(e)}`));
  });
}

export function guard<A extends unknown[]>(
  log: Logger,
  context: string,
  fn: (...args: A) => unknown,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (e) {
      reportError(log, e, context);
    }
  };
}
