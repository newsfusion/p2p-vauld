# Manual Testing Guide

This document describes how to manually test the P2P Portfolio Tracker Chrome Extension. It covers the extension shell, security flows, dashboard, popup, sync engine, platform extraction, debug tooling, export and restore, and recovery paths.

## Scope

Manual testing must verify:

- The extension can be built, sideloaded, opened, reloaded, and removed without errors.
- Credentials are encrypted before storage and are never visible as plaintext in Chrome storage or IndexedDB.
- The dashboard, popup, settings, sync, analytics, export, restore, debug, and extractor workflows behave correctly.
- Demo mode works without live platform accounts.
- Live platform testing works for every configured platform where the tester has valid credentials.
- Error and recovery flows remain visible and useful.
- All user-visible extension text is English. Platform-provided labels may appear in other languages only when they come from real platform pages, fixtures, selectors, or scraped data.

## Test Environments

Run at least one pass in each relevant environment:

- Chrome stable on desktop, clean Chrome profile.
- Chrome stable on desktop, existing profile with saved extension data.
- Demo mode build with local demo platform service.
- Production build against real platforms where credentials are available.
- Light and dark themes.
- Dashboard viewport widths: 1280 px, 768 px, and 390 px.

## Required Commands

Production build:

```bash
pnpm install
pnpm build
```

Demo mode:

```bash
pnpm demo:service
pnpm dev:demo
```

Optional automated checks before manual testing:

```bash
pnpm typecheck
pnpm test
pnpm test:smoke:demo
```

## Resetting Manual Test State

Use a clean Chrome profile whenever possible. If reusing a profile:

1. Open `chrome://extensions`.
2. Remove the existing P2P Portfolio Tracker extension.
3. Open DevTools for the extension dashboard if needed.
4. Clear `chrome.storage.local`, `chrome.storage.sync`, and IndexedDB database `p2p_tracker`.
5. Reload Chrome or reload the unpacked extension.
6. Load the fresh `dist/` folder again.

Expected result:

- The extension starts as a fresh install.
- The onboarding modal appears on first dashboard open.
- No old platform credentials or metrics remain.

## Platform Coverage Matrix

Repeat the platform-specific credential, sync, failure, debug, and extractor checks for each enabled platform that can be tested. Demo mode currently covers the first 10 IDs in this list.

| Platform | Platform ID | Demo coverage | Live account required |
|---|---|---:|---:|
| Mintos | `mintos` | Yes | Yes |
| Bondora Go & Grow | `bondora_go_grow` | Yes | Yes |
| PeerBerry | `peerberry` | Yes | Yes |
| Robocash | `robocash` | Yes | Yes |
| Twino | `twino` | Yes | Yes |
| Estateguru | `estateguru` | Yes | Yes |
| Debitum | `debitum` | Yes | Yes |
| Esketit | `esketit` | Yes | Yes |
| Viainvest | `viainvest` | Yes | Yes |
| Nectaro | `nectaro` | Yes | Yes |
| Afranga | `afranga` | No | Yes |
| Asterra Estate | `asterra_estate` | No | Yes |
| Devon | `devon` | No | Yes |
| FF Forest | `ff_forest` | No | Yes |
| Ventus Energy | `ventus_energy` | No | Yes |
| Indemo | `indemo` | No | Yes |
| InRento | `inrento` | No | Yes |
| Crowdpear | `crowdpear` | No | Yes |
| Income | `income_marketplace` | No | Yes |
| Lande | `lande` | No | Yes |
| Capitalia | `capitalia` | No | Yes |
| Fintown | `fintown` | No | Yes |
| Monefit SmartSaver | `monefit_smartsaver` | No | Yes |
| MyPeak Finance | `mypeak_finance` | No | Yes |
| Triple Dragon Funding | `triple_dragon` | No | Yes |
| InSoil Finance | `insoil_finance` | No | Yes |
| Bondster | `bondster` | No | Yes |
| Crowdestor | `crowdestor` | No | Yes |
| Lendermarket | `lendermarket` | No | Yes |
| Swaper | `swaper` | No | Yes |
| IUVO Group | `iuvo_group` | No | Yes |
| Kviku Finance | `kviku_finance` | No | Yes |
| Neo Finance | `neo_finance` | No | Yes |
| Finbee | `finbee` | No | Yes |
| Axia Funder | `axia_funder` | No | Yes |
| Maclear | `maclear` | No | Yes |
| Loanch | `loanch` | No | Yes |
| Savy | `savy` | No | Yes |
| Quanloop | `quanloop` | No | Yes |
| Bergfuerst | `bergfurst` | No | Yes |
| Exporo | `exporo` | No | Yes |
| Stock.estate | `stock_estate` | No | Yes |
| Shojin | `shojin` | No | Yes |
| CrowdedHero | `crowdedhero` | No | Yes |
| Hive5 | `hive5` | No | Yes |
| Lonvest | `lonvest` | No | Yes |
| Landex | `landex` | No | Yes |
| Nibble | `nibble` | No | Yes |
| Modena | `modena` | No | Yes |
| Profitus | `profitus` | No | Yes |
| Nordstreet | `nordstreet` | No | Yes |
| Linked Finance | `linked_finance` | No | Yes |
| PlanetHome | `planethome` | No | Yes |
| LetsInvest | `letsinvest` | No | Yes |

