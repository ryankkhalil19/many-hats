/** Clicks on the sidebar's buttons and rows, right-clicks, the search box, and focus moving onto a row. */
import { openSession, showAccountMenu, showSessionMenu, startRename } from './actions';
import { flush, refreshSessions, render } from './render';
import { select } from './selection';
import type { Sidebar } from './sidebar';
import type { Filter } from './view';

export function bindPointer(sb: Sidebar): void {
  const { app, ui } = sb;

  // A state that arrives between a press and its release would replace the element being
  // clicked, and the browser would drop the click. It waits until the click has happened.
  let safety: ReturnType<typeof setTimeout> | undefined;
  const released = (): void => {
    if (!sb.pressing) return;
    sb.pressing = false;
    clearTimeout(safety);
    setTimeout(() => flush(sb, false), 0); // after the click this release produces
  };
  app.addEventListener('pointerdown', () => {
    sb.pressing = true;
    clearTimeout(safety);
    safety = setTimeout(released, 2000); // a release outside the view can't hold states back for long
  });
  window.addEventListener('pointerup', released);
  window.addEventListener('pointercancel', released);
  window.addEventListener('blur', released);

  app.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const t = target.closest<HTMLElement>('[data-act]');
    const r = target.closest<HTMLElement>('.row');
    if (!t) {
      if (r?.dataset.id && !sb.renaming) openSession(sb, r.dataset.id);
      return;
    }
    e.stopPropagation();
    const id = r?.dataset.id ?? '';
    const acct = t.dataset.account ?? '';
    switch (t.dataset.act) {
      case 'toggle': {
        const k = t.dataset.toggle ?? '';
        ui.collapsed[k] = !ui.collapsed[k];
        sb.save();
        render(sb);
        break;
      }
      case 'toggleLimit': {
        const k = t.dataset.limit ?? '';
        if (ui.hiddenLimits[k]) delete ui.hiddenLimits[k];
        else ui.hiddenLimits[k] = true;
        sb.save();
        render(sb);
        break;
      }
      case 'open':
        openSession(sb, id);
        break;
      case 'rename':
        startRename(sb, id);
        break;
      case 'archive':
        sb.post({ type: 'archive', id, archived: true });
        break;
      case 'unarchive':
        sb.post({ type: 'archive', id, archived: false });
        break;
      case 'sessionMenu':
        showSessionMenu(sb, id, t);
        break;
      case 'accountMenu':
        showAccountMenu(sb, acct, t);
        break;
      case 'new':
        sb.post({ type: 'new', account: acct });
        break;
      case 'pick':
        sb.post({ type: 'pick', account: acct });
        break;
      case 'signIn':
        sb.post({ type: 'signIn', account: acct });
        break;
      case 'addAccount':
        sb.post({ type: 'addAccount' });
        break;
      case 'notice':
        sb.post({ type: 'notice', command: t.dataset.command ?? '' });
        break;
      case 'filter':
        ui.filter = (t.dataset.filter as Filter | undefined) ?? 'all';
        sb.save();
        refreshSessions(sb);
        break;
      default:
    }
  });

  app.addEventListener('contextmenu', (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (!r?.dataset.id || sb.renaming) return;
    e.preventDefault();
    showSessionMenu(sb, r.dataset.id, r, { x: e.clientX, y: e.clientY });
  });

  app.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.role !== 'search') return;
    ui.query = t.value;
    sb.save();
    refreshSessions(sb);
  });

  app.addEventListener('focusin', (e) => {
    const r = (e.target as HTMLElement).closest<HTMLElement>('.row');
    if (r && e.target === r && r.dataset.id && ui.selected !== r.dataset.id) select(sb, r.dataset.id, false);
  });
}
