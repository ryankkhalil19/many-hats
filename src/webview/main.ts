/**
 * The Many Hats sidebar. Renders the state the extension sends and posts back what the user asks
 * for; the extension checks every message (shared/protocol.ts). Markup comes from view.ts.
 */
import { I } from './icons';
import { avatarLetter, esc, hue, labelOf } from './format';
import { Menus, type MenuItem } from './menu';
import {
  account,
  card,
  filterTabs,
  notices,
  sectionHead,
  sessionGroups,
  type Filter,
  type UiState,
} from './view';
import type { AccountView, SessionView, SidebarState, ToHost, ToWebview } from '../shared/protocol';

interface VsCodeApi {
  getState(): unknown;
  setState(state: unknown): void;
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const saved = (vscode.getState() ?? {}) as Partial<UiState>;
const ui: UiState = {
  collapsed: saved.collapsed ?? {},
  filter: saved.filter ?? 'all',
  query: saved.query ?? '',
  selected: saved.selected ?? null,
  hiddenLimits: saved.hiddenLimits ?? {},
};
let state: SidebarState | null = null;
let pending: SidebarState | null = null;
let renaming: { id: string } | null = null;
const app = document.getElementById('app') as HTMLElement;
const menus = new Menus(app, () => flush(false));

const save = (): void => vscode.setState(ui);
const post = (m: ToHost): void => vscode.postMessage(m);
const sessionById = (id: string): SessionView | undefined => state?.sessions.find((s) => s.id === id);

// ---------- rendering ----------
function mount(): void {
  app.innerHTML = `
      <div id="notices"></div>
      <section class="section" id="sec-accounts"></section>
      <section class="section" id="sec-sessions">
        <div id="sessions-head"></div>
        <div class="section-body">
          <div class="toolbar">
            <label class="search">${I.search}<input type="search" placeholder="Search sessions" aria-label="Search sessions" spellcheck="false" data-role="search"></label>
            <div class="seg" id="seg" role="tablist" aria-label="Which sessions"></div>
          </div>
          <div class="groups" id="groups" role="list"></div>
        </div>
      </section>`;
  const search = app.querySelector<HTMLInputElement>('[data-role="search"]');
  if (search) search.value = ui.query;
}

function render(): void {
  if (!state) {
    app.innerHTML = '<div class="loading">Loading accounts…</div>';
    return;
  }
  if (!app.querySelector('#sec-accounts')) mount();
  const scroller = document.scrollingElement;
  const scroll = scroller?.scrollTop ?? 0;
  const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset
    .key;

  (app.querySelector('#notices') as HTMLElement).innerHTML = notices(state.notices);
  const accSec = app.querySelector('#sec-accounts') as HTMLElement;
  accSec.classList.toggle('collapsed', Boolean(ui.collapsed.accounts));
  const now = Date.now();
  const names = state.accounts.map((a) => a.name);
  accSec.innerHTML =
    sectionHead(
      ui,
      'accounts',
      'Accounts & usage',
      state.accounts.length,
      `<button class="icon-btn" data-act="addAccount" title="Add an account" aria-label="Add an account">${I.plus}</button>`,
    ) +
    `<div class="section-body"><div class="cards">${state.accounts.map((a) => card(ui, a, now, names)).join('')}</div></div>`;

  renderSessions();
  finish();
  if (scroller) scroller.scrollTop = scroll;
  if (focusKey)
    app.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function renderSessions(): void {
  if (!state) return;
  const head = app.querySelector('#sessions-head') as HTMLElement;
  const sec = app.querySelector('#sec-sessions') as HTMLElement;
  sec.classList.toggle('collapsed', Boolean(ui.collapsed.sessions));
  const pickLabel = labelOf(account(state, state.pick));
  head.innerHTML = sectionHead(
    ui,
    'sessions',
    'Sessions',
    null,
    `<button class="icon-btn" data-act="new" data-account="${esc(state.pick)}" title="New session on ${esc(pickLabel)}" aria-label="New session">${I.plus}</button>`,
  );
  (app.querySelector('#seg') as HTMLElement).innerHTML = filterTabs(state, ui);
  (app.querySelector('#groups') as HTMLElement).innerHTML = sessionGroups(state, ui);
}

/** Bar widths and avatar colours are set from script: the page's CSP allows no inline styles in markup. */
function finish(): void {
  for (const el of app.querySelectorAll<HTMLElement>('[data-w]')) el.style.width = `${el.dataset.w ?? 0}%`;
  for (const el of app.querySelectorAll<HTMLElement>('[data-hue]'))
    el.style.setProperty('--hue', el.dataset.hue ?? '0');
  roving();
}

// ---------- selection and keyboard ----------
const rows = (): HTMLElement[] => [...app.querySelectorAll<HTMLElement>('.row')];

function roving(): void {
  const all = rows();
  const target = all.find((r) => r.dataset.id === ui.selected) ?? all[0];
  for (const r of all) r.tabIndex = r === target ? 0 : -1;
}

function select(id: string, focus: boolean): void {
  ui.selected = id;
  save();
  for (const r of rows()) r.classList.toggle('selected', r.dataset.id === id);
  roving();
  if (focus) app.querySelector<HTMLElement>(`.row[data-id="${CSS.escape(id)}"]`)?.focus();
}

function stepFocus(fromRow: HTMLElement, delta: number): void {
  const all = rows();
  const i = all.indexOf(fromRow);
  const next = all[Math.max(0, Math.min(all.length - 1, i + delta))];
  if (next?.dataset.id) select(next.dataset.id, true);
}

function open(id: string, accountName?: string): void {
  const s = sessionById(id);
  if (!s) return;
  select(id, false);
  const target = accountName ?? s.account ?? undefined;
  post(target ? { type: 'open', id, account: target } : { type: 'open', id });
}

// ---------- rename ----------
function startRename(id: string): void {
  const s = sessionById(id);
  const r = app.querySelector<HTMLElement>(`.row[data-id="${CSS.escape(id)}"]`);
  if (!s || !r || renaming) return;
  menus.close(false);
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = s.title;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'New name');
  r.querySelector('.title')?.replaceWith(input);
  r.classList.add('renaming');
  renaming = { id };
  input.focus();
  input.select();
  const done = (commit: boolean): void => {
    if (!renaming) return;
    renaming = null;
    const value = input.value.replace(/\s+/g, ' ').trim();
    if (commit && value && value !== s.title) {
      s.title = value; // show it right away; the next state confirms it
      post({ type: 'rename', id, title: value });
    }
    flush(true);
    app.querySelector<HTMLElement>(`.row[data-id="${CSS.escape(id)}"]`)?.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      done(true);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      done(false);
    }
  });
  input.addEventListener('blur', () => done(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

// ---------- menus ----------
function avatar(a: AccountView): string {
  return `<span class="avatar sm" data-hue="${hue(state?.accounts.map((x) => x.name) ?? [], a.name)}">${esc(avatarLetter(a))}</span>`;
}

function sessionMenu(id: string, anchor: HTMLElement, point?: { x: number; y: number }): void {
  const s = sessionById(id);
  if (!s || !state) return;
  select(id, false);
  const current = s.movingTo ?? s.account;
  const items: MenuItem[] = [
    { label: 'Open in a tab', icon: I.open, kbd: '↵', run: () => open(id) },
    { label: 'Rename', icon: I.edit, kbd: 'F2', run: () => startRename(id) },
    s.archived
      ? { label: 'Unarchive', icon: I.unarchive, run: () => post({ type: 'archive', id, archived: false }) }
      : { label: 'Archive', icon: I.archive, run: () => post({ type: 'archive', id, archived: true }) },
    { label: 'Copy session ID', icon: I.copy, run: () => post({ type: 'copyId', id }) },
    { sep: true },
    { header: 'Open on account' },
    ...state.accounts
      .filter((a) => a.signedIn)
      .map((a): MenuItem => ({
        label: labelOf(a),
        detail: a.name === s.account ? 'its own' : a.name,
        icon: avatar(a),
        run: () => open(id, a.name),
      })),
    { header: 'Move to account' },
    ...state.accounts.map((a): MenuItem => ({
      label: labelOf(a),
      icon: I.move,
      detail: a.name === current ? 'current' : a.signedIn ? a.name : 'not signed in',
      disabled: a.name === current,
      run: () => post({ type: 'move', id, account: a.name }),
    })),
    { sep: true },
    {
      label: s.running ? 'Delete (close it first)' : 'Delete…',
      icon: I.trash,
      kbd: '⌘⌫',
      danger: true,
      disabled: Boolean(s.running),
      run: () => post({ type: 'delete', id }),
    },
  ];
  menus.open(items, anchor, point);
}

function accountMenu(name: string, anchor: HTMLElement): void {
  const a = state ? account(state, name) : undefined;
  if (!a) return;
  const items: MenuItem[] = [
    {
      label: 'New session',
      icon: I.plus,
      disabled: !a.signedIn,
      run: () => post({ type: 'new', account: name }),
    },
    {
      label: a.isPick ? 'New tabs start on this account' : 'Use for new tabs',
      icon: I.check,
      disabled: a.isPick,
      run: () => post({ type: 'pick', account: name }),
    },
    {
      label: a.signedIn ? 'Sign in again…' : 'Sign in…',
      icon: I.key,
      run: () => post({ type: 'signIn', account: name }),
    },
    { label: 'Usage details on claude.ai', icon: I.chart, run: () => post({ type: 'usageDetails' }) },
  ];
  if (name !== 'default')
    items.push(
      { sep: true },
      {
        label: 'Remove account…',
        icon: I.trash,
        danger: true,
        run: () => post({ type: 'removeAccount', account: name }),
      },
    );
  menus.open(items, anchor);
}

// ---------- state updates ----------
/** Apply a state that arrived while the user was renaming or in a menu. */
function flush(always: boolean): void {
  if (renaming || menus.isOpen) return;
  if (pending) {
    state = pending;
    pending = null;
    render();
  } else if (always) {
    render();
  }
}

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  const m = e.data;
  if (m?.type !== 'state') return;
  if (renaming || menus.isOpen) pending = m.state;
  else {
    state = m.state;
    render();
  }
});