## Test Cases

### MT-001 Build and Sideload Production Extension

Steps:

1. Run `pnpm build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the repository `dist/` folder.
6. Confirm the extension appears as "P2P Portfolio Tracker".
7. Click the extension details page.

Expected result:

- The extension loads without Chrome manifest errors.
- Version shown by Chrome matches `manifest.json`.
- Permissions include storage, tabs, scripting, offscreen, alarms, and favicon.
- The browser action icon appears in the toolbar or extension menu.

### MT-002 Build and Sideload Demo Extension

Steps:

1. Start `pnpm demo:service`.
2. Start `pnpm dev:demo`.
3. Load or reload `dist/` in `chrome://extensions`.
4. Open the dashboard.

Expected result:

- The extension loads without manifest errors.
- Demo platform URLs resolve through the local demo service.
- Demo credentials/platforms are available for demo sync testing.

### MT-003 First Launch Onboarding With Invisible Key

Steps:

1. Start from a clean extension state.
2. Open the dashboard from the extension popup or extension details page.
3. In the onboarding modal, choose Use Invisible Key.
4. Read the confirmation screen.
5. Click Continue.
6. Reload the dashboard.

Expected result:

- The modal explains the local browser-profile key risk.
- Onboarding completes without asking for a password.
- Reloading the dashboard opens the app without an unlock screen.
- No plaintext credentials exist because no credentials have been saved yet.

### MT-004 First Launch Onboarding With Master Password

Steps:

1. Start from a clean extension state.
2. Open the dashboard.
3. Choose Set a Master Password.
4. Enter a password shorter than 8 characters and submit.
5. Enter two different valid-length passwords and submit.
6. Enter matching passwords of at least 8 characters and submit.
7. Click Lock in the dashboard header.
8. Enter an incorrect password.
9. Enter the correct password.

Expected result:

- Short passwords show "Password must be at least 8 characters."
- Mismatched passwords show "Passwords do not match."
- Valid setup completes onboarding.
- Locking shows the unlock screen.
- Incorrect unlock shows an error.
- Correct unlock returns to the dashboard.
- The master password itself is not present in Chrome storage or IndexedDB.

### MT-005 Dashboard Locked State From Toolbar

Steps:

1. Use a profile configured with a master password.
2. Lock the extension.
3. Click the browser action icon.
4. Enter an incorrect master password.
5. Toggle password visibility.
6. Enter the correct master password.

Expected result:

- The browser action opens or focuses `dashboard.html`; it does not open the optional standalone popup page.
- Dashboard shows a locked state and master password field.
- Incorrect password shows an error.
- Visibility toggle switches between masked and visible password input.
- Correct unlock changes the dashboard to the portfolio overview.

### MT-006 Dashboard Unlocked State From Toolbar

Steps:

1. Unlock the extension.
2. Click the browser action icon.
3. Inspect totals and platform rows.
4. Click the theme toggle.
5. Click Sync All.
6. During sync, click Cancel.

Expected result:

