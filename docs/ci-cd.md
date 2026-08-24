# CI/CD and Chrome Web Store releases

GitHub Actions verifies pull requests and `main`, deploys the public project site to GitHub Pages, and creates validated GitHub release archives. Chrome Web Store uploads and review submissions are intentionally manual, so the repository needs no Google Cloud project, service account, dedicated Chrome Web Store deployment environment, or publishing credentials.

## Workflows

`.github/workflows/ci.yml` runs on pull requests to `main` and pushes to `main`. It restores the pnpm cache, installs from the lockfile, scans tracked files and all unaudited commits for sensitive data, lints, typechecks, runs Vitest and headless Chromium E2E tests, builds and loads the real MV3 extension, and validates both manifests.

`.github/workflows/ci.yml` is the required GitHub CI workflow. It runs the full extension verification described above. CodeQL and OSV scanning run through their dedicated GitHub workflows. Keep the GitHub mirror synchronized with `main`, otherwise neither the Pages deployment nor the release workflow can run from the current source.

`.github/workflows/pages.yml` deploys `docs/site/` after the GitHub `CI` workflow succeeds for a push from this repository to `main`, and can also be run manually from `main`. In **Settings > Pages**, choose **GitHub Actions** as the publishing source and configure the verified custom domain `vauld.de`. The workflow uploads the static site as a Pages artifact and deploys it through the `github-pages` environment. Restrict that environment to `main`. Use `https://vauld.de/privacy-policy.html` in the Chrome Web Store Developer Dashboard Privacy tab and verify it in a signed-out browser session before submission.

`.gitlab-ci.yml` remains available for GitLab-side verification and security scans, but it no longer deploys Pages.

The public repository starts from a history-less publication snapshot, so CI scans the complete history of the public repository. Any committed email address, IBAN, credential, or captured account value fails the build. Never add a history baseline to silence a finding: inspect the commit, remove the sensitive data, and rotate any exposed credential first.

`.github/workflows/release.yml` runs for an existing `vMAJOR.MINOR.PATCH` tag. A manual run accepts the same existing tag as input; it never creates or rewrites tags. The workflow verifies that the tag is reachable from `main`, checks that both committed version files match it, packages `dist/`, uploads the immutable ZIP as an Actions artifact, and creates the matching GitHub Release. Download that ZIP and upload it manually in the Chrome Web Store Developer Dashboard.

## Public GitHub setup

Before changing repository visibility, review existing Actions logs and artifacts for information that should not become public. Then make the repository public and configure:

- **Code scanning:** use Advanced Setup with the committed `.github/workflows/codeql.yml`; do not enable a second default CodeQL configuration.
- **Dependabot alerts:** enable alerts under **Settings > Advanced Security**.
- **Pages:** select **GitHub Actions**, set `vauld.de` as the custom domain, and enforce HTTPS once the certificate is ready.
- **DNS:** point the apex domain to GitHub Pages with `A` records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, and `185.199.111.153`; point `www.vauld.de` by `CNAME` to `newsfusion.github.io`.
- **Branch rules:** require pull requests, one approval, dismissal of stale approvals, resolved conversations, and successful CI, CodeQL, and OSV checks for `main`; block deletion, force pushes, and bypasses.
- **Tag rules:** block updates and deletion for `v*` release tags.

## Initial Chrome Web Store setup

1. Enroll the publishing Google account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), create the extension listing, and complete its listing, privacy, distribution, and payment requirements. Record the 32-character extension ID.
2. Upload the first validated release ZIP manually, complete the store review, and publish the listing with the intended visibility.

Protect `main` by requiring pull-request review and the CI, CodeQL, and OSV checks named above. Protect `v*` tags against deletion and modification.

## Preparing and publishing a release

Choose the version using semantic versioning:

- Patch for compatible fixes.
- Minor for backward-compatible features.
- Major for intentionally breaking behavior.

Chrome release versions use exactly three numeric components with no prerelease suffix. Prepare the version and local archive:

```bash
pnpm release:webstore -- 1.2.0
```

Review and commit the resulting `package.json` and `manifest.json` changes. The generated `releases/` archive is ignored and must not be committed. After CI passes on `main`, create and push the matching tag:

```bash
git tag -a v1.2.0 -m "Release 1.2.0"
git push origin v1.2.0
```

Wait for the release workflow to create the GitHub Release, download its `p2p-extension-webstore-v<version>.zip` asset, and upload that exact archive in the Chrome Web Store Developer Dashboard. Review the listing, privacy, distribution, and rollout settings there, then submit the version manually for review.

If Google rejects a submission, fix the source and release a higher version. Chrome Web Store versions must never be reused. Do not rebuild or edit a published GitHub release archive manually; prepare a new version and tag instead.

## Troubleshooting

- **Tag rejected:** confirm it is an exact `vMAJOR.MINOR.PATCH` tag reachable from `origin/main` and both version files match it.
- **Upload rejected:** Chrome requires a version higher than every previously uploaded version. Check the Developer Dashboard for an existing draft or policy warning.
- **Visibility error:** publish the changed visibility manually once in the Developer Dashboard.
