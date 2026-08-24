# CI/CD and Chrome Web Store releases

GitHub Actions is the CI/CD and deployment path. It verifies pull requests and `main`, deploys the public privacy site to GitHub Pages, and publishes approved Chrome Web Store releases. Releases authenticate to Google Cloud with GitHub OIDC and Workload Identity Federation (WIF), so there are no long-lived Google client secrets or refresh tokens in GitHub.

## Workflows

`.github/workflows/ci.yml` runs on pull requests to `main` and pushes to `main`. It restores the pnpm cache, installs from the lockfile, scans tracked files and all unaudited commits for sensitive data, lints, typechecks, runs Vitest and headless Chromium E2E tests, builds and loads the real MV3 extension, and validates both manifests.

`.github/workflows/ci.yml` is the required GitHub CI workflow. It runs the full extension verification described above. CodeQL and OSV scanning run through their dedicated GitHub workflows. Keep the GitHub mirror synchronized with `main`, otherwise neither the Pages deployment nor the release workflow can run from the current source.

`.github/workflows/pages.yml` deploys `docs/site/` after the GitHub `CI` workflow succeeds for a push from this repository to `main`, and can also be run manually from `main`. Once in GitHub, open **Settings > Pages** and choose **GitHub Actions** as the publishing source. The workflow uploads the static site as a Pages artifact and deploys it through the `github-pages` environment. Restrict that environment to `main` and add the required reviewers before permitting manual deployments. Use the public `https://<OWNER>.github.io/<REPOSITORY>/privacy-policy.html` URL (or the configured custom-domain equivalent) in the Chrome Web Store Developer Dashboard Privacy tab and verify it in a signed-out browser session before submission.

`.gitlab-ci.yml` remains available for GitLab-side verification and security scans, but it no longer deploys Pages.

The public repository starts from a history-less publication snapshot, so CI scans the complete history of the public repository. Any committed email address, IBAN, credential, or captured account value fails the build. Never add a history baseline to silence a finding: inspect the commit, remove the sensitive data, and rotate any exposed credential first.

`.github/workflows/release.yml` runs for an existing `vMAJOR.MINOR.PATCH` tag. A manual run accepts the same existing tag as input; it never creates or rewrites tags. The workflow verifies that the tag is reachable from `main`, checks that both committed version files match it, packages `dist/`, waits for approval through the `chrome-web-store` environment, uploads through Chrome Web Store API v2, and submits with `DEFAULT_PUBLISH`. The update publishes automatically after Google approves it.

## Initial Chrome Web Store setup

1. Enroll the publishing Google account in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), create the extension listing, and complete its listing, privacy, distribution, and payment requirements. Record the 32-character extension ID.
2. In **Publisher > Settings**, record the publisher ID. If the listing or its visibility has never been published, complete that first publication manually. API uploads update an existing item, and a visibility change must be published manually once before API publishing can resume.
3. Create or select a dedicated Google Cloud project and enable **Chrome Web Store API**.

## GitHub OIDC and WIF

Install and authenticate the Google Cloud CLI, replace the uppercase placeholders, and create a dedicated Workload Identity Pool and GitHub provider:

```bash
PROJECT_ID="your-google-cloud-project"
POOL_ID="github"
PROVIDER_ID="github"
SERVICE_ACCOUNT_NAME="p2p-webstore-publisher"
GITHUB_REPOSITORY="OWNER/REPOSITORY"

gcloud config set project "$PROJECT_ID"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
SERVICE_ACCOUNT_EMAIL="$SERVICE_ACCOUNT_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud services enable chromewebstore.googleapis.com

gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
  --display-name="P2P Vauld Chrome Web Store publisher"

gcloud iam workload-identity-pools create "$POOL_ID" \
  --location="global" \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub Actions" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.sub == 'repo:$GITHUB_REPOSITORY:environment:chrome-web-store'"

gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principal://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/subject/repo:$GITHUB_REPOSITORY:environment:chrome-web-store"
```

In the Chrome Web Store Developer Dashboard **Account** section, add `SERVICE_ACCOUNT_EMAIL` to the publisher. Chrome currently permits one linked service account per publisher.

The IAM binding grants `roles/iam.workloadIdentityUser` only to runs from the repository's protected `chrome-web-store` environment. Do not grant project-wide access or create a service-account key. The workflow requests a short-lived OAuth token scoped only to `https://www.googleapis.com/auth/chromewebstore`. If authentication is denied, verify the exact `assertion.sub`, principal URI, repository spelling, and environment name against the current [Google deployment-pipeline guidance](https://cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines) and [`google-github-actions/auth` WIF instructions](https://github.com/google-github-actions/auth#workload-identity-federation-through-a-service-account).

Create a GitHub Environment named `chrome-web-store` and configure:

- Required reviewers before deployment.
- Deployment branches/tags restricted to protected release tags.
- These environment variables:

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | Dedicated Google Cloud project ID |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Full provider resource name, such as `projects/123456789/locations/global/workloadIdentityPools/github/providers/github` |
| `GCP_SERVICE_ACCOUNT` | Linked service-account email |
| `CHROME_PUBLISHER_ID` | Publisher ID from the Developer Dashboard |
| `CHROME_EXTENSION_ID` | 32-character extension ID |

These identifiers are not credentials and are stored as GitHub variables. The workflow needs no repository secrets. `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, and `CHROME_REFRESH_TOKEN` belong to the older long-lived user OAuth flow and are intentionally unused.

Protect `main` by requiring the `Verify extension` CI check and pull-request review. Protect `v*` tags so only release maintainers can create them.

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

Approve the `chrome-web-store` deployment when GitHub presents the environment gate. The workflow ends after the submission is accepted for review; store review is asynchronous. With `DEFAULT_PUBLISH`, approval automatically makes the update available using the listing's existing visibility and rollout settings.

If Google rejects a submission, fix the source and release a higher version. Chrome Web Store versions must never be reused. A rerun safely recognizes the same version when it is already pending, staged, or published. For asynchronous uploads, API v2 exposes the processing state but not the draft version. The workflow therefore establishes the version before upload by validating the manifest and immutable ZIP, waits for `SUCCEEDED`, and then submits that exact archive. Do not upload a competing draft manually while a release deployment is running.

## Troubleshooting

- **Tag rejected:** confirm it is an exact `vMAJOR.MINOR.PATCH` tag reachable from `origin/main` and both version files match it.
- **WIF denied:** confirm the provider subject is the repository's `chrome-web-store` environment subject and has `roles/iam.workloadIdentityUser` on the linked service account.
- **Upload rejected:** Chrome requires a version higher than every previously uploaded version. Check the Developer Dashboard for an existing draft or policy warning.
- **Visibility error:** publish the changed visibility manually once in the Developer Dashboard.
