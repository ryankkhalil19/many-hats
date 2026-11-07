/** Puts the state on screen. The markup comes from view.ts; this file places it and keeps focus. */
import { I } from './icons';
import { esc, labelOf } from './format';
import { roving } from './selection';
import { account, card, filterTabs, notices, sectionHead, sessionGroups } from './view';
import type { Sidebar } from './sidebar';
import type { SidebarState } from '../shared/protocol';

function mount(sb: Sidebar): void {
  sb.app.innerHTML = `
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
  const search = sb.app.querySelector<HTMLInputElement>('[data-role="search"]');
  if (search) search.value = sb.ui.query;
}

/** One of the elements mount() creates. */
const part = (sb: Sidebar, selector: string): HTMLElement => sb.app.querySelector(selector) as HTMLElement;

export function render(sb: Sidebar): void {
  const { app, state, ui } = sb;
  if (!state) {
    app.innerHTML = '<div class="loading">Loading accounts…</div>';
    return;
  }
  if (!app.querySelector('#sec-accounts')) mount(sb);
  const scroller = document.scrollingElement;
  const scroll = scroller?.scrollTop ?? 0;
  const focusKey = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-key]')?.dataset
    .key;

  part(sb, '#notices').innerHTML = notices(state.notices);
  const accSec = part(sb, '#sec-accounts');
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

  renderSessions(sb, state);
  finish(sb);
  if (scroller) scroller.scrollTop = scroll;
  if (focusKey)
    app.querySelector<HTMLElement>(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function renderSessions(sb: Sidebar, state: SidebarState): void {
  const { ui } = sb;
  part(sb, '#sec-sessions').classList.toggle('collapsed', Boolean(ui.collapsed.sessions));
  const pickLabel = labelOf(account(state, state.pick));
  part(sb, '#sessions-head').innerHTML = sectionHead(
    ui,
    'sessions',
    'Sessions',
    null,
    `<button class="icon-btn" data-act="new" data-account="${esc(state.pick)}" title="New session on ${esc(pickLabel)}" aria-label="New session">${I.plus}</button>`,
  );
  part(sb, '#seg').innerHTML = filterTabs(state, ui);
  part(sb, '#groups').innerHTML = sessionGroups(state, ui);
}

/** Re-renders only the sessions, after the filter or the search changed. */
export function refreshSessions(sb: Sidebar): void {
  if (!sb.state) return;
  renderSessions(sb, sb.state);
  finish(sb);
}

/** Bar widths and avatar colours are set from script: the page's CSP allows no inline styles in markup. */
function finish(sb: Sidebar): void {
  for (const el of sb.app.querySelectorAll<HTMLElement>('[data-w]')) el.style.width = `${el.dataset.w ?? 0}%`;
  for (const el of sb.app.querySelectorAll<HTMLElement>('[data-hue]'))
    el.style.setProperty('--hue', el.dataset.hue ?? '0');
  roving(sb);
}

/** A new state from the extension: shown now, or kept until the rename or the menu closes. */
export function receive(sb: Sidebar, state: SidebarState): void {
  if (sb.busy) {
    sb.pending = state;
    return;
  }
  sb.state = state;
  render(sb);
}

/** Shows a state that arrived while the user was busy; with `always`, re-renders even without one. */
export function flush(sb: Sidebar, always: boolean): void {
  if (sb.busy) return;
  if (sb.pending) {
    sb.state = sb.pending;
    sb.pending = null;
    render(sb);
  } else if (always) {
    render(sb);
  }
}
