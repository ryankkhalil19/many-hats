# Releasing Many Hats

Releases are built once by CI and published from that build to three places:

- GitHub Releases;
- the VS Code Marketplace (VS Code);
- Open VSX (Cursor, Windsurf, VSCodium and other editors).

Publishing uses Trusted Publishing from GitHub Actions, so no store token is stored anywhere. A release publishes as soon as its version tag is pushed: the `release` environment deploys only from `v*` tags, and needs no approval (removed 2026-11-08). To bring the approval step back, add yourself as a required reviewer of the `release` environment (Settings → Environments → release).

## Versions

- [Semantic Versioning](https://semver.org/).
- An **odd minor** (0.9.x, 1.1.x) is a **pre-release**: both stores show it only to people who opt in.
- An **even minor** (1.0.x, 1.2.x) is a release.
- A store never takes the same version twice, so every published build needs a new number.

## One-time store setup

### VS Code Marketplace

1. Sign in at <https://marketplace.visualstudio.com/manage> with a Microsoft account. Create the publisher **ryankkhalil19**.
2. In the publisher's settings, open **Trusted Publishing** and add a GitHub Actions policy:
   - repository `ryankkhalil19/many-hats`
   - workflow `release.yml`
   - environment `release`
3. In the GitHub repository, set the variable `PUBLISH_VSCODE` to `true` (Settings → Secrets and variables → Actions → Variables).

### Open VSX

1. Sign in at <https://open-vsx.org> with GitHub, and link an Eclipse Foundation account when it asks.
2. Sign the **Publisher Agreement** (Settings → Profile).
3. Create the namespace **ryankkhalil19**:
   - Settings → Namespaces;
   - or `npx ovsx create-namespace ryankkhalil19 -p <token>` with a one-off token, deleted afterwards.
4. Under Settings → Trusted Publishers, add `ryankkhalil19/many-hats`, workflow `release.yml`, environment `release`.
5. Optional: claim the namespace to get the verified badge. The [Open VSX wiki](https://github.com/eclipse-openvsx/openvsx/wiki) explains how.
6. Set the repository variable `PUBLISH_OPENVSX` to `true`.

Until a store's variable is `true`, releases go to GitHub Releases only.

## Cutting a release

1. **Update `CHANGELOG.md`.** Move "Unreleased" under the new version and date.
2. **Set the version** in `package.json`. `"preview"` is `false` from 1.0.0 on (it was `true` through 0.9.x).
3. **Check:** `npm run check`, `npm run test:webview`, `npm run test:integration`, then `npm run test:e2e` locally.
4. **Commit and tag:**
   ```bash
   git commit -am "Release 1.0.1"
   git tag v1.0.1
   git push origin main v1.0.1
   ```
5. **Watch it publish.** The **Release** workflow builds and tests, packages one `.vsix` per Mac target, and records checksums and build provenance. Its `release` environment then:
   - creates the GitHub Release with the packages;
   - publishes them to each store, one package at a time (`scripts/publish-store.mjs`). A store's step passes only once that store serves every package. A package still missing halfway through the 15-minute wait is published once more.
6. **Check the listings.** Install from each store in a fresh editor profile.

## If a store step fails

The step names the package that never appeared. Re-run the publish job from the Actions tab: packages already in a store are skipped, and the GitHub Release is updated in place. If it fails again, upload that package in the store's own page (the Marketplace's publisher page, or Open VSX's Publish page).

## If a release is bad

The stores don't let a version be replaced.

1. Revert the change on `main`.
2. Release it as the next patch version.
3. Meanwhile, the previous good `.vsix` is on its GitHub Release, for anyone who needs it now.

To remove a version from a store, unpublish it there. That doesn't free its version number.

## The nightly canary

The **Canary** workflow runs `npm run canary` every night against the latest Claude Code. When something Many Hats relies on changes, it opens an issue labelled `canary`, or comments on the open one. Fix, release a patch, and close the issue.
