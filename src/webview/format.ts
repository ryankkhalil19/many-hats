/** Formatting for the sidebar. Pure: no DOM, so it's tested under Node. */
import type { AccountView } from '../shared/protocol';

export function esc(s: string | number | null | undefined): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}

/** Avatar hues that stay apart from each other: teal, indigo, pink, amber, sky, violet, lime, red. */
const HUES = [172, 245, 330, 38, 200, 280, 95, 8];

/**
 * An account's avatar hue, by its place in the list (default first, then by name), so accounts
 * in one window never share a colour.
 */
export function hue(names: readonly string[], name: string): number {
  const i = names.indexOf(name);
  return HUES[(i < 0 ? 0 : i) % HUES.length] ?? HUES[0] ?? 0;
}

export function initial(label: string): string {
  return (label.replace(/[^a-zA-Z0-9]/g, '')[0] ?? '?').toUpperCase();
}

/** The letter on an account's avatar: its name's, or for the default account its email's. */
export function avatarLetter(a: AccountView): string {
  return initial(a.name === 'default' ? (a.email ?? a.expectedEmail ?? a.name) : a.name);
}

/** What an account is called in the UI: its email, else the email it should sign in as, else its name. */
export function labelOf(a: AccountView | undefined): string {
  if (!a) return 'Unassigned';
  return a.email ?? a.expectedEmail ?? (a.name === 'default' ? 'Main account' : a.name);
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function agoLong(ms: number, now = Date.now()): string {
  const a = ago(ms, now);
  if (a === 'now') return 'just now';
  return /\d[mhd]$/.test(a) ? `${a} ago` : `on ${a}`;
}

export function resetText(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (at - now < 24 * 3600 * 1000) return `Resets at ${time}`;
  return `Resets ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${time}`;
}

/** text with the first match of query marked. */
export function highlight(text: string, query: string): string {
  const q = query.trim();
  if (!q) return esc(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(text);
  return `${esc(text.slice(0, i))}<mark>${esc(text.slice(i, i + q.length))}</mark>${esc(text.slice(i + q.length))}`;
}
