/**
 * Renames made in the sidebar that the extension hasn't confirmed yet. A state the extension built
 * before it handled a rename would put the old title back for a moment; this lays the new title
 * over such states until one has it, or for 10 seconds if the rename never comes through.
 * No DOM here, so it's tested under Node.
 */
import type { SidebarState } from '../shared/protocol';

export class PendingRenames {
  private readonly titles = new Map<string, { title: string; until: number }>();

  constructor(private readonly ttlMs = 10_000) {}

  add(id: string, title: string, now = Date.now()): void {
    this.titles.set(id, { title, until: now + this.ttlMs });
  }

  /** The state, with the renames it hasn't caught up with yet laid over it. */
  apply(state: SidebarState, now = Date.now()): SidebarState {
    for (const [id, r] of this.titles) {
      const s = state.sessions.find((x) => x.id === id);
      if (!s || s.title === r.title || now > r.until) this.titles.delete(id);
      else s.title = r.title;
    }
    return state;
  }
}
