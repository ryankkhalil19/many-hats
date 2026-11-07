/**
 * The contract between the extension and its sidebar webview: the state the extension sends,
 * and the messages the webview may send back. The webview is untrusted input like any other, so
 * every message is checked by parseToHost before the extension acts on it.
 *
 * Shared by both sides; holds types and pure functions only.
 */

export type LimitLevel = 'normal' | 'warning' | 'critical';

export interface UsageLimit {
  label: string;
  /** "session", "weekly_all", "weekly_scoped" (a per-model limit) or another kind Claude Code reports. */
  kind: string;
  percent: number;
  resetsAt?: number;
  /** Past its reset time: the cached figure is from the previous window. */
  reset: boolean;
  level: LimitLevel;
  /** The limit currently in effect. */
  active: boolean;
}

export interface Usage {
  fetchedAtMs?: number;
  limits: UsageLimit[];
  credits?: { used: string; percent: number };
}

export interface AccountView {
  name: string;
  email?: string;
  expectedEmail?: string;
  plan?: string;
  tier?: string;
  org?: string;
  signedIn: boolean;
  isPick: boolean;
  usage?: Usage;
  /** Claude Code's /usage is running for it, to refresh its figures. */
  usageRefreshing?: boolean;
  /** Why the last refresh of its figures failed, in a few words. */
  usageError?: string;
  openHere: number;
}

export interface SessionView {
  id: string;
  title: string;
  renamed: boolean;
  updatedAt: number;
  /** The account it belongs to; null: none yet ("Unassigned"). */
  account: string | null;
  running: { status: 'busy' | 'idle'; here: boolean } | null;
  /** Moved while open: the account it starts on next time. */
  movingTo: string | null;
  archived: boolean;
  folder: string;
}

export interface Notice {
  id: string;
  level: 'info' | 'warning' | 'error';
  text: string;
  action?: { label: string; command: string };
}

export interface SidebarState {
  pick: string;
  folders: string[];
  accounts: AccountView[];
  sessions: SessionView[];
  notices: Notice[];
}

export type ToWebview = { type: 'state'; state: SidebarState };

export type ToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'open'; id: string; account?: string }
  | { type: 'new'; account: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'archive'; id: string; archived: boolean }
  | { type: 'delete'; id: string }
  | { type: 'move'; id: string; account: string }
  | { type: 'pick'; account: string }
  | { type: 'signIn'; account: string }
  | { type: 'addAccount' }
  | { type: 'removeAccount'; account: string }
  | { type: 'refreshUsage'; account: string }
  | { type: 'usageDetails' }
  | { type: 'copyId'; id: string }
  | { type: 'notice'; command: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT = /^(default|[a-z0-9][a-z0-9_-]{0,31})$/;
const COMMAND = /^manyHats\.[A-Za-z]+$/;

const str = (v: unknown, re: RegExp): string | undefined =>
  typeof v === 'string' && re.test(v) ? v : undefined;

/** A message from the webview, checked field by field; undefined if it isn't one the extension knows. */
export function parseToHost(m: unknown): ToHost | undefined {
  if (typeof m !== 'object' || m === null) return undefined;
  const o = m as Record<string, unknown>;
  const id = str(o.id, UUID);
  const account = str(o.account, ACCOUNT);
  switch (o.type) {
    case 'ready':
    case 'refresh':
    case 'addAccount':
    case 'usageDetails':
      return { type: o.type };
    case 'open':
      if (!id || (o.account !== undefined && !account)) return undefined;
      return account ? { type: 'open', id, account } : { type: 'open', id };
    case 'delete':
    case 'copyId':
      return id ? { type: o.type, id } : undefined;
    case 'new':
    case 'pick':
    case 'signIn':
    case 'removeAccount':
    case 'refreshUsage':
      return account ? { type: o.type, account } : undefined;
    case 'move':
      return id && account ? { type: 'move', id, account } : undefined;
    case 'archive':
      return id && typeof o.archived === 'boolean'
        ? { type: 'archive', id, archived: o.archived }
        : undefined;
    case 'rename':
      return id && typeof o.title === 'string' && o.title.length <= 1000
        ? { type: 'rename', id, title: o.title }
        : undefined;
    case 'notice': {
      const command = str(o.command, COMMAND);
      return command ? { type: 'notice', command } : undefined;
    }
    default:
      return undefined;
  }
}
