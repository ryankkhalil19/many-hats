/** 16px line icons, stroked with currentColor so they follow the theme. */
const svg = (d: string): string => `<svg viewBox="0 0 16 16" aria-hidden="true">${d}</svg>`;
const dots =
  '<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>';

export const I = {
  chevron: svg('<path d="M6 3.5 10.5 8 6 12.5"/>'),
  minimize: svg('<path d="M4 10 8 6l4 4"/>'),
  maximize: svg('<path d="M4 6l4 4 4-4"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  open: svg(
    '<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H6"/>',
  ),
  edit: svg('<path d="M10.6 2.9a1.5 1.5 0 0 1 2.1 2.1L5.4 12.3 2.6 13.4l1.1-2.8z"/>'),
  archive: svg('<path d="M2.5 3h11v3h-11zM3.5 6v7h9V6M6.5 9h3"/>'),
  unarchive: svg('<path d="M2.5 3h11v3h-11zM3.5 6v7h9V6M8 12V8.5M6.5 10 8 8.5 9.5 10"/>'),
  trash: svg('<path d="M2.5 4.5h11M6 4.5V2.8h4v1.7M4 4.5l.6 8.7h6.8l.6-8.7M6.7 7v4.2M9.3 7v4.2"/>'),
  more: svg(dots),
  move: svg('<path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13"/>'),
  search: svg('<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.3 3.3"/>'),
  check: svg('<path d="m3.5 8.5 3 3 6-7"/>'),
  key: svg('<circle cx="5.5" cy="10.5" r="2.7"/><path d="M7.4 8.6 13 3M11.2 4.8l1.6 1.6M9.6 6.4l1.2 1.2"/>'),
  chart: svg('<path d="M3 13.5V9M8 13.5v-11M13 13.5V6"/>'),
  copy: svg(
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 5.5V3.2a.7.7 0 0 0-.7-.7H3.2a.7.7 0 0 0-.7.7v6.6c0 .4.3.7.7.7h2.3"/>',
  ),
  /** The copy icon with a plus in the front sheet: a new copy. */
  duplicate: svg(
    '<rect x="5.5" y="5.5" width="8" height="8" rx="1.2"/><path d="M10.5 5.5V3.2a.7.7 0 0 0-.7-.7H3.2a.7.7 0 0 0-.7.7v6.6c0 .4.3.7.7.7h2.3M9.5 7.6v3.8M7.6 9.5h3.8"/>',
  ),
  warning: svg('<path d="M8 2.5 14 13H2zM8 6.5v3M8 11.3v.2"/>'),
  refresh: svg('<path d="M13 8a5 5 0 1 1-1.46-3.54M13 2.5v3h-3"/>'),
};
