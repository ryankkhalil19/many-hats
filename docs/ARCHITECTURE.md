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
| `VERSION`                         | The data layout's version. A newer one is never touched.                                                                                     | `ensureLayout`                      |

### Invariants

1. **One record per key, replaced atomically.** Every write goes temp file → `fsync` → `rename`. Readers see the old or the new record, never half of one. Several windows and every Claude start read these at once, and there's nothing to lock.
2. **A session's account is sticky.** It's set the first time the session is seen running on one of the accounts, and afterwards only Move or "Open on account" change it. Seeing it run elsewhere never flips it.
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

## Releases

See [RELEASING.md](RELEASING.md).