- The browser action opens a new dashboard tab or focuses the existing dashboard tab without creating duplicates.
- Dashboard shows total Portfolio Value and Free Cash.
- Each enabled platform row shows a value or "No data".
- Theme toggle updates visual theme.
- Sync All starts sync and shows per-platform progress.
- Cancel sends a cancellation request and clears syncing state after cancellation completes.

### MT-007 Dashboard Navigation

Steps:

1. Open the dashboard.
2. Click Portfolio, Analytics, Export, and Settings.
3. Enable Debug Mode in Settings.
4. Confirm Debug, Login Extractor, and Dashboard Extractor tabs appear.
5. Click each debug tab.
6. Disable Debug Mode.

Expected result:

- Each tab opens the expected view.
- Debug-only tabs are hidden until Debug Mode is enabled.
- Debug-only tabs disappear when Debug Mode is disabled.
- Navigation stays usable at desktop and mobile widths.

### MT-008 Theme Persistence

Steps:

1. Open the dashboard.
2. Toggle between light and dark mode.
3. Reload the dashboard.
4. Open the popup.

Expected result:

- Theme changes immediately.
- The selected theme persists after reload.
- Popup and dashboard use the same theme.

### MT-009 User-Visible Language

Steps:

1. Open all dashboard tabs.
2. Open the popup in locked and unlocked states.
3. Open onboarding screens.
4. Enable Debug Mode and open Debug, Login Extractor, and Dashboard Extractor.
5. Trigger modals where possible: extraction choice, manual action, Safe Mode prompt, export restore confirmation.
6. Scan visible extension UI text.

Expected result:

- All extension-owned UI text is English.
- German or other non-English text appears only when it is platform data, selector text, fixture text, or scraped page content.
- Any non-English extension-owned label is a defect.

### MT-010 Add Credentials

Steps:

1. Open Settings.
2. In Connect new platform, focus the Platform combobox.
3. Type part of a platform name.
4. Select a platform by mouse.
5. Repeat selection using Arrow Down, Arrow Up, Enter, and Escape.
6. Enter username/email and password.
7. Expand Advanced Settings.
8. Toggle Safe Mode and Stealth Mode.
9. Click Connect platform.

Expected result:

- Platform search filters correctly.
- Keyboard selection works.
- Save is disabled until a platform is selected.
- Credentials save successfully with "Credentials saved securely."
- Password input is cleared after save.
- The platform appears in Connected Platforms.
- The platform appears in the Portfolio table as syncable.

### MT-011 Verify Credentials Are Encrypted

Steps:

1. Save credentials with a unique test username and password.
2. Open DevTools for the extension service worker or dashboard.
3. Inspect `chrome.storage.local`, `chrome.storage.session`, `chrome.storage.sync`, and IndexedDB `p2p_tracker`.
4. Search for the exact plaintext username and password.
5. Search for obvious partial password fragments.

Expected result:

- Plaintext username and password are not present anywhere in browser storage or IndexedDB.
- Credential records, if visible, are encrypted payloads or metadata only.
- The optional username prefill in `chrome.storage.session` is an AES-GCM encrypted payload, never a plaintext string.
- No credential is stored through a third-party crypto library.

### MT-012 Edit Existing Credentials

Steps:

1. Open Settings with at least one connected platform.
2. Click the edit icon for the platform.
3. Confirm the Connect new platform form scrolls into view.
4. Enter a new username and password.
5. Toggle Safe Mode or Stealth Mode.
6. Save.

Expected result:

- The selected platform is preselected.
- Username field receives focus.
- Updated credentials save securely.
- Mode changes persist in Connected Platforms after reload.

### MT-013 Delete Credentials

Steps:

1. Open Settings with at least one connected platform.
2. Click the delete icon for a platform.
3. Reload Settings.
4. Open Portfolio.

Expected result:

- Platform credentials are removed.
- Platform is no longer syncable.
- If imported or historical financial data exists for the platform, the row can remain as imported data only.
- No unrelated credentials are removed.

### MT-014 Activate and Deactivate Platform

Steps:

1. Open Settings with at least one connected platform.
2. Click the power icon to deactivate it.
3. Open Portfolio.
4. Return to Settings and reactivate it.
5. Open Portfolio again.

