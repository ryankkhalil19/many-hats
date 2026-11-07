import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ago,
  agoLong,
  avatarLetter,
  esc,
  highlight,
  hue,
  initial,
  labelOf,
  resetText,
} from '../../src/webview/format';
import {
  card,
  counts,
  filterTabs,
  limitRow,
  notices,
  restoreUi,
  row,
  sectionHead,
  sessionGroups,
  visibleSessions,
  type UiState,
} from '../../src/webview/view';
import {
  accountMenuItems,
  sessionMenuItems,
  type MenuActions,
  type MenuItem,
} from '../../src/webview/menuItems';
import { PendingRenames } from '../../src/webview/renames';
import type { AccountView, SessionView, SidebarState, ToHost } from '../../src/shared/protocol';
import { A, B, C, D } from '../helpers/home';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const ui = (o: Partial<UiState> = {}): UiState => ({
  collapsed: {},
  filter: 'all',
  query: '',
  selected: null,
  hiddenLimits: {},
  ...o,
});
const account = (o: Partial<AccountView>): AccountView => ({
  name: 'default',
  signedIn: true,
  isPick: false,
  openHere: 0,
  ...o,
});
const session = (o: Partial<SessionView>): SessionView => ({
  id: A,
  title: 'Work',
  renamed: false,
  updatedAt: NOW - 60_000,
  account: 'default',
  running: null,
  movingTo: null,
  archived: false,
  folder: 'app',
  ...o,
});
const state = (o: Partial<SidebarState> = {}): SidebarState => ({
  pick: 'default',
  folders: ['app'],
  accounts: [
    account({ email: 'me@example.com', isPick: true }),
    account({ name: 'work', email: 'me@work.example' }),
  ],
  sessions: [
    session({}),
    session({ id: B, title: 'Client <b>bug</b>', account: 'work', running: { status: 'busy', here: true } }),
    session({ id: C, title: 'Old', account: null, archived: true }),
  ],
  notices: [],
  ...o,
});

