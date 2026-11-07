/** The sidebar's pop-up menus: keyboard navigable, closed by Escape, Tab, a click outside or a resize. */
import { esc } from './format';

export type MenuItem =
  | { sep: true }
  | { header: string }
  | {
      label: string;
      icon?: string;
      detail?: string;
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    };

interface OpenMenu {
  el: HTMLElement;
  anchor: HTMLElement;
  rowEl: HTMLElement | null;
}

export class Menus {
  private menu: OpenMenu | null = null;

  /** @param onClosed called after a menu closes, so state that arrived meanwhile can be shown */
  constructor(
    private readonly app: HTMLElement,
    private readonly onClosed: () => void,
  ) {
    document.addEventListener(
      'mousedown',
      (e) => {
        if (this.menu && !this.menu.el.contains(e.target as Node)) this.close(false);
      },
      true,
    );
    window.addEventListener('blur', () => this.close(false));
    window.addEventListener('resize', () => this.close(false));
  }

  get isOpen(): boolean {
    return this.menu !== null;
  }

  open(items: MenuItem[], anchor: HTMLElement, point?: { x: number; y: number }): void {
    this.close();
    const el = document.createElement('div');
    el.className = 'menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = items
      .map((it, i) => {
        if ('sep' in it) return '<div class="menu-sep" role="separator"></div>';
        if ('header' in it) return `<div class="menu-label">${esc(it.header)}</div>`;
        return `<button class="menu-item${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}"${it.disabled ? ' disabled' : ''}>
        <span class="ico">${it.icon ?? ''}</span><span class="mi-label">${esc(it.label)}</span>
        ${it.detail ? `<span class="mi-detail">${esc(it.detail)}</span>` : ''}${it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : ''}</button>`;
      })
      .join('');
    document.body.appendChild(el);
    for (const h of el.querySelectorAll<HTMLElement>('[data-hue]'))
      h.style.setProperty('--hue', h.dataset.hue ?? '0');
    const box = el.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    let x = point ? point.x : a.right - box.width;
    let y = point ? point.y : a.bottom + 4;
    if (y + box.height > innerHeight - 6) y = Math.max(6, (point ? point.y : a.top - 4) - box.height);
    x = Math.max(6, Math.min(x, innerWidth - box.width - 6));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const rowEl = anchor.closest<HTMLElement>('.row');
    rowEl?.classList.add('menu-open');
    this.menu = { el, anchor, rowEl };
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.menu-item');
      if (!b || b.disabled) return;
      const it = items[Number(b.dataset.i)];
      this.close(true);
      if (it && 'run' in it) it.run();
    });
    el.addEventListener('keydown', (e) => this.keys(e));
    el.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus();
  }

  close(keepFocus = true): void {
    if (!this.menu) return;
    const { el, anchor, rowEl } = this.menu;
    const key = (rowEl ?? anchor.closest<HTMLElement>('[data-key]'))?.dataset.key;
    this.menu = null;
    el.remove();
    rowEl?.classList.remove('menu-open');
    this.onClosed(); // may re-render, replacing the anchor
    if (!keepFocus) return;
    const target = document.contains(anchor)
      ? anchor
      : key
        ? this.app.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)
        : null;
    target?.focus({ preventScroll: true });
  }

  private keys(e: KeyboardEvent): void {
    if (!this.menu) return;
    const items = [...this.menu.el.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[n - 1]?.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      this.close();
    }
    e.stopPropagation();
  }
}