Expected result:

- Connected Platforms status changes between Active and Deactivated.
- Deactivated platforms are excluded from visible syncable platform lists.
- Reactivated platforms return to Portfolio and Sync All eligibility.

### MT-015 Per-Platform Safe and Stealth Mode

Steps:

1. Open Settings.
2. Save or select a connected platform.
3. Toggle the Safe pill in Connected Platforms.
4. Toggle the Stealth pill.
5. Reload Settings.

Expected result:

- Each pill changes visual pressed state.
- Changes persist after reload.
- Safe Mode causes the next sync to use foreground/careful navigation behavior where applicable.
- Stealth Mode causes human-paced login actions where applicable.

### MT-016 Global Debug Mode

Steps:

1. Open Settings.
2. Toggle Debug Mode on.
3. Confirm debug tabs appear.
4. Run a sync.
5. Open Debug.
6. Toggle Debug Mode off.

Expected result:

- Debug Mode setting persists after reload.
- Debug snapshots are created during sync when debug data is available.
- Debug tabs are hidden after disabling Debug Mode.

### MT-017 Parallel Sync Setting

Steps:

1. Open Settings.
2. Toggle Parallel Sync on.
3. Run Sync All with multiple connected platforms.
4. Observe opened tabs and progress.
5. Toggle Parallel Sync off and run Sync All again.

Expected result:

- Setting persists after reload.
- Parallel mode runs no more than two platforms at once.
- Sequential mode syncs one platform at a time.
- Manual-action and cancellation behavior remains correct in both modes.

### MT-018 Sync Reminder Setting

Steps:

1. Open Settings.
2. Change Sync Reminder Days to `1`.
3. Reload Settings.
4. Change it to `365`.
5. Try values below `1`, above `365`, and decimals.

Expected result:

- Values are clamped to whole days between 1 and 365.
- Setting persists.
- The extension badge/reminder behavior uses the configured threshold when sync data becomes stale.

### MT-019 Auto-Lock Setting

Steps:

1. Use a master-password profile.
2. Open Settings.
3. Change Auto-Lock from Disabled to 5 min.
4. Reload Settings.
5. Set it back to Disabled.

Expected result:

- Auto-Lock appears only when a master password exists.
- Selected timeout persists.
- Disabled prevents automatic locking.

### MT-020 Portfolio Empty State

Steps:

1. Start from a clean extension state after onboarding.
2. Open Portfolio before adding credentials.

Expected result:

- Platform table shows "No configured platforms yet. Add login credentials in Settings."
- Sync All is disabled.
- Add Platform opens Settings.

### MT-021 Portfolio Table With Configured Platforms

Steps:

1. Add at least one platform credential.
2. Open Portfolio.
3. Inspect the platform row.
4. Click the row chevron.
5. Click Sync on the row.

Expected result:

- Row shows platform icon or initials.
- Row shows Portfolio Value, Free Cash, Net Return, and Since columns.
- Row expansion shows delta/history content.
- Row Sync starts a single-platform sync and disables conflicting sync buttons.

### MT-022 Privacy Mode

Steps:

1. Ensure at least one platform has metrics.
2. Open Portfolio.
3. Toggle Privacy Mode in the header.
4. Inspect all financial values in Portfolio, Analytics, popup, and history rows where available.
5. Reload the dashboard.

Expected result:

- Financial values are blurred or masked when Privacy Mode is enabled.
- Values are readable when Privacy Mode is disabled.
- Setting persists through reload.
- Non-financial labels remain readable.

### MT-023 Sync All Success in Demo Mode

Steps:

1. Start demo service and demo extension build.
2. Load the demo extension.
3. Complete onboarding.
4. Confirm demo platforms are configured.
5. Click Sync All from Portfolio.
6. Wait for sync completion.

Expected result:

- Sync progresses through all demo platforms.
- Each successful platform shows Done or success state.
- Portfolio metrics are saved and visible.
- Total Portfolio Value and Free Cash update.
- IndexedDB contains latest metrics and history rows.

### MT-024 Sync All Success in Live Mode

Steps:

1. Build production extension.
2. Add valid credentials for one or more live platforms.
3. Click Sync All.
4. Watch opened tabs and dashboard progress.
5. Wait for completion.