// ---------- events ----------
app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const t = target.closest<HTMLElement>('[data-act]');
  const r = target.closest<HTMLElement>('.row');
  if (!t) {
    if (r?.dataset.id && !renaming) open(r.dataset.id);
    return;
  }
  e.stopPropagation();
  const id = r?.dataset.id ?? '';
  const acct = t.dataset.account ?? '';
  switch (t.dataset.act) {
    case 'toggle': {
      const k = t.dataset.toggle ?? '';
      ui.collapsed[k] = !ui.collapsed[k];
      save();
      render();
      break;
    }
    case 'toggleLimit': {
      const k = t.dataset.limit ?? '';
      if (ui.hiddenLimits[k]) delete ui.hiddenLimits[k];
      else ui.hiddenLimits[k] = true;
      save();
      render();
      break;
    }
    case 'open':
      open(id);
      break;
    case 'rename':
      startRename(id);
      break;
    case 'archive':
      post({ type: 'archive', id, archived: true });
      break;
    case 'unarchive':
      post({ type: 'archive', id, archived: false });
      break;
    case 'sessionMenu':
      sessionMenu(id, t);
      break;
    case 'accountMenu':
      accountMenu(acct, t);
      break;
    case 'new':
      post({ type: 'new', account: acct });
      break;
    case 'pick':
      post({ type: 'pick', account: acct });
      break;
    case 'signIn':
      post({ type: 'signIn', account: acct });
      break;
    case 'addAccount':
      post({ type: 'addAccount' });
      break;
    case 'notice':
      post({ type: 'notice', command: t.dataset.command ?? '' });
      break;
    case 'filter':
      ui.filter = (t.dataset.filter as Filter | undefined) ?? 'all';
      save();
      renderSessions();
      finish();
      break;
    default:
  }
});

