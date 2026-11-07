/** The sidebar's state: what the extension last sent, the UI's own choices, and what's in progress. */
import { Menus } from './menu';
import { PendingRenames } from './renames';
import { restoreUi, type UiState } from './view';
import type { SessionView, SidebarState, ToHost } from '../shared/protocol';

export interface VsCodeApi {
  getState(): unknown;
  setState(state: unknown): void;
  postMessage(message: unknown): void;
}

export class Sidebar {
  /** The state on screen. */
  state: SidebarState | null = null;
  /** A state that arrived while the user was renaming or in a menu; flush() shows it. */
  pending: SidebarState | null = null;
  /** The session being renamed in place. */
  renaming: { id: string } | null = null;
  /** Renames the extension hasn't confirmed yet: every state shown gets them laid over it. */
  readonly renames = new PendingRenames();
  /** A mouse button is down in the sidebar: rendering now would replace what it's clicking. */
  pressing = false;
  /** Collapsed sections, filter, search, selection, hidden limits: kept across reloads of the view. */
  readonly ui: UiState;
  readonly menus: Menus;

  /** @param onMenuClosed called after a menu closes, so a state that arrived meanwhile can be shown */
  constructor(
    private readonly vscode: VsCodeApi,
    readonly app: HTMLElement,
    onMenuClosed: () => void,
  ) {
    this.ui = restoreUi(vscode.getState());
    this.menus = new Menus(app, onMenuClosed);
  }

  /** A rename or a menu is open, or a click is under way: rendering now would undo it. */
  get busy(): boolean {
    return this.renaming !== null || this.menus.isOpen || this.pressing;
  }

  save(): void {
    this.vscode.setState(this.ui);
  }

  post(message: ToHost): void {
    this.vscode.postMessage(message);
  }

  session(id: string): SessionView | undefined {
    return this.state?.sessions.find((s) => s.id === id);
  }
}
