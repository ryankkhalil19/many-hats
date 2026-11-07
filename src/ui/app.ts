/** Everything the UI modules share, built once by extension.ts. */
import type * as vscode from 'vscode';
import type { AccountsService } from '../services/accounts';
import type { HealthCheck } from '../services/health';
import type { PickService } from '../services/pick';
import type { Scanner } from '../services/scanner';
import type { SessionService } from '../services/sessions';
import type { AccountStore } from '../state/accounts';
import type { Archive } from '../state/archive';
import type { Assignments } from '../state/assignments';
import type { Layout } from '../state/layout';
import type { NextTab } from '../state/nextTab';
import type { Compat } from '../claude/compat';
import type { TranscriptReader } from '../claude/transcripts';
import type { Logger } from '../infra/log';
import type { Platform } from '../platform/types';

export interface App {
  context: vscode.ExtensionContext;
  version: string;
  log: Logger;
  layout: Layout;
  store: AccountStore;
  assignments: Assignments;
  archive: Archive;
  nextTab: NextTab;
  compat: Compat;
  platform: Platform;
  scanner: Scanner;
  pick: PickService;
  accounts: AccountsService;
  sessions: SessionService;
  transcripts: TranscriptReader;
  launcherScript: string;
  claudeBinary: () => string | undefined;
  /** The current self-checks (without repairing). */
  health: () => HealthCheck[];
  /** Ask the sidebar and status bar to update. */
  refresh: () => void;
  /** Show the sidebar. */
  revealSidebar: () => Thenable<unknown>;
}
