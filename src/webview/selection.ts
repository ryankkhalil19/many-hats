/** The selected session row, and roving focus: the list is one tab stop, and the arrows move within it. */
import type { Sidebar } from './sidebar';

export const rows = (sb: Sidebar): HTMLElement[] => [...sb.app.querySelectorAll<HTMLElement>('.row')];

export const rowOf = (sb: Sidebar, id: string): HTMLElement | null =>
  sb.app.querySelector<HTMLElement>(`.row[data-id="${CSS.escape(id)}"]`);

/** The selected row (or the first) is the list's one tab stop. */
export function roving(sb: Sidebar): void {
  const all = rows(sb);
  const target = all.find((r) => r.dataset.id === sb.ui.selected) ?? all[0];
  for (const r of all) r.tabIndex = r === target ? 0 : -1;
}

export function select(sb: Sidebar, id: string, focus: boolean): void {
  sb.ui.selected = id;
  sb.save();
  for (const r of rows(sb)) r.classList.toggle('selected', r.dataset.id === id);
  roving(sb);
  if (focus) rowOf(sb, id)?.focus();
}

/** Selects and focuses the row `delta` rows away, stopping at the first and the last. */
export function stepFocus(sb: Sidebar, fromRow: HTMLElement, delta: number): void {
  const all = rows(sb);
  const i = all.indexOf(fromRow);
  const next = all[Math.max(0, Math.min(all.length - 1, i + delta))];
  if (next?.dataset.id) select(sb, next.dataset.id, true);
}