Expected result:

- The extension opens platform tabs as needed.
- It logs in without exposing the password in UI.
- It navigates to dashboard pages.
- Portfolio Value, Free Cash, and Net Return are extracted when present.
- Tabs are cleaned up or left only when manual action is required.
- Remaining platforms continue after one platform finishes.

### MT-025 Single Platform Sync

Steps:

1. Add at least two connected platforms.
2. Open Portfolio.
3. Click Sync on one platform row.
4. Observe other platform rows.

Expected result:

- Only the selected platform is queued/running.
- Other platforms are not synced.
- The selected row updates its metrics or status.

### MT-026 Cancel All Sync

Steps:

1. Start Sync All.
2. Click Cancel in the dashboard or popup.
3. Observe progress and open tabs.

Expected result:

- Running and queued platforms are cancelled.
- Dashboard exits syncing state.
- Cancelled platforms show Cancelled where visible.
- No new platform sync starts after cancellation.

### MT-027 Cancel Single Platform Sync

Steps:

1. Enable Debug Mode.
2. Start a sync for multiple platforms.
3. Use the per-platform cancellation path where available.
4. Observe remaining platforms.

Expected result:

- Selected platform cancels.
- Other platforms continue unless Cancel All was used.
- Cancelled platform does not overwrite latest valid metrics with zero values.

### MT-028 Failed Login

Steps:

1. Save invalid credentials for a platform.
2. Run a single-platform sync.
3. Open Portfolio.
4. Click Update in the failed row.

Expected result:

- Platform row shows Login failed.
- Update opens Settings for credential editing.
- Existing successful data, if any, is not silently deleted.
- Other platforms continue during Sync All.

### MT-029 Two-Factor Authentication

Steps:

1. Use a platform account that triggers 2FA.
2. Run sync for that platform.
3. Observe the manual action modal.
4. Enter the 2FA code if prompted.
5. Submit.
6. Repeat and cancel the modal.

Expected result:

- Sync does not freeze.
- Modal clearly asks for manual action.
- Submitting a valid code continues login.
- Cancelling cancels only the affected platform.
- Other platforms continue during Sync All.

### MT-030 Captcha or Bot Protection

Steps:

1. Use a platform or test account that triggers Captcha.
2. Run sync.
3. Observe the manual action modal and any foreground tab.
4. Solve Captcha manually if possible.
5. Cancel if solving is not possible.

Expected result:

- Platform is marked Manual Action Required or Captcha timeout.
- Dashboard links to the platform login page where appropriate.
- Sync continues for other platforms.
- Last known values remain visible if they existed.

### MT-031 Platform Offline or Timeout

Steps:

1. Disable network temporarily, block the platform domain, or use an unreachable test URL in a controlled test build.
2. Run sync for a platform that already has saved metrics.
3. Restore network after the test.

Expected result:

- Attempt times out instead of hanging indefinitely.
- Row shows Platform offline.
- Last known values remain visible with stale styling.
- Total portfolio does not drop to zero because of the timeout.

### MT-032 Extraction Failure and Safe Mode Prompt

Steps:

1. Use a platform state where login succeeds but financial extraction fails, or modify a local fixture/test page in a controlled build.
2. Run sync.
3. Observe the Safe Mode prompt.
4. Click Not now.
5. Run again and click Enable Safe Mode.

Expected result:

- Row shows Extract failed.
- Safe Mode prompt appears when Safe Mode is not already active.
- Not now dismisses the prompt.
- Enable Safe Mode persists the platform mode.
- Next sync uses Safe Mode behavior.

### MT-033 Extraction Choice Modal

Steps:

1. Use a page or fixture with ambiguous financial candidates.
2. Run sync until the extraction choice modal appears.
3. Select a candidate.
4. Repeat and let the request expire or cancel where possible.

Expected result:

- Modal shows platform, signal, candidate values, and context.
- Selecting a candidate resolves the sync request.
- Expired/cancelled choices do not leave the dashboard stuck in syncing state.

### MT-034 Analytics View

Steps:

1. Ensure multiple platforms have metrics.
2. Open Analytics.
3. Inspect KPI cards, distribution chart, and history chart.
4. Toggle Privacy Mode.
5. Change theme.

