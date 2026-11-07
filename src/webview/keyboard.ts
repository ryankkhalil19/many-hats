/**
 * The keys. In the session list: the arrows, Home and End move; Enter opens; F2 renames; Delete or
 * ⌘⌫ deletes; the context-menu key or ⇧F10 opens the menu. In the search box: ↓ goes to the list,
 * Escape clears. Enter or Space on a section or group heading folds it.
 */
import { openSession, showSessionMenu, startRename } from './actions';
import { refreshSessions } from './render';
import { rows, select, stepFocus } from './selection';
import type { Sidebar } from './sidebar';

export function bindKeyboard(sb: Sidebar): void {
  sb.app.addEventListener('keydown', (e) => {
    if (sb.busy) return;
    const t = e.target as HTMLElement;
    if (t.dataset.role === 'search') {
      searchKeys(sb, e, t as HTMLInputElement);
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
    rowKeys(sb, e, r, r.dataset.id);
  });
}

function searchKeys(sb: Sidebar, e: KeyboardEvent, input: HTMLInputElement): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const first = rows(sb)[0];
    if (first?.dataset.id) select(sb, first.dataset.id, true);
  }
  if (e.key === 'Escape' && sb.ui.query) {
    e.preventDefault();
    input.value = '';
    sb.ui.query = '';
    sb.save();
    refreshSessions(sb);
  }
}

/** How far each key moves the selection; Home and End go all the way. */
const STEPS = new Map([
  ['ArrowDown', 1],
  ['ArrowUp', -1],
  ['Home', -1e6],
  ['End', 1e6],
]);

function rowKeys(sb: Sidebar, e: KeyboardEvent, r: HTMLElement, id: string): void {
  const step = STEPS.get(e.key);
  if (step !== undefined) {
    e.preventDefault();
    stepFocus(sb, r, step);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    openSession(sb, id);
  } else if (e.key === 'F2') {
    e.preventDefault();
    startRename(sb, id);
  } else if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) {
    e.preventDefault();
    sb.post({ type: 'delete', id });
  } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
    e.preventDefault();
    showSessionMenu(sb, id, r);
  }
}
