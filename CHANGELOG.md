# Changelog

All notable changes to Many Hats. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). An odd minor version (0.9, 1.1) is a pre-release.

## [Unreleased]

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

[Unreleased]: https://github.com/ryankkhalil19/many-hats/compare/v0.9.1...HEAD
[0.9.1]: https://github.com/ryankkhalil19/many-hats/releases/tag/v0.9.1
[0.9.0]: https://github.com/ryankkhalil19/many-hats/releases/tag/v0.9.0