Expected result:

- Analytics totals match Portfolio totals.
- Distribution reflects platform values.
- Charts render without overlap or empty canvases.
- Privacy Mode masks financial values.
- Theme changes keep chart labels readable.

### MT-035 Delta History and Revert

Steps:

1. Run sync for the same platform at least twice.
2. Open Portfolio.
3. Expand the platform row.
4. Inspect history/delta rows.
5. Use any available revert action for a historical batch.

Expected result:

- History rows show previous metric changes.
- Dates and deltas are readable.
- Revert restores the selected previous metrics.
- Revert does not affect unrelated platforms.

### MT-036 Export CSV

Steps:

1. Ensure at least one platform has metrics.
2. Open Export.
3. Click Download CSV.
4. Open the downloaded CSV.

Expected result:

- File downloads with a timestamped `p2p-overview-...csv` name.
- CSV contains overview metrics.
- Numeric fields and platform IDs are present.
- No credentials or secrets are exported.

### MT-037 Backup JSON

Steps:

1. Ensure at least one platform has metrics/history.
2. Open Export.
3. Click Backup as JSON.
4. Open the downloaded JSON.

Expected result:

- File downloads with a timestamped `p2p-financial-backup-...json` name.
- Backup contains financial data payload and metadata.
- Backup does not contain platform credentials, plaintext passwords, or master password data.

### MT-038 Restore Valid Backup

Steps:

1. Create a JSON backup.
2. Clear or change current financial data.
3. Open Export.
4. Click Select JSON and choose the backup.
5. Confirm "Backup ready to restore."
6. Click Restore.
7. Accept the browser confirmation.
8. Open Portfolio.

Expected result:

- Backup validates before restore.
- Restore confirmation warns that financial data will be replaced.
- Financial metrics are restored.
- Credentials and settings remain unchanged.
- Imported-only platforms show Add credentials instead of Sync.

### MT-039 Restore Invalid Backup

Steps:

1. Create a non-JSON file.
2. Select it in Restore.
3. Create a JSON file with the wrong backup format.
4. Select it in Restore.
5. Create a file larger than 10 MB and select it.

Expected result:

- Non-JSON file shows "Invalid JSON backup file."
- Wrong schema shows a validation error.
- Oversized file shows "Backup file is too large."
- Restore button stays disabled until a valid backup is selected.

### MT-040 Debug Panel Empty and Active States

Steps:

1. Enable Debug Mode.
2. Open Debug before running sync.
3. Run Sync All from Debug.
4. Open Debug after sync starts or completes.

Expected result:

- Empty Debug view explains that sync is needed.
- Sync All is disabled when no credentials exist.
- After sync, Debug shows platform sections with status, logs, and timestamps.
- Individual platform sync buttons appear for configured platforms.

### MT-041 Debug Activity Logs and Signal Details

Steps:

1. Enable Debug Mode.
2. Run sync for a platform.
3. Open Debug.
4. Expand the platform section.
5. Expand signal sections.
6. Inspect candidates, selectors, winners, confidence, AI logs where available.

Expected result:

- Activity Log shows ordered steps with level indicators.
- Signal sections show selectors, winner, candidate table, values, scores, and context.
- Low-confidence or missing values are visually distinguishable.
- AI prompt/response sections appear only when AI logs exist.

### MT-042 Captured HTML Viewer

Steps:

1. Enable Debug Mode.
2. Run a sync that captures login HTML and dashboard HTML.
3. Open Debug.
4. Expand Login Page HTML and Dashboard HTML viewers.
5. Switch between Rendered and Raw HTML.

Expected result:

- Login and dashboard HTML are separate captured artifacts.
- Rendered iframe shows the captured page safely.
- Raw HTML textarea shows captured source.
- HTML viewers show character counts.

### MT-043 Debug to Login Extractor Transfer

Steps:

1. Complete MT-042 with login HTML available.
2. Click the send-to-extractor action in Login Page HTML.
3. Confirm the Login Extractor tab opens.
4. Click Test on the transferred HTML card.
5. Click Clear.

Expected result:

