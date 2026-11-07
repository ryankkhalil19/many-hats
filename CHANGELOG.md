# Changelog

All notable changes to Many Hats. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). An odd minor version (0.9, 1.1) is a pre-release.

## [Unreleased]

## [0.9.0] - 2026-11-06

First public pre-release.

### Added

- **Accounts:** run each Claude Code tab on its own Claude account, side by side in one window, with shared conversations, settings, `CLAUDE.md`, skills, plugins and memory.
- **Sidebar:**
  - every account with its plan and usage windows (5-hour, weekly, per model) and when each resets;
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
  - Many Hats never reads a login token, and it makes no network calls and collects no telemetry;
  - a token inherited from the Claude desktop app can't override the account;
  - the webview has a strict content security policy and every message it sends is checked.

[Unreleased]: https://github.com/ryankkhalil19/many-hats/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/ryankkhalil19/many-hats/releases/tag/v0.9.0
