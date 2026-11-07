/**
 * Self-checks: everything Many Hats needs to route tabs correctly, each with a repair when one is
 * safe to make. Run at startup (repairs applied), on demand ("Check and Repair Setup"), and shown
 * in the sidebar when something needs attention.
 */
import * as fs from 'node:fs';
import { installLauncher, launcherStatus } from './launcher';
import type { Layout } from '../state/layout';
import { FEATURE_LABELS, type Compat } from '../claude/compat';
import { statOrUndefined } from '../infra/fsx';
import type { Platform } from '../platform/types';

export type HealthLevel = 'ok' | 'warning' | 'error';

export interface HealthCheck {
  id: string;
  level: HealthLevel;
  title: string;
  detail?: string;
  /** A repair that's safe to make without asking. */
  repair?: () => Promise<void>;
  /** A command the user can run to deal with it (an id the UI knows). */
  action?: { label: string; command: string };
}

/** claudeCode.claudeProcessWrapper as set at each level. */
export interface WrapperSetting {
  global: string | undefined;
  workspace: string | undefined;
  workspaceFolder: string | undefined;
}

export interface HealthDeps {
  layout: Layout;
  launcherScript: string;
  platform: Platform;
  compat: Compat;
  wrapper: () => WrapperSetting;
  setWrapper: (value: string) => Promise<void>;
  claudeExtensionInstalled: () => boolean;
  claudeBinary: () => string | undefined;
}

export function checkHealth(deps: HealthDeps): HealthCheck[] {
  const { layout, launcherScript, platform, compat } = deps;
  const checks: HealthCheck[] = [];

  if (!platform.supported) {
    checks.push({
      id: 'platform',
      level: 'error',
      title: `Many Hats works on macOS only for now (this is ${platform.name}).`,
    });
    return checks;
  }

  const root = statOrUndefined(layout.root);
  if (root && (root.mode & 0o077) !== 0) {
    checks.push({
      id: 'permissions',
      level: 'warning',
      title: 'The Many Hats data folder is readable by other users.',
      detail: `${layout.root} should be private (700).`,
      repair: () => Promise.resolve(fs.chmodSync(layout.root, 0o700)),
    });
  }

  const status = launcherStatus(layout, launcherScript);
  if (status !== 'ok') {
    checks.push({
      id: 'launcher',
      level: 'error',
      title:
        status === 'missing'
          ? 'The Many Hats launcher is missing.'
          : 'The Many Hats launcher is out of date.',
      detail:
        'Claude Code tabs resumed after a reload may start on the wrong account until it’s reinstalled.',
      repair: () => Promise.resolve(void installLauncher(layout, launcherScript)),
    });
  }

  const w = deps.wrapper();
  if (w.global !== layout.launcher) {
    if (w.global) {
      checks.push({
        id: 'wrapper-foreign',
        level: 'warning',
        title: 'Claude Code’s process wrapper is set to another program.',
        detail: `claudeCode.claudeProcessWrapper is ${w.global}. Many Hats leaves it alone, so tabs resumed after a reload start on the account for new tabs instead of their own.`,
      });
    } else {
      checks.push({
        id: 'wrapper-unset',
        level: 'error',
        title: 'Claude Code isn’t set to start tabs through Many Hats.',
        detail: 'Resumed tabs start on the account for new tabs instead of their own.',
        repair: () => deps.setWrapper(layout.launcher),
      });
    }
  }
  const override = w.workspaceFolder ?? w.workspace;
  if (override !== undefined && override !== layout.launcher) {
    checks.push({
      id: 'wrapper-override',
      level: 'warning',
      title: 'This workspace’s settings override Claude Code’s process wrapper.',
      detail: `claudeCode.claudeProcessWrapper is set to "${override}" in this workspace, so tabs here don’t start through Many Hats.`,
    });
  }

  if (!deps.claudeExtensionInstalled()) {
    checks.push({
      id: 'claude-extension',
      level: 'warning',
      title: 'The Claude Code extension isn’t installed.',
      detail: 'Many Hats runs Claude Code tabs on your accounts; install Claude Code to use it.',
      action: { label: 'Show Claude Code', command: 'manyHats.showClaudeCode' },
    });
  } else if (!deps.claudeBinary()) {
    checks.push({
      id: 'claude-cli',
      level: 'warning',
      title: 'The Claude Code CLI wasn’t found.',
      detail: 'Signing accounts in and out needs it. Update the Claude Code extension.',
    });
  }

  for (const issue of compat.issues()) {
    checks.push({
      id: `compat-${issue.feature}`,
      level: 'warning',
      title: `Claude Code changed something Many Hats reads: ${FEATURE_LABELS[issue.feature]} is paused.`,
      detail: `${issue.detail}. Many Hats stops acting on it rather than guess. An update to Many Hats will fix this; collecting diagnostics helps.`,
      action: { label: 'Collect Diagnostics', command: 'manyHats.collectDiagnostics' },
    });
  }
  return checks;
}

/** Apply every safe repair. @returns the titles of what was repaired */
export async function repairAll(checks: readonly HealthCheck[]): Promise<string[]> {
  const done: string[] = [];
  for (const c of checks) {
    if (!c.repair) continue;
    await c.repair();
    done.push(c.title);
  }
  return done;
}