- Login Extractor receives platform ID, platform name, page type, timestamp, and HTML.
- Transferred HTML preview is visible.
- Test runs against captured HTML, not only bundled fixtures.
- Clear removes the transferred context.

### MT-044 Debug to Dashboard Extractor Transfer

Steps:

1. Complete MT-042 with dashboard HTML available.
2. Click the send-to-extractor action in Dashboard HTML.
3. Confirm the Dashboard Extractor tab opens.
4. Click Test on the transferred HTML card.
5. Inspect CSS and AI results.
6. Click Clear.

Expected result:

- Dashboard Extractor receives platform ID, platform name, page type, timestamp, and HTML.
- Test uses captured dashboard HTML.
- CSS extraction results show portfolio value, free cash, and net annual return where found.
- AI result is shown when Gemini Nano is available and otherwise reports why AI did not run.

### MT-045 Login Extractor Fixture Tests

Steps:

1. Enable Debug Mode.
2. Open Login Extractor.
3. For each enabled platform with a login fixture, click View HTML.
4. Click Test.
5. Modify selector override fields and click Test again.

Expected result:

- Fixture opens in a new tab.
- Required Username, Password, and Submit selectors match when fixture support exists.
- OTP selector may be missing and marked optional.
- Override fields affect the next test run without changing saved platform catalog files.

### MT-046 Dashboard Extractor Fixture Tests

Steps:

1. Enable Debug Mode.
2. Open Dashboard Extractor.
3. For each enabled platform with a dashboard fixture, click View HTML.
4. Click Test.
5. Expand Text Tree, AI Prompt, and AI Response sections when present.
6. Modify selector override fields and click Test again.

Expected result:

- Fixture opens in a new tab.
- Test parses HTML, cleans it, builds a text tree, and runs CSS extraction.
- Gemini Nano runs only when available.
- Missing fixtures or missing values show clear errors/warnings.
- Override fields affect only the current manual test session.

### MT-047 Gemini Nano Banner and Settings

Steps:

1. Use Chrome where Gemini Nano is unavailable or downloadable.
2. Open Portfolio.
3. Inspect the Gemini activation banner.
4. Click the banner settings action.
5. In Settings, inspect Gemini Nano status.
6. Dismiss the banner.
7. Reload dashboard.

Expected result:

- Banner appears only when status is not available and it has not been dismissed.
- Settings action scrolls to Gemini Nano settings.
- Unavailable state shows Chrome flag guidance.
- Dismissal persists after reload.

### MT-048 Gemini Nano Download

Steps:

1. Use Chrome where Gemini Nano is downloadable.
2. Open Settings.
3. Click Download Gemini Nano.
4. Observe progress.
5. Retry after a forced or natural failure if possible.

Expected result:

- Status changes to downloading.
- Progress bar updates when progress is available.
- Successful download changes status to Active.
- Failure shows a clear error and allows retry.

### MT-049 Manual Value Override

Steps:

1. Enable Debug Mode.
2. Add at least one platform credential.
3. Open Debug.
4. Expand Manual Value Override.
5. Enter custom Portfolio Value, Free Cash, and Net Return.
6. Click Save.
7. Open Portfolio and Analytics.

Expected result:

- Override saves with "Saved!" feedback.
- Portfolio row updates immediately after metrics refresh.
- Analytics reflects overridden values.
- Override affects only the selected platform.

### MT-050 Cleanup Stale Syncs

Steps:

1. Enable Debug Mode.
2. Create or simulate an orphaned running sync run.
3. Open Debug.
4. Click Cleanup Stale Syncs.
5. Check current sync status.

Expected result:

- Button shows Cleaning while running.
- Orphaned sync runs are marked failed or cleaned up.
- Current valid completed metrics remain intact.

### MT-051 Imported-Only Financial Data

Steps:

1. Restore a backup containing metrics for a platform without saved credentials.
2. Open Portfolio.
3. Inspect the platform row.
4. Click Add credentials.

Expected result:

- Row is visible as imported data only.
- Row does not show a Sync button.
- Add credentials opens Settings so credentials can be added.
- Existing imported metrics remain visible until replaced by sync or restore.

### MT-052 Service Worker Reload Resilience

Steps:

