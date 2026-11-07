# Contributing to Many Hats

Thanks for helping. Bug reports, fixes, a Linux port and translations are all welcome.

## Set up

You need macOS, Node 24 (`.nvmrc`) and VS Code or another editor based on it.

```bash
nvm use
npm ci
npm run build
```

Open the folder in your editor and press **F5** ("Run Many Hats"). A second editor window opens with your working copy of the extension. That window uses your real `~/.many-hats` and Claude Code settings.

## Checks

`npm run check` runs the fast checks:

- `npm run typecheck`: strict TypeScript, for the extension, the webview and the tests;
- `npm run lint`: ESLint, including the rules that keep the layers apart;
- `npm run format:check`: Prettier;
- `npm run links`: every relative link and `#anchor` in the Markdown files (`npm run links -- --external` also checks links to other sites);
- `npm run test:coverage`: unit, contract, launcher and fault-injection tests, with coverage thresholds.

CI also runs:

- `npm run shellcheck`: the launcher (`brew install shellcheck`);
- `npm run package`: one `.vsix` per Mac target, checked against a file allowlist and a size budget;
- `npm run test:webview`: the sidebar in headless Chrome, with real clicks and keys, against `tools/preview` (needs Google Chrome);
- `npm run test:integration`: Many Hats alone in VS Code 1.96, the oldest version it supports, with Claude Code turned off.

Before a release, also run:

- `npm run test:e2e`: Many Hats with the real Claude Code extension in the latest VS Code. It opens real Claude Code tabs, signed out, and checks which account each one started on;
- `npm run canary`: checks the latest Claude Code for everything Many Hats relies on. CI also runs it every night.

The editor tests use a throwaway home folder and editor profile, so they never touch your accounts or settings.

## How the code is organised

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains the layers, the data model and the invariants. In short:

```
ui → services → state, claude, platform, infra → core
```

- Only `src/ui` and `src/extension.ts` use the editor API.
- `src/claude` is the only code that knows Claude Code's private files.
- `src/platform` is the only OS-specific code.

Lint enforces this.

## Changes

- Add tests with every change. A bug fix starts with a test that fails without it.
- Anything that reads a new Claude Code file goes in `src/claude`:
  - it checks the shape of what it reads and reports to `Compat`;
  - it gets a fixture in `test/fixtures/claude-code-<version>/`.
- The launcher must never stop Claude from starting. Add a case to `test/launcher/faults.test.ts` for any new way it can fail.
- User-facing text is plain and direct. Say "Claude Code" only for the product Many Hats works with.
- Never add code that reads, logs or sends a login token.
- Add a line under "Unreleased" in [CHANGELOG.md](CHANGELOG.md).

## Pull requests

Keep each PR to one change, with a description of what it fixes and how you tested it. CI must pass.

## Brand and screenshots

- `npm run brand` rebuilds the icons and images from `brand/shapes.mjs` (needs `rsvg-convert`).
- `npm run screenshots` retakes the README screenshots from `tools/preview` (needs Google Chrome).

See [brand/README.md](brand/README.md).

## Code of conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