test('format: escaping, initials, labels, hues', () => {
  assert.equal(esc('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(esc(undefined), '');
  assert.equal(initial('me@example.com'), 'M');
  assert.equal(initial('---'), '?');
  assert.equal(labelOf(undefined), 'Unassigned');
  assert.equal(labelOf(account({ name: 'default' })), 'Main account');
  assert.equal(labelOf(account({ name: 'work', expectedEmail: 'boss@work.example' })), 'boss@work.example');
  const names = ['default', 'client', 'work'];
  assert.deepEqual(
    names.map((n) => hue(names, n)),
    [172, 245, 330],
    'each account in a window gets its own colour',
  );
  assert.equal(hue(names, 'missing'), 172);
  assert.equal(avatarLetter(account({ name: 'work', email: 'you@work.example' })), 'W');
  assert.equal(avatarLetter(account({ name: 'default', email: 'me@example.com' })), 'M');
});

test('format: relative times and resets', () => {
  assert.equal(ago(NOW - 10_000, NOW), 'now');
  assert.equal(ago(NOW - 5 * 60_000, NOW), '5m');
  assert.equal(ago(NOW - 3 * 3600e3, NOW), '3h');
  assert.equal(ago(NOW - 2 * 86400e3, NOW), '2d');
  assert.match(ago(NOW - 30 * 86400e3, NOW), /\w/);
  assert.equal(agoLong(NOW, NOW), 'just now');
  assert.equal(agoLong(NOW - 5 * 60_000, NOW), '5m ago');
  assert.match(agoLong(NOW - 30 * 86400e3, NOW), /^on /);
  assert.match(resetText(NOW + 3600e3, NOW), /^Resets at /);
  assert.match(resetText(NOW + 3 * 86400e3, NOW), /^Resets \w+, /);
  assert.equal(highlight('Fix <the> bug', 'the'), 'Fix &lt;<mark>the</mark>&gt; bug');
  assert.equal(highlight('Fix', 'zzz'), 'Fix');
  assert.equal(highlight('Fix', ''), 'Fix');
});

test('view: account cards — signed in, signed out, usage, hidden per-model limits', () => {
  const usage = {
    fetchedAtMs: NOW - 120_000,
    limits: [
      {
        label: 'Session (5hr)',
        kind: 'session',
        percent: 26,
        resetsAt: NOW + 3600e3,
        reset: false,
        level: 'normal' as const,
        active: true,
      },
      {
        label: 'Fable limit',
        kind: 'weekly_scoped',
        percent: 93,
        resetsAt: NOW + 3 * 86400e3,
        reset: false,
        level: 'critical' as const,
        active: false,
      },
    ],
    credits: { used: '$12.34', percent: 12 },
  };
  const a = account({ name: 'work', email: 'me@work.example', usage, plan: 'Team', openHere: 2 });
  const html = card(ui(), a, NOW);
  assert.match(html, /Session \(5hr\)/);
  assert.match(html, /Fable limit/);
  assert.match(html, /Updated 2m ago/);
  assert.match(html, /work · Team · 2 open here/);
  assert.match(html, /Usage credits: \$12\.34 used/);
  assert.match(html, /Use for new tabs/);
  const hidden = card(ui({ hiddenLimits: { 'work:Fable limit': true } }), a, NOW);
  assert.doesNotMatch(hidden, /<span class="limit-label">Fable limit/);
  assert.match(hidden, /Show Fable limit \(93%\)/, 'only its show button stays');
  assert.equal(limitRow(ui(), usage.limits[0]!, 'work', NOW).hidden, false);
  const out = card(ui(), account({ name: 'new', signedIn: false, expectedEmail: 'n@x.example' }), NOW);
  assert.match(out, /Not signed in: sign in as n@x\.example/);
  assert.match(out, /data-act="signIn"/);
  assert.match(card(ui(), account({ isPick: true, usage: { limits: [] } }), NOW), /New tabs start here/);
  assert.match(card(ui(), account({}), NOW), /No usage figures yet/);
});

test('view: the usage line — when the figures are from, updating, stale, failed, and the refresh button', () => {
  const fresh = card(ui(), account({ usage: { fetchedAtMs: NOW - 5 * 60_000, limits: [] } }), NOW);
  assert.match(fresh, /<span class="updated" title="[^"]+">Updated 5m ago<\/span>/);
  assert.match(fresh, /data-act="refreshUsage" data-account="default"/);
  assert.doesNotMatch(fresh, /aria-busy/);
  const stale = card(ui(), account({ usage: { fetchedAtMs: NOW - 2 * 3600e3, limits: [] } }), NOW);
  assert.match(stale, /class="updated stale"/, 'older than Claude Code itself trusts');
  const busy = card(
    ui(),
    account({ usageRefreshing: true, usage: { fetchedAtMs: NOW - 2 * 3600e3, limits: [] } }),
    NOW,
  );
  assert.match(busy, /Updating…/);
  assert.match(busy, /usage-refresh spinning/);
  assert.match(busy, /aria-disabled="true" aria-busy="true"/, 'busy, but still focusable');
  assert.doesNotMatch(busy, /Updated /);
  const failed = card(
    ui(),
    account({ usageError: 'Claude Code took too long.', usage: { fetchedAtMs: NOW - 3600e3, limits: [] } }),
    NOW,
  );
  assert.match(
    failed,
    /<span class="usage-error" title="Claude Code took too long\.">Couldn’t refresh<\/span>/,
  );
  const never = card(ui(), account({ usageError: 'Claude Code’s CLI wasn’t found.' }), NOW);
  assert.match(never, /Couldn’t get usage/);
  assert.match(card(ui(), account({ usageRefreshing: true }), NOW), /Getting this account’s usage…/);
  assert.doesNotMatch(
    card(ui(), account({ signedIn: false }), NOW),
    /refreshUsage/,
    'nothing to refresh while signed out',
  );
});

test('view: sessions grouped by account, filtered and searched, with status and moves', () => {
  const s = state();
  assert.deepEqual(counts(s), { all: 2, open: 1, archived: 1 });
  assert.deepEqual(
    visibleSessions(s, ui()).map((x) => x.id),
    [A, B],
  );
  assert.deepEqual(
    visibleSessions(s, ui({ filter: 'open' })).map((x) => x.id),
    [B],
  );
  assert.deepEqual(
    visibleSessions(s, ui({ filter: 'archived' })).map((x) => x.id),
    [C],
  );
  assert.deepEqual(
    visibleSessions(s, ui({ query: 'CLIENT' })).map((x) => x.id),
    [B],
  );
  const html = sessionGroups(s, ui(), NOW);
  assert.match(html, /me@example\.com/);
  assert.match(html, /Client &lt;b&gt;bug&lt;\/b&gt;/, 'titles are escaped');
  assert.match(html, /dot busy/);
  assert.match(sessionGroups(s, ui({ filter: 'archived' }), NOW), /Unassigned[\s\S]*starts on default/);
  assert.match(sessionGroups(state({ folders: [] }), ui(), NOW), /Open a folder/);
  assert.match(sessionGroups(s, ui({ query: 'nothing like this' }), NOW), /No sessions match/);
  assert.match(
    sessionGroups(state({ sessions: [] }), ui(), NOW),
    /No sessions in this folder yet[\s\S]*New session/,
  );
  assert.match(
    sessionGroups(state({ sessions: [] }), ui({ filter: 'open' }), NOW),
    /No Claude Code tabs are open/,
  );
  assert.match(row(s, ui({ selected: A }), session({ movingTo: 'work' }), NOW), /→ work/);
  assert.match(row(s, ui({ selected: A }), session({}), NOW), /row selected/);
  assert.match(row(s, ui(), session({ running: { status: 'idle', here: false } }), NOW), /dot elsewhere/);
  assert.match(
    filterTabs(s, ui({ filter: 'open' })),
    /aria-selected="true" data-act="filter" data-filter="open"/,
  );
  assert.match(
    sectionHead(ui({ collapsed: { accounts: true } }), 'accounts', 'Accounts', 2),
    /aria-expanded="false"/,
  );
});

test('view: notices with an action', () => {
  assert.equal(notices([]), '');
  const html = notices([
    {
      id: 'launcher',
      level: 'error',
      text: 'The launcher is missing.',
      action: { label: 'Repair', command: 'manyHats.repair' },
    },
  ]);
  assert.match(html, /notice error/);
  assert.match(html, /data-command="manyHats\.repair"/);
});

test('view: the saved UI state is checked when the view comes back', () => {
  assert.deepEqual(restoreUi(undefined), ui());
  assert.deepEqual(restoreUi('garbage'), ui());
  assert.deepEqual(
    restoreUi({ collapsed: { accounts: true, sessions: false }, filter: 'open', query: 'bug', selected: A }),
    ui({ collapsed: { accounts: true }, filter: 'open', query: 'bug', selected: A }),
  );
  assert.deepEqual(
    restoreUi({ filter: 'everything', query: 7, selected: {}, hiddenLimits: { 'work:Opus limit': 'yes' } }),
    ui(),
    'wrong types and unknown filters fall back to the defaults',
  );
});

/** The menu's items as text, and a way to run one: what a click on it would do. */
function recorder(): { act: MenuActions; calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    act: {
      post: (m: ToHost) => calls.push(m),
      open: (id, account) => calls.push(['open', id, account]),
      rename: (id) => calls.push(['rename', id]),
    },
  };
}
const describe = (items: MenuItem[]): string[] =>
  items.map((it) =>
    'sep' in it
      ? '---'
      : 'header' in it
        ? `# ${it.header}`
        : `${it.label}${it.detail ? ` (${it.detail})` : ''}${it.disabled ? ' [off]' : ''}`,
  );
const run = (items: MenuItem[], label: string, detail?: string): void => {
  const it = items.find(
    (x) => 'run' in x && x.label === label && (detail === undefined || x.detail === detail),
  );
  assert.ok(it && 'run' in it, `no item ${label}`);
  it.run();
};

test('menus: a session — open on signed-in accounts, move to any, delete only when closed', () => {
  const s = state({
    accounts: [
      account({ email: 'me@example.com', isPick: true }),
      account({ name: 'work', email: 'me@work.example' }),
      account({ name: 'client', signedIn: false, expectedEmail: 'me@client.example' }),
    ],
  });
  const busy = session({ id: B, account: 'work', running: { status: 'busy', here: true } });
  const { act, calls } = recorder();
  const items = sessionMenuItems(s, busy, act);
  assert.deepEqual(describe(items), [
    'Open in a tab',
    'Rename',
    'Archive',
    'Copy session ID',
    '---',
    '# Open on account',
    'me@example.com (default)',
    'me@work.example (its own)',
    '# Move to account',
    'me@example.com (default)',
    'me@work.example (current) [off]',
    'me@client.example (not signed in)',
    '---',
    'Delete (close it first) [off]',
  ]);
  run(items, 'Open in a tab');
  run(items, 'me@example.com', 'default');
  run(items, 'Rename');
  run(items, 'me@client.example', 'not signed in');
  run(items, 'Archive');
  run(items, 'Copy session ID');
  assert.deepEqual(calls, [
    ['open', B, undefined],
    ['open', B, 'default'],
    ['rename', B],
    { type: 'move', id: B, account: 'client' },
    { type: 'archive', id: B, archived: true },
    { type: 'copyId', id: B },
  ]);

  const moving = sessionMenuItems(s, session({ archived: true, movingTo: 'work' }), act);
  const text = describe(moving);
  assert.ok(text.includes('Unarchive'));
  assert.ok(
    text.includes('me@work.example (current) [off]'),
    'a session on its way to an account is already there',
  );
  assert.ok(text.includes('me@example.com (its own)'), 'until it starts, it opens on its own account');
  assert.ok(text.includes('Delete…'));
  calls.length = 0;
  run(moving, 'Unarchive');
  run(moving, 'Delete…');
  assert.deepEqual(calls, [
    { type: 'archive', id: A, archived: false },
    { type: 'delete', id: A },
  ]);
});

test('menus: an account — the default can’t be removed; signed out, it can only sign in', () => {
  const { act, calls } = recorder();
  assert.deepEqual(describe(accountMenuItems(account({ isPick: true }), act)), [
    'New session',
    'New tabs start on this account [off]',
    'Sign in again…',
    'Refresh usage',
    'Usage details on claude.ai',
  ]);
  assert.ok(
    describe(accountMenuItems(account({ usageRefreshing: true }), act)).includes('Updating usage… [off]'),
  );
  const out = accountMenuItems(account({ name: 'client', signedIn: false }), act);
  assert.deepEqual(describe(out), [
    'New session [off]',
    'Use for new tabs',
    'Sign in…',
    'Refresh usage [off]',
    'Usage details on claude.ai',
    '---',
    'Remove account…',
  ]);
  for (const label of ['Use for new tabs', 'Sign in…', 'Usage details on claude.ai', 'Remove account…'])
    run(out, label);
  run(accountMenuItems(account({ name: 'work' }), act), 'New session');
  run(accountMenuItems(account({ name: 'work' }), act), 'Refresh usage');
  assert.deepEqual(calls, [
    { type: 'pick', account: 'client' },
    { type: 'signIn', account: 'client' },
    { type: 'usageDetails' },
    { type: 'removeAccount', account: 'client' },
    { type: 'new', account: 'work' },
    { type: 'refreshUsage', account: 'work' },
  ]);
});

test('renames: a rename stays over older states until one has it, or for 10 s', () => {
  const renames = new PendingRenames(10_000);
  renames.add(A, 'New name', NOW);
  assert.equal(
    renames.apply(state(), NOW + 100).sessions[0]?.title,
    'New name',
    'a state from before the rename',
  );
  renames.apply(state({ sessions: [session({ title: 'New name' })] }), NOW + 200);
  assert.equal(
    renames.apply(state(), NOW + 300).sessions[0]?.title,
    'Work',
    'once confirmed, the extension’s title wins',
  );

  const lost = new PendingRenames(10_000);
  lost.add(A, 'Never saved', NOW);
  assert.equal(lost.apply(state(), NOW + 9_999).sessions[0]?.title, 'Never saved');
  assert.equal(
    lost.apply(state(), NOW + 10_001).sessions[0]?.title,
    'Work',
    'a rename that never comes through stops',
  );

  const gone = new PendingRenames();
  gone.add(D, 'Deleted meanwhile', NOW);
  gone.apply(state(), NOW);
  const back = state({ sessions: [session({ id: D, title: 'Restored' })] });
  assert.equal(
    gone.apply(back, NOW + 1).sessions[0]?.title,
    'Restored',
    'a session missing from a state is let go',
  );
});
