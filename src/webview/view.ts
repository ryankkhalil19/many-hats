/**
 * The sidebar's markup, as pure functions of the state and the UI's own choices (collapsed
 * sections, filter, search, hidden limits). No DOM here, so it's tested under Node.
 */
import { I } from './icons';
import { agoLong, ago, avatarLetter, esc, highlight, hue, labelOf, resetText } from './format';
import type { AccountView, Notice, SessionView, SidebarState, UsageLimit } from '../shared/protocol';

export type Filter = 'all' | 'open' | 'archived';

export interface UiState {
  collapsed: Record<string, boolean>;
  filter: Filter;
  query: string;
  selected: string | null;
  /** Per-model limit rows hidden by the user, by "<account>:<label>". Account names can't contain ":". */
  hiddenLimits: Record<string, boolean>;
}

const FILTERS: readonly string[] = ['all', 'open', 'archived'] satisfies Filter[];

/** The UI state the view saved last time, checked: anything unexpected falls back to the default. */
export function restoreUi(saved: unknown): UiState {
  const s = saved !== null && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  return {
    collapsed: flags(s.collapsed),
    filter: typeof s.filter === 'string' && FILTERS.includes(s.filter) ? (s.filter as Filter) : 'all',
    query: typeof s.query === 'string' ? s.query : '',
    selected: typeof s.selected === 'string' ? s.selected : null,
    hiddenLimits: flags(s.hiddenLimits),
  };
}

/** The keys set to true; anything else reads as false anyway. */
function flags(value: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (value !== null && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) if (v === true) out[k] = true;
  return out;
}

export function account(state: SidebarState, name: string | null | undefined): AccountView | undefined {
  return state.accounts.find((a) => a.name === name);
}

export function sectionHead(
  ui: UiState,
  key: string,
  label: string,
  count: number | null,
  extra = '',
): string {
  const open = !ui.collapsed[key];
  return `<div class="section-head" role="button" tabindex="0" aria-expanded="${open}" data-act="toggle" data-toggle="${key}" data-key="section:${key}">
      <span class="chev">${I.chevron}</span><span class="section-title">${esc(label)}</span>
      ${count === null ? '' : `<span class="count">${count}</span>`}<span class="spacer"></span>${extra}</div>`;
}

export function notices(list: readonly Notice[]): string {
  if (!list.length) return '';
  return `<div class="notices">${list
    .map(
      (n) =>
        `<div class="notice ${n.level}" role="status">${I.warning}<span class="notice-text">${esc(n.text)}</span>${
          n.action
            ? `<button class="btn ghost" data-act="notice" data-command="${esc(n.action.command)}">${esc(n.action.label)}</button>`
            : ''
        }</div>`,
    )
    .join('')}</div>`;
}

export function card(
  ui: UiState,
  a: AccountView,
  now = Date.now(),
  names: readonly string[] = [a.name],
): string {
  const label = labelOf(a);
  const meta = [a.name, a.plan, a.openHere ? `${a.openHere} open here` : null].filter(Boolean).join(' · ');
  const rows: string[] = [];
  const shows: string[] = []; // the ▾ buttons of the limits hidden on this account
  for (const l of a.usage?.limits ?? []) {
    const r = limitRow(ui, l, a.name, now);
    (r.hidden ? shows : rows).push(r.html);
  }
  const limits = rows.length
    ? rows.join('')
    : `<div class="note">${a.usageRefreshing ? 'Getting this account’s usage…' : 'No usage figures yet.'}</div>`;
  const foot = usageFoot(a, now, shows);
  const n = esc(a.name);
  const body = a.signedIn
    ? `<div class="limits">${limits}${foot}</div>`
    : `<div class="note">Not signed in${a.expectedEmail ? `: sign in as ${esc(a.expectedEmail)}` : ''}.</div>`;
  const actions = a.signedIn
    ? `<button class="btn" data-act="new" data-account="${n}" title="Open a new Claude Code tab on this account">${I.plus}<span>New session</span></button>
         ${
           a.isPick
             ? `<span class="pick-note" title="New Claude Code tabs in this window start on this account">${I.check}New tabs start here</span>`
             : `<button class="btn ghost" data-act="pick" data-account="${n}" title="Make new Claude Code tabs in this window start on this account">Use for new tabs</button>`
         }`
    : `<button class="btn primary" data-act="signIn" data-account="${n}">${I.key}<span>Sign in</span></button>`;
  return `<div class="card${a.isPick ? ' is-pick' : ''}${a.signedIn ? '' : ' signed-out'}" data-account="${n}" data-key="account:${n}">
      <div class="card-head">
        <span class="avatar" data-hue="${hue(names, a.name)}" aria-hidden="true">${esc(avatarLetter(a))}</span>
        <div class="who"><div class="email" title="${esc(label)}">${esc(label)}</div><div class="meta" title="${esc([meta, a.tier].filter(Boolean).join(' · '))}">${esc(meta)}</div></div>
        <button class="icon-btn" data-act="accountMenu" data-account="${n}" title="Account actions" aria-label="Actions for ${esc(label)}" aria-haspopup="menu">${I.more}</button>
      </div>
      ${body}
      ${a.usage?.credits ? `<div class="sub">Usage credits: ${esc(a.usage.credits.used)} used</div>` : ''}
      <div class="card-foot">${actions}</div>
    </div>`;
}