1. Start a sync.
2. Open `chrome://extensions`.
3. Click the service worker Inspect link.
4. Stop or reload the service worker during or after sync.
5. Reopen dashboard.

Expected result:

- Dashboard hydrates sync status from persisted state.
- Stale running syncs can be cleaned up.
- Metrics already saved before reload remain available.
- Extension does not rely on persistent in-memory service worker state.

### MT-053 Browser Permission and Host Permission Behavior

Steps:

1. Open `chrome://extensions`.
2. Inspect extension permissions and site access.
3. Run sync for a configured live platform.
4. Temporarily restrict site access for one platform domain.
5. Run sync again.

Expected result:

- Required host permissions exist for supported platform domains.
- Restricting site access causes a clear platform failure, not a crash.
- Other platforms continue syncing.

### MT-054 Mobile-Width Dashboard Layout

Steps:

1. Open dashboard DevTools device toolbar.
2. Set width to approximately 390 px.
3. Visit all tabs.
4. Open modals and expanded table rows.

Expected result:

- Header navigation remains horizontally usable.
- Buttons and text do not overlap.
- Tables scroll horizontally when needed.
- Modals fit the viewport and remain actionable.

### MT-055 Keyboard and Focus Basics

Steps:

1. Use Tab and Shift+Tab through onboarding, Settings, Portfolio actions, Export, and Debug.
2. Use Enter or Space on buttons and switches.
3. Use Escape where dropdowns or overlays support dismissal.

Expected result:

- Focus is visible.
- Interactive controls are reachable.
- Buttons, switches, comboboxes, and file inputs are usable without a mouse where practical.
- Focus does not become trapped except inside active modals.

### MT-056 Data Persistence Across Reload and Extension Update

Steps:

1. Save credentials and metrics.
2. Reload the dashboard.
3. Reload the extension in `chrome://extensions`.
4. Build a new version.
5. Reload the unpacked extension.
6. Open dashboard and popup.

Expected result:

- Settings persist.
- Credentials remain available and encrypted.
- Metrics and history remain available.
- The extension does not reset IndexedDB or storage during update.

### MT-057 Data Pruning and History Sanity

Steps:

1. Run multiple syncs or restore a backup with history.
2. Open Portfolio and Analytics.
3. Inspect history density and oldest visible records.
4. Trigger any available prune path in a controlled environment.

Expected result:

- Historical data remains associated with the correct platform.
- Pruning does not remove latest overview metrics.
- Charts and history views handle sparse data.

### MT-058 Platform-Specific Live Sync Checklist

Repeat these steps for every platform in the Platform Coverage Matrix where live credentials are available:

1. Add credentials for the platform.
2. Confirm the platform appears in Connected Platforms as Active.
3. Run a single-platform sync.
4. Confirm login completes or reports a clear manual action.
5. Confirm Portfolio Value is extracted when present on the platform.
6. Confirm Free Cash is extracted when present on the platform.
7. Confirm Net Return is extracted when present on the platform.
8. Enable Debug Mode and rerun sync.
9. Confirm login HTML and dashboard HTML are captured separately when available.
10. Send captured login HTML to Login Extractor and run Test.
11. Send captured dashboard HTML to Dashboard Extractor and run Test.
12. Run Sync All with this platform and at least one other platform.

Expected result:

- The platform does not break other syncs.
- Successful data writes metrics and history.
- Failed or blocked data shows a useful status.
- Debug snapshots provide enough information to diagnose selectors.
- No plaintext password is exposed in UI, logs, storage, or exported files.

## Release Sign-Off Checklist

Before signing off a release candidate:

- MT-001 through MT-023 pass in demo or production mode.
- MT-024 through MT-033 pass for all critical live platforms that can be tested.
- MT-036 through MT-039 pass with real downloaded files.
- MT-040 through MT-046 pass with Debug Mode enabled.
- MT-056 passes after extension reload and version update.
- All visible extension UI text is English.
- No manual test revealed plaintext credential storage.
- Any failed platform-specific live tests are documented with platform ID, URL, timestamp, screenshot, debug snapshot availability, and whether the failure is caused by credentials, 2FA/Captcha, platform downtime, selector drift, or extension logic.
