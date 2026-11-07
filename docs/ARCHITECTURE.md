# Many Hats architecture

How Many Hats works, what it promises, and where each piece of code lives.

## The idea in one paragraph

Claude Code keeps one login per config folder (`CLAUDE_CONFIG_DIR`), and the VS Code extension starts one `claude` process per tab, with the extension host's environment at that moment. Many Hats:

1. gives each extra account its own config folder, with everything shareable linked from `~/.claude`;
2. chooses the folder for each tab's process through the environment, and through a small launcher that Claude Code runs every process through;
3. records which account each session belongs to, so a session reopens on its account from anywhere.

## Layers

```
extension.ts      composition root: builds everything, wires it to the editor
ui/               VS Code surfaces: commands, status bar, quick picks, the sidebar provider
services/         use cases: accounts, sessions, routing (pick), scanner, config linking,
                  launcher install, health checks, diagnostics, housekeeping
state/            Many Hats' own records in ~/.many-hats
claude/           the only code that knows Claude Code's private files and CLI
platform/         the only OS-specific code (macOS: ps, Keychain)
infra/            atomic files, safe reads, exec with timeouts, logging with redaction
core/             names, ids and errors; no I/O
shared/           the webview message contract (types and a validator)
webview/          the sidebar UI, in the webview (no Node, no editor API)
launcher/         launcher.sh, Claude Code's process wrapper
uninstall/        the uninstall hook (plain Node)
```

**Dependencies point down only.** ESLint enforces it (`eslint.config.mjs`), so for example `services/` can't import `vscode`, and `core/` can't touch the file system.

## Data: `~/.many-hats`

| Path                              | What                                                                                                                                         | Written by                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `accounts/<name>/`                | An extra account's `CLAUDE_CONFIG_DIR`. Shared entries of `~/.claude` are symlinked in; `.claude.json` (identity) and caches stay per login. | `AccountStore`, `ConfigSync`        |
| `accounts/<name>/.many-hats.json` | The email the account should sign in as.                                                                                                     | `AccountStore`                      |
| `assignments/<session id>`        | `<account> <source> <ISO time>`: the account a session belongs to.                                                                           | `Assignments`; read by the launcher |
| `picks/<sha256(key)>.json`        | The account new tabs start on, per window.                                                                                                   | `Picks`                             |
| `next/<extension host pid>`       | A one-shot account for the next tab a window opens.                                                                                          | `NextTab`; claimed by the launcher  |
| `archive/<session id>`            | The sidebar's archive.                                                                                                                       | `Archive`                           |
| `bin/launcher`                    | The process wrapper.                                                                                                                         | `installLauncher`                   |
| `logs/launcher.log`               | One line per Claude start: session, account, why. Rotated at 256 KiB.                                                                        | the launcher                        |
| `backups/`                        | File versions a sync set aside.                                                                                                              | `ConfigSync`                        |
| `locks/usage-<name>`              | A window refreshing an account's usage, so no two windows do it at once.                                                                     | `UsageRefresher`                    |
| `VERSION`                         | The data layout's version. A newer one is never touched.                                                                                     | `ensureLayout`                      |

### Invariants