/** Figures this old are past what Claude Code itself still trusts, so they're marked. */
export const STALE_USAGE_MS = 60 * 60_000;

/**
 * The line under an account's limits: when its figures are from (or that they're updating, or
 * that a refresh failed), the ▾ of each hidden limit, and a button to refresh the figures now.
 */
function usageFoot(a: AccountView, now: number, shows: readonly string[]): string {
  const fetched = a.usage?.fetchedAtMs;
  const busy = Boolean(a.usageRefreshing);
  const stale = fetched !== undefined && now - fetched > STALE_USAGE_MS;
  const when = busy
    ? '<span class="updated" role="status">Updating…</span>'
    : fetched
      ? `<span class="updated${stale ? ' stale' : ''}" title="When Claude Code last fetched this account’s usage">Updated ${esc(agoLong(fetched, now))}</span>`
      : '';
  const failed =
    a.usageError && !busy
      ? `<span class="usage-error" title="${esc(a.usageError)}">${fetched ? 'Couldn’t refresh' : 'Couldn’t get usage'}</span>`
      : '';
  const n = esc(a.name);
  const button = `<button class="icon-btn usage-refresh${busy ? ' spinning' : ''}" data-act="refreshUsage" data-account="${n}" data-key="refresh:${n}"
      title="${busy ? 'Updating usage…' : 'Refresh usage now'}" aria-label="Refresh usage for ${esc(labelOf(a))}"${busy ? ' aria-disabled="true" aria-busy="true"' : ''}>${I.refresh}</button>`;
  return `<div class="limits-foot">${when}${failed}${shows.join('')}${button}</div>`;
}

/**
 * One usage window. A per-model limit can be hidden on one account: its label, percentage and
 * bar go, and only its ▾ button stays (at the end of the card's "Updated" line) to show it again.
 */
export function limitRow(
  ui: UiState,
  l: UsageLimit,
  accountName: string,
  now = Date.now(),
): { hidden: boolean; html: string } {
  const sub = l.reset ? 'Reset since the last update' : l.resetsAt ? resetText(l.resetsAt, now) : '';
  const canHide = l.kind === 'weekly_scoped';
  const hideKey = `${accountName}:${l.label}`;
  const hidden = canHide && Boolean(ui.hiddenLimits[hideKey]);
  const toggle = canHide
    ? `<button class="icon-btn limit-toggle" data-act="toggleLimit" data-limit="${esc(hideKey)}" data-key="limit:${esc(hideKey)}"
          aria-expanded="${!hidden}" title="${hidden ? `Show ${esc(l.label)} (${l.percent}%)` : `Hide ${esc(l.label)}`}"
          aria-label="${hidden ? 'Show' : 'Hide'} ${esc(l.label)}">${hidden ? I.maximize : I.minimize}</button>`
    : '';
  if (hidden) return { hidden: true, html: toggle };
  return {
    hidden: false,
    html: `<div class="limit level-${l.level}${l.active ? ' active' : ''}"${l.active ? ' title="The limit currently in effect"' : ''}>
      <div class="limit-top"><span class="limit-label">${esc(l.label)}</span><span class="pct">${l.percent}%</span>${toggle}</div>
      <div class="bar" role="progressbar" aria-label="${esc(l.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${l.percent}"><i data-w="${l.percent}"></i></div>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
    </div>`,
  };
}

export function visibleSessions(state: SidebarState, ui: UiState): SessionView[] {
  const q = ui.query.trim().toLowerCase();
  return state.sessions
    .filter((s) =>
      ui.filter === 'archived' ? s.archived : ui.filter === 'open' ? s.running && !s.archived : !s.archived,
    )
    .filter((s) => !q || s.title.toLowerCase().includes(q));
}

export function counts(state: SidebarState): Record<Filter, number> {
  const all = state.sessions;
  return {
    all: all.filter((s) => !s.archived).length,
    open: all.filter((s) => s.running && !s.archived).length,
    archived: all.filter((s) => s.archived).length,
  };
}

export function filterTabs(state: SidebarState, ui: UiState): string {
  const c = counts(state);
  const tabs: [Filter, string][] = [
    ['all', 'All'],
    ['open', 'Open'],
    ['archived', 'Archived'],
  ];
  return tabs
    .map(
      ([k, label]) =>
        `<button role="tab" aria-selected="${ui.filter === k}" data-act="filter" data-filter="${k}">${label}<span class="n">${c[k]}</span></button>`,
    )
    .join('');
}

