# Security

## Reporting a vulnerability

Please report vulnerabilities privately, through GitHub's **[Report a vulnerability](https://github.com/ryankkhalil19/many-hats/security/advisories/new)** form, not in a public issue.

Include:

- what you found and its impact;
- steps to reproduce;
- the Many Hats, editor and macOS versions ("Many Hats: Collect Diagnostics" gives you these without personal data).

You'll get a reply within 7 days. A fix ships as a patch release, and the advisory is published once users have had time to update.

## Supported versions

Only the latest release gets security fixes.

## What Many Hats guarantees

These are part of the design; a break in any of them is a vulnerability:

- **Tokens:** Many Hats never reads, copies, logs or sends a Claude login token. Sign-in and sign-out go through Claude Code's own `claude auth login` and `claude auth logout`.
- **No network or telemetry:** Many Hats makes no network requests and collects nothing. The only links it opens are claude.ai's usage page and this repository's issue form, both when you click them.
- **Private data:** everything Many Hats stores is in `~/.many-hats`, created with mode 700, its files 600. Records are written atomically.
- **Inherited logins:** the launcher removes an inherited login token (`CLAUDE_CODE_OAUTH_TOKEN` and its companions) from the processes it starts. A tab can't run on a login other than its account's.
- **The launcher can't be steered:** every value it reads (session ids, account names) is checked before it's used in a path.
- **The webview:**
  - its content security policy allows only Many Hats' own script, by nonce, and no inline code;
  - every message it sends is checked field by field before the extension acts on it.
- **Diagnostics:** reports have emails, tokens, the home folder path and account names removed.
