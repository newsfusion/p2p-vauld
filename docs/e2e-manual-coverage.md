# E2E Coverage for Manual Testing Scenarios

This table maps `docs/manual-testing.md` scenarios to current automated E2E coverage status.

| Scenario | Status | E2E coverage |
|---|---|---|
| MT-001 Build and sideload production extension | manual-only | Chrome extension loading is exercised by smoke fixtures, but Chrome details page permission inspection remains manual. |
| MT-002 Build and sideload demo extension | covered | `tests/e2e/smoke/demo-sync.test.ts`, `tests/e2e/smoke/cdp-content-script.demo.test.ts` |
| MT-003 First launch onboarding with invisible key | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-004 First launch onboarding with master password | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-005 Popup locked state | new automated E2E | `tests/e2e/smoke/popup-flows.test.ts` |
| MT-006 Popup unlocked summary and actions | new automated E2E | `tests/e2e/smoke/popup-flows.test.ts` |
| MT-007 Dashboard navigation | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-008 Theme persistence | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-009 User-visible language | manual-only | Requires visual language review across browser/extension states. |
| MT-010 Add credentials | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-011 Verify credentials are encrypted | manual-only | Storage inspection remains manual; automated export tests assert no plaintext secrets in financial exports. |
| MT-012 Edit existing credentials | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-013 Delete credentials | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-014 Activate and deactivate platform | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-015 Per-platform safe and stealth mode | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-016 Global debug mode | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-017 Parallel sync setting | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-018 Sync reminder setting | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-019 Auto-lock setting | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-020 Portfolio empty state | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-021 Portfolio table with configured platforms | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-022 Privacy mode | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-023 Sync all success in demo mode | covered | `tests/e2e/smoke/demo-sync.test.ts` |
| MT-024 Sync all success in live mode | env-gated live E2E | `tests/e2e/smoke/live-platform-matrix.test.ts` |
| MT-025 Single platform sync | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-026 Cancel all sync | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-027 Cancel single platform sync | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-028 Failed login | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-029 Two-factor authentication | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-030 Captcha or bot protection | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-031 Platform offline or timeout | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-032 Extraction failure and safe mode prompt | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-033 Extraction choice modal | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-034 Analytics view | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-035 Delta history and revert | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-036 Export CSV | new automated E2E | `tests/e2e/smoke/export-tab.test.ts` |
| MT-037 Backup JSON | new automated E2E | `tests/e2e/smoke/export-tab.test.ts` |
| MT-038 Restore valid backup | new automated E2E | `tests/e2e/smoke/export-tab.test.ts` |
| MT-039 Restore invalid backup | new automated E2E | `tests/e2e/smoke/export-tab.test.ts` |
| MT-040 Debug panel empty and active states | new automated E2E | `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-041 Debug activity logs and signal details | new automated E2E | `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-042 Captured HTML viewer | new automated E2E | `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-043 Debug to login extractor transfer | covered | `tests/e2e/smoke/debug-to-extractor-transfer.test.ts`, `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-044 Debug to dashboard extractor transfer | new automated E2E | `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-045 Login extractor fixture tests | new automated E2E | `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-046 Dashboard extractor fixture tests | new automated E2E | `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-047 Gemini Nano banner and settings | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-048 Gemini Nano download | new automated E2E | `tests/e2e/smoke/settings-credentials.test.ts` |
| MT-049 Manual value override | new automated E2E | `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-050 Cleanup stale syncs | new automated E2E | `tests/e2e/smoke/debug-extractor-flows.test.ts` |
| MT-051 Imported-only financial data | new automated E2E | `tests/e2e/smoke/export-tab.test.ts` |
| MT-052 Service worker reload resilience | covered | `tests/e2e/smoke/service-worker-restart.demo.test.ts` (real MV3 worker termination), `tests/e2e/smoke/sync-recovery-flows.test.ts` (dashboard hydration) |
| MT-053 Browser permission and host permission behavior | manual-only | Chrome extension site-access mutation is not reliable in Playwright. |
| MT-054 Mobile-width dashboard layout | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-055 Keyboard and focus basics | new automated E2E | `tests/e2e/smoke/dashboard-core-flows.test.ts` |
| MT-056 Data persistence across reload and extension update | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-057 Data pruning and history sanity | new automated E2E | `tests/e2e/smoke/sync-recovery-flows.test.ts` |
| MT-058 Platform-specific live sync checklist | env-gated live E2E | `tests/e2e/smoke/live-platform-matrix.test.ts` |
