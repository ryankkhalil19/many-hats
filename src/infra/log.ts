/**
 * The logger every layer writes to. In the editor it's a LogOutputChannel ("Many Hats" in the
 * Output panel, with levels the user can change); in tests it's a memory log. Messages pass
 * through redact() first, so an email or token can't end up in a log a user pastes into a bug report.
 */
import { redact } from './redact';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface LogSink {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** A logger that redacts before writing to sink. */
export function redactingLogger(sink: LogSink): Logger {
  return {
    debug: (m) => sink.debug(redact(m)),
    info: (m) => sink.info(redact(m)),
    warn: (m) => sink.warn(redact(m)),
    error: (m) => sink.error(redact(m)),
  };
}

export const nullLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
