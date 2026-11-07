/**
 * What the sidebar's two pop-up menus offer, as pure functions of the state. No DOM here, so it's
 * tested under Node. menu.ts shows the items; actions.ts supplies what they do.
 */
import { I } from './icons';
import { avatarLetter, esc, hue, labelOf } from './format';
import type { AccountView, SessionView, SidebarState, ToHost } from '../shared/protocol';

/** One line of a menu: a separator, a heading, or an item (icon is trusted markup; the rest is text). */
export type MenuItem =
  | { sep: true }
  | { header: string }
  | {
      label: string;
      icon?: string;
      detail?: string;
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    };

export interface MenuActions {
  post(message: ToHost): void;
  /** Opens the session in a tab: on `account`, or on its own account. */
  open(id: string, account?: string): void;
  rename(id: string): void;
}

function avatar(state: SidebarState, a: AccountView): string {
  const h = hue(
    state.accounts.map((x) => x.name),
    a.name,
  );
  return `<span class="avatar sm" data-hue="${h}">${esc(avatarLetter(a))}</span>`;
}

/** A session's menu: open it (on any signed-in account), rename, archive, move, delete. */
export function sessionMenuItems(state: SidebarState, s: SessionView, act: MenuActions): MenuItem[] {
  const { id } = s;
  const current = s.movingTo ?? s.account;
  return [
    { label: 'Open in a tab', icon: I.open, kbd: '↵', run: () => act.open(id) },
    { label: 'Rename', icon: I.edit, kbd: 'F2', run: () => act.rename(id) },
    s.archived
      ? {
          label: 'Unarchive',
          icon: I.unarchive,
          run: () => act.post({ type: 'archive', id, archived: false }),
        }
      : { label: 'Archive', icon: I.archive, run: () => act.post({ type: 'archive', id, archived: true }) },
    { label: 'Copy session ID', icon: I.copy, run: () => act.post({ type: 'copyId', id }) },
    { sep: true },
    { header: 'Open on account' },
    ...state.accounts
      .filter((a) => a.signedIn)
      .map((a): MenuItem => ({
        label: labelOf(a),
        detail: a.name === s.account ? 'its own' : a.name,
        icon: avatar(state, a),
        run: () => act.open(id, a.name),
      })),
    { header: 'Move to account' },
    ...state.accounts.map((a): MenuItem => ({
      label: labelOf(a),
      icon: I.move,
      detail: a.name === current ? 'current' : a.signedIn ? a.name : 'not signed in',
      disabled: a.name === current,
      run: () => act.post({ type: 'move', id, account: a.name }),
    })),
    { sep: true },
    {
      label: s.running ? 'Delete (close it first)' : 'Delete…',
      icon: I.trash,
      kbd: '⌘⌫',
      danger: true,
      disabled: Boolean(s.running),
      run: () => act.post({ type: 'delete', id }),
    },
  ];
}

/** An account's menu: a new session, new tabs here, sign in, usage, and remove (not the default). */
export function accountMenuItems(a: AccountView, act: MenuActions): MenuItem[] {
  const account = a.name;
  const items: MenuItem[] = [
    {
      label: 'New session',
      icon: I.plus,
      disabled: !a.signedIn,
      run: () => act.post({ type: 'new', account }),
    },
    {
      label: a.isPick ? 'New tabs start on this account' : 'Use for new tabs',
      icon: I.check,
      disabled: a.isPick,
      run: () => act.post({ type: 'pick', account }),
    },
    {
      label: a.signedIn ? 'Sign in again…' : 'Sign in…',
      icon: I.key,
      run: () => act.post({ type: 'signIn', account }),
    },
    {
      label: a.usageRefreshing ? 'Updating usage…' : 'Refresh usage',
      icon: I.refresh,
      disabled: !a.signedIn || Boolean(a.usageRefreshing),
      run: () => act.post({ type: 'refreshUsage', account }),
    },
    { label: 'Usage details on claude.ai', icon: I.chart, run: () => act.post({ type: 'usageDetails' }) },
  ];
  if (account !== 'default')
    items.push(
      { sep: true },
      {
        label: 'Remove account…',
        icon: I.trash,
        danger: true,
        run: () => act.post({ type: 'removeAccount', account }),
      },
    );
  return items;
}