export function sessionGroups(state: SidebarState, ui: UiState, now = Date.now()): string {
  const pick = esc(state.pick);
  const shown = visibleSessions(state, ui);
  const order: (string | null)[] = [...state.accounts.map((a) => a.name), null];
  const groups = order
    .map((name) => ({ name, items: shown.filter((s) => s.account === name) }))
    .filter((g) => g.items.length);
  if (!state.folders.length) return '<div class="empty">Open a folder to see its Claude Code sessions.</div>';
  if (groups.length) return groups.map((g) => group(state, ui, g, now)).join('');
  const q = ui.query.trim();
  const msg = q
    ? 'No sessions match.'
    : ui.filter === 'archived'
      ? 'Nothing archived.'
      : ui.filter === 'open'
        ? 'No Claude Code tabs are open.'
        : 'No sessions in this folder yet.';
  const button =
    !q && ui.filter === 'all'
      ? `<button class="btn" data-act="new" data-account="${pick}">${I.plus}<span>New session</span></button>`
      : '';
  return `<div class="empty">${msg}${button}</div>`;
}

function group(
  state: SidebarState,
  ui: UiState,
  g: { name: string | null; items: SessionView[] },
  now: number,
): string {
  const key = `group:${g.name ?? 'other'}`;
  const a = account(state, g.name);
  const label = labelOf(a);
  const sub = g.name === null ? `starts on ${state.pick}` : a?.email && a.name !== 'default' ? a.name : '';
  const tip =
    g.name === null
      ? `Not linked to an account yet. Opening one starts it on ${labelOf(account(state, state.pick))} (the account for new tabs) and links it there; Move links it to another account.`
      : label;
  const open = !ui.collapsed[key];
  const avatar =
    g.name === null
      ? '<span class="avatar sm other" aria-hidden="true">?</span>'
      : `<span class="avatar sm" data-hue="${hue(
          state.accounts.map((x) => x.name),
          g.name,
        )}" aria-hidden="true">${esc(a ? avatarLetter(a) : '?')}</span>`;
  const add = a?.signedIn
    ? `<button class="icon-btn" data-act="new" data-account="${esc(g.name)}" title="New session on ${esc(label)}" aria-label="New session on ${esc(label)}">${I.plus}</button>`
    : '';
  return `<div class="group${open ? '' : ' collapsed'}" role="listitem">
      <div class="group-head" role="button" tabindex="-1" aria-expanded="${open}" data-act="toggle" data-toggle="${esc(key)}" data-key="${esc(key)}" title="${esc(tip)}">
        <span class="chev">${I.chevron}</span>${avatar}
        <span class="group-title">${esc(label)}</span>
        ${sub ? `<span class="group-sub">${esc(sub)}</span>` : ''}
        <span class="count">${g.items.length}</span><span class="spacer"></span>${add}
      </div>
      <div class="rows" role="list">${g.items.map((s) => row(state, ui, s, now)).join('')}</div>
    </div>`;
}

export function row(state: SidebarState, ui: UiState, s: SessionView, now = Date.now()): string {
  const dot = s.running ? (s.running.here ? s.running.status : 'elsewhere') : 'none';
  const status = {
    busy: 'Working, open in this window',
    idle: 'Open in this window',
    elsewhere: 'Open in another window',
    none: '',
  }[dot];
  const sel = ui.selected === s.id;
  const chip = s.movingTo
    ? `<span class="chip" title="Moves to ${esc(labelOf(account(state, s.movingTo)))} when it next starts">→ ${esc(s.movingTo)}</span>`
    : '';
  return `<div class="row${sel ? ' selected' : ''}" role="listitem" tabindex="-1" data-id="${esc(s.id)}" data-key="session:${esc(s.id)}" aria-label="${esc(s.title)}${status ? `, ${status}` : ''}">
      <span class="dot ${dot}"${status ? ` title="${esc(status)}"` : ''}></span>
      <span class="title" title="${esc(s.title)}">${highlight(s.title, ui.query)}</span>
      ${chip}
      <span class="time" title="Last activity ${esc(new Date(s.updatedAt).toLocaleString())}">${ago(s.updatedAt, now)}</span>
      <span class="actions">
        <button class="icon-btn" data-act="open" title="Open in a tab (Enter)" aria-label="Open">${I.open}</button>
        <button class="icon-btn" data-act="rename" title="Rename (F2)" aria-label="Rename">${I.edit}</button>
        <button class="icon-btn" data-act="${s.archived ? 'unarchive' : 'archive'}" title="${s.archived ? 'Unarchive' : 'Archive'}" aria-label="${s.archived ? 'Unarchive' : 'Archive'}">${s.archived ? I.unarchive : I.archive}</button>
        <button class="icon-btn" data-act="sessionMenu" title="More actions" aria-label="More actions" aria-haspopup="menu">${I.more}</button>
      </span>
    </div>`;
}
