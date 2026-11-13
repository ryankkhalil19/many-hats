# Changelog

All notable changes to Many Hats. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). An odd minor version (0.9, 1.1) is a pre-release.

## [Unreleased]

## [1.0.1] - 2026-11-12

### Fixed

- **A false "Claude Code changed something Many Hats reads" warning** that paused starting tabs on their accounts. Many Hats' own usage refresh runs Claude Code from the editor, like a tab, and with no tab open the check took those runs for tabs that had skipped the launcher. Background runs are now marked as Many Hats' own and left out, so they never trip the check, show as a running tab, or get taken for a new tab.

## [1.0.0] - 2026-11-12

### Changed

- **Many Hats is out of preview.** 1.0.0 is a full release in both the VS Code Marketplace and Open VSX, no longer a pre-release or marked "Preview". Nothing else changed since 0.9.2.

## [0.9.2] - 2026-11-08

### Added

- **Copy to account:** a session's menu copies its conversation to any account, as a new session there that you name, then opens it. Claude Code makes the copy with its own fork, run on that account: the copy gets a new ID, that account as its owner, and none of the original's Remote Control link. It holds the conversation as Claude Code would continue it: after a compaction, from its summary on. No prompt is sent, and the original stays as it is, even while it's open. Also in the Command Palette: "Copy Claude Code Tab to Account…".
- **Minimize an account's card** to its name and one line of usage (each window's short name and percentage, in its level's colour), and maximize it again. Each card on its own, remembered per window.

### Changed

- Background runs of Claude Code (the usage refresh, and copies) no longer start your MCP servers.
- Background runs of Claude Code finish about 3 seconds sooner: their input is closed at once instead of waited on.

### Removed

- **Open on account** in a session's menu. Move it there, then open it: that's what it did.

### Fixed

- **Refreshing usage often ended in "Couldn't refresh"** after a long wait. Claude Code's `/usage` now also works out what's contributing to your usage, by reading every session saved on the machine, which can take over a minute, past Many Hats' limit. Many Hats now stops Claude Code once the figures are saved (about 4 seconds in), so a refresh takes seconds and no longer scans your history. The log now says how a failed refresh ended.

## [0.9.1] - 2026-11-07

### Fixed

- The Intel Mac build is on the VS Code Marketplace. 0.9.0's was accepted but never listed: it arrived a second after the Apple silicon build, while the Marketplace was still creating the extension.
- Releases now confirm that every package can be downloaded from each store before they finish. A package that's missing is published once more, and the release fails, naming it, if it never appears.

## [0.9.0] - 2026-11-07

First public pre-release.

### Added

- **Accounts:** run each Claude Code tab on its own Claude account, side by side in one window, with shared conversations, settings, `CLAUDE.md`, skills, plugins and memory.
- **Sidebar:**
  - every account with its plan and usage windows (5-hour, weekly, per model) and when each resets, kept current: while the sidebar shows, Claude Code's own `/usage` refreshes each account every 15 minutes (hooks off, nothing saved), and ↻ refreshes now;
  - this folder's sessions grouped by account, with search, filters, open, rename, archive, delete, Open on account and Move to account;
  - a per-model limit can be hidden on one account.
- **Sessions remember their account.** A resumed session starts on its account, from any window, tab restore or history entry.
- **New session on any account** without changing the account for new tabs, through a one-shot record that exactly one tab claims.
- **Status bar:** the account for new tabs in this window, the open tabs by account, and anything that needs attention.
- **Self-checks and repairs** for the launcher, Claude Code's process-wrapper setting and the data folder's permissions ("Check and Repair Setup").
- **Format checks** on every Claude Code file Many Hats reads. An unknown format pauses that feature with a notice instead of guessing.
- **Collect Diagnostics:** a redacted report for bug reports.
- **A clean uninstall:** the uninstall hook removes the process-wrapper setting from that editor (every profile, comments kept). "Remove All Accounts and Data…" removes the rest.
- **Security:**
  - Many Hats never reads a login token, and it makes no network calls itself and collects no telemetry;
  - a token inherited from the Claude desktop app can't override the account;
  - the webview has a strict content security policy and every message it sends is checked.

[Unreleased]: https://github.com/ryankkhalil19/many-hats/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/ryankkhalil19/many-hats/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/ryankkhalil19/many-hats/compare/v0.9.2...v1.0.0
[0.9.2]: https://github.com/ryankkhalil19/many-hats/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/ryankkhalil19/many-hats/releases/tag/v0.9.1
[0.9.0]: https://github.com/ryankkhalil19/many-hats/releases/tag/v0.9.0
