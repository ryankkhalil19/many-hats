/** What the user can do to a session or an account: open it, rename it in place, and the pop-up menus. */
import { accountMenuItems, sessionMenuItems, type MenuActions } from './menuItems';
import { flush } from './render';
import { rowOf, select } from './selection';
import { account } from './view';
import type { Sidebar } from './sidebar';

export function openSession(sb: Sidebar, id: string, accountName?: string): void {
  const s = sb.session(id);
  if (!s) return;
  select(sb, id, false);
  const target = accountName ?? s.account ?? undefined;
  sb.post(target ? { type: 'open', id, account: target } : { type: 'open', id });
}

/** Swaps the row's title for a text box. Enter or leaving the box saves; Escape cancels. */
export function startRename(sb: Sidebar, id: string): void {
  if (sb.renaming) return;
  sb.menus.close(false); // closing may re-render, so the row is looked up after
  const s = sb.session(id);
  const r = rowOf(sb, id);
  if (!s || !r) return;
  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = s.title;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'New name');
  r.querySelector('.title')?.replaceWith(input);
  r.classList.add('renaming');
  sb.renaming = { id };
  input.focus();
  input.select();
  const done = (commit: boolean): void => {
    if (!sb.renaming) return;
    sb.renaming = null;
    const value = input.value.replace(/\s+/g, ' ').trim();
    if (commit && value && value !== s.title) {
      s.title = value; // show it right away; the next state confirms it
      sb.post({ type: 'rename', id, title: value });
    }
    flush(sb, true);
    rowOf(sb, id)?.focus();
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

const actionsFor = (sb: Sidebar): MenuActions => ({
  post: (m) => sb.post(m),
  open: (id, name) => openSession(sb, id, name),
  rename: (id) => startRename(sb, id),
});

export function showSessionMenu(
  sb: Sidebar,
  id: string,
  anchor: HTMLElement,
  point?: { x: number; y: number },
): void {
  const s = sb.session(id);
  if (!s || !sb.state) return;
  select(sb, id, false);
  sb.menus.open(sessionMenuItems(sb.state, s, actionsFor(sb)), anchor, point);
}

export function showAccountMenu(sb: Sidebar, name: string, anchor: HTMLElement): void {
  const a = sb.state ? account(sb.state, name) : undefined;
  if (!a) return;
  sb.menus.open(accountMenuItems(a, actionsFor(sb)), anchor);
}
