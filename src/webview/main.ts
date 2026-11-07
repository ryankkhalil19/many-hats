/**
 * The Many Hats sidebar. It renders the state the extension sends and posts back what the user asks
 * for; the extension checks every message (shared/protocol.ts).
 *
 *   sidebar.ts     the state: what the extension sent, the UI's own choices, what's in progress
 *   render.ts      puts it on screen, with the markup from view.ts (pure, tested under Node)
 *   selection.ts   the selected row and roving focus
 *   actions.ts     open, rename in place, and the menus (menu.ts shows them; menuItems.ts fills them)
 *   events.ts      clicks, right-clicks and the search box
 *   keyboard.ts    the keys
 */
import { bindPointer } from './events';
import { bindKeyboard } from './keyboard';
import { flush, receive, render } from './render';
import { Sidebar, type VsCodeApi } from './sidebar';
import type { ToWebview } from '../shared/protocol';

declare function acquireVsCodeApi(): VsCodeApi;

const sb: Sidebar = new Sidebar(acquireVsCodeApi(), document.getElementById('app') as HTMLElement, () =>
  flush(sb, false),
);
bindPointer(sb);
bindKeyboard(sb);

window.addEventListener('message', (e: MessageEvent<ToWebview>) => {
  if (e.data?.type === 'state') receive(sb, e.data.state);
});

// Relative times and reset times move on even when nothing else changes.
setInterval(() => {
  if (sb.state && !sb.busy) render(sb);
}, 30000);

render(sb);
sb.post({ type: 'ready' });