app.addEventListener('contextmenu', (e) => {
  const r = (e.target as HTMLElement).closest<HTMLElement>('.row');
  if (!r?.dataset.id || renaming) return;
  e.preventDefault();
  sessionMenu(r.dataset.id, r, { x: e.clientX, y: e.clientY });
});

app.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.dataset.role !== 'search') return;
  ui.query = t.value;
  save();
  renderSessions();
  finish();
});

app.addEventListener('keydown', (e) => {
  if (renaming || menus.isOpen) return;
  const t = e.target as HTMLElement;
  if (t.dataset.role === 'search') {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = rows()[0];
      if (first?.dataset.id) select(first.dataset.id, true);
    }
    if (e.key === 'Escape' && ui.query) {
      e.preventDefault();
      (t as HTMLInputElement).value = '';
      ui.query = '';
      save();
      renderSessions();
      finish();
    }
    return;
  }
  const head = t.closest<HTMLElement>('.section-head, .group-head');
  if (head && (e.key === 'Enter' || e.key === ' ') && t === head) {
    e.preventDefault();
    head.click();
    return;
  }
  const r = t.closest<HTMLElement>('.row');
  if (!r || t !== r || !r.dataset.id) return;
  const id = r.dataset.id;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    stepFocus(r, 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    stepFocus(r, -1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    stepFocus(r, -1e6);
  } else if (e.key === 'End') {
    e.preventDefault();
    stepFocus(r, 1e6);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    open(id);
  } else if (e.key === 'F2') {
    e.preventDefault();
    startRename(id);
  } else if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
    e.preventDefault();
    post({ type: 'delete', id });
  } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault();
    sessionMenu(id, r);
  }
});

app.addEventListener('focusin', (e) => {
  const r = (e.target as HTMLElement).closest<HTMLElement>('.row');
  if (r && e.target === r && r.dataset.id && ui.selected !== r.dataset.id) select(r.dataset.id, false);
});

// Relative times and reset times move on even when nothing else changes.
setInterval(() => {
  if (state && !renaming && !menus.isOpen) render();
}, 30000);

render();
post({ type: 'ready' });