1. **One record per key, replaced atomically.** Every write goes temp file → `fsync` → `rename`. Readers see the old or the new record, never half of one. Several windows and every Claude start read these at once, and there's nothing to lock.
2. **A session's account is sticky.** It's set the first time the session is seen running on one of the accounts once it has been saved (Claude Code saves a session with its first message, so a tab that's never used is never recorded). Afterwards only Move or "Open on account" change it. Seeing it run elsewhere never flips it.
3. **Nothing reads a token.** Logins stay in each config folder's Keychain entry, owned by Claude Code. Sign-in and sign-out run `claude auth login`/`logout`.
4. **Untrusted input is checked at the edge.** Session ids must be UUIDs and account names match `^[a-z0-9][a-z0-9_-]{0,31}$` before they're used in a path. This applies to:
   - webview messages (`shared/protocol.ts`);
   - records on disk;
   - launcher arguments.
5. **Claude Code's files are read, never trusted.** Readers in `claude/` check every record's shape and report to `Compat`. When a feature keeps finding records it can't read, it's paused and nothing acts on it (below).

## The launcher contract

Claude Code runs `launcher <claude binary> [args…]`. The launcher:

1. **Without `~/.many-hats`** execs Claude unchanged. Many Hats removed means no effect at all.
2. **Resumed sessions** (`--resume <id>`, `-r <id>`, `--session-id <id>`) start on the account in `assignments/<id>`.
3. **A new tab** (not a resume) can claim `next/$PPID`. Its parent is the window's extension host. The claim is a `mv`, so exactly one process wins it.
4. **Anything else** keeps its environment: the window's pick, set in the extension host as `CLAUDE_CONFIG_DIR`.
5. **Inherited login tokens are removed:** `CLAUDE_CODE_OAUTH_TOKEN` and its companions.
6. **It sets `MANY_HATS_LAUNCHER=1`, logs one line, then `exec`s.** The pid, stdio, signals and exit code stay Claude's own.

Every failure path falls through to step 4: an unreadable record, a missing folder, an unwritable log. `test/launcher/faults.test.ts` holds it to that.

## What Many Hats relies on in Claude Code

| Contract                                                  | Used for                                    | Checked by                              |
| --------------------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| `claudeCode.claudeProcessWrapper` setting                 | Starting every process through the launcher | nightly canary; health check            |
| `claude-vscode.editor.open` command                       | Opening tabs                                | nightly canary                          |
| `--resume <id>` when reopening a session                  | Routing resumed sessions                    | nightly canary                          |
| `<config>/sessions/<pid>.json` with `sessionId`           | Which session a process is                  | `Compat('liveSessions')`                |
| `.claude.json` `oauthAccount.emailAddress`                | Who an account is                           | `Compat('identity')`                    |
| `.claude.json` `cachedUsageUtilization`                   | Usage windows                               | `Compat('usage')`                       |
| `claude -p /usage` runs without a prompt and saves usage  | Refreshing an account's usage               | nightly canary                          |
| `--settings '{"disableAllHooks":true}'` turns hooks off   | A refresh never runs the user's hooks       | nightly canary                          |
| Transcript lines `{"type": …}`                            | Session titles                              | `Compat('transcripts')`                 |
| Tabs carry `MANY_HATS_LAUNCHER=1` once the wrapper is set | The wrapper is still honoured               | `Compat('processWrapper')`              |
| One Keychain entry per config folder                      | Separate logins                             | design; unchanged since Claude Code 1.x |

`scripts/canary.mjs` runs nightly in CI against the latest Claude Code and opens an issue when a contract changes.

## Format checks (`Compat`)

Each reader reports how many records it understood (`ok`) and how many it found but couldn't read (`bad`).

- **Pause:** three passes in a row with `bad > 0` and `ok = 0` mark the feature degraded.
- **While degraded:**
  - the sidebar and status bar show a notice;
  - the scanner stops adopting assignments from data it can't read;
  - diagnostics list the issue.
- **Recover:** one good pass clears it.

## Processes and scanning

`Scanner` lists the claude children of this window's extension host (`ps`) and reads each one's environment once (`ps -E`).

- **Matching:** it pairs each process with its live-session record and adopts first-seen sessions.
- **When it scans:** it rescans when Claude Code's session records change (`fs.watch`), and on a timer: 2 s while the sidebar is visible, 6 s otherwise.

## Usage

Claude Code saves an account's usage (`cachedUsageUtilization` in its `.claude.json`) only when something asks for it: its own usage view, or a check near a limit. Ordinary use doesn't, so figures can be hours old. Claude Code itself stops trusting them after an hour.

`services/usageRefresh.ts` asks the way a person would, by running Claude Code's own `/usage` for the account. It runs `claude -p /usage` with that account's `CLAUDE_CONFIG_DIR`:

- **No inherited login:** any login variable inherited from elsewhere is removed.
- **Nothing extra:** no session is saved (`--no-session-persistence`), the user's hooks stay off (`disableAllHooks`), and there's no self-update and no telemetry.
- **One working folder:** it always runs from `~/.many-hats`.

Claude Code fetches the figures with that account's own login and saves them, and the sidebar reads them as before. Many Hats itself never touches a login or the network.

- **When:** every 5 s while the sidebar shows, `tick()` refreshes the first signed-in account whose figures are over 15 minutes old, one at a time. The ↻ on a card and **Refresh Sessions and Usage** refresh right away.
- **Across windows:** a lock file per account (`locks/usage-<name>`, created only if absent) means one window refreshes it and every window reads the result. A lock older than 3 minutes was left by a window that went away.
- **Failures:** the card says "Couldn't refresh", with the reason on hover, and automatic refreshes of that account wait 15 minutes. The log has the details.

## The sidebar

The extension (`ui/sidebar/`) sends the webview one `SidebarState` at a time and checks every message it gets back (`shared/protocol.ts`). The webview never sees a path, a token or a process. Its CSP allows only its own script (by nonce) and its own stylesheet, and no inline styles, so bar widths and colours are set from script.

```
webview/main.ts        entry: wires the parts below, then says it's ready
        sidebar.ts     the state: what the extension sent, the UI's own choices, what's in progress
        view.ts        the markup, as pure functions of the state
        render.ts      puts the markup on screen and keeps scroll and focus
        selection.ts   the selected row, and roving focus (the list is one tab stop)
        actions.ts     open, rename in place, and the menus
        menuItems.ts   what each menu offers, as pure functions
        menu.ts        the pop-up menu widget
        renames.ts     renames the extension hasn't confirmed yet
        events.ts      clicks, right-clicks and search;  keyboard.ts  the keys
```

Each state replaces the sidebar's markup, so a state never lands in the middle of something:

- **While the user is busy, a new state waits.** That covers renaming, an open menu, and a mouse button that's down: replacing the button being clicked would drop the click. The waiting state is shown when they finish.
- **A rename shows at once,** and stays over any state the extension built before it handled the rename, until a state has the new title (or 10 seconds pass).

**Tests:** the pure parts (`view.ts`, `menuItems.ts`, `renames.ts`, `format.ts`) have unit tests. `test/webview/` drives the whole sidebar in headless Chrome against `tools/preview`, whose stand-in extension answers like the real one. Both of the races above have a test that reproduces them on demand.

## Releases

See [RELEASING.md](RELEASING.md).
