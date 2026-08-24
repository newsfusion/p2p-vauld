# P2P Portfolio Tracker (Chrome Extension)

FIRST: CONFIRM THAT YOU READ THIS FILE WITH "📕 READ AGENTS.MD 📕"

## Project Overview

A **privacy-first Chrome Extension (Manifest V3)** that automatically logs into multiple P2P lending platforms, scrapes portfolio data (Portfolio Value, Free Cash, Net Annual Return), and displays everything in a unified local dashboard.

- **PRD:** `docs/PRD.md`
- **Source of truth:** This repository, specially `src/shared/`, `src/content/` und `tests/`
- **Platform HTML Fixtures:** Commit only synthetic fixtures in `tests/fixtures/platform-html-bundle.js`. Real platform captures are local-only, ignored, and must never be committed.
- **User-visible language:** All text shown to users in the extension UI, notifications, dialogs, debug panels, and error/recovery flows must be English. German labels may appear only as platform data, selectors, fixtures, or scraper keywords needed to read real P2P pages.

## Product Goals

These are the user-facing promises the product is built on. Protect them during refactors — a change that technically works but weakens one of these degrades the product.

- **1-click portfolio refresh** across all connected platforms (core USP — no manual logins).
- **Free Cash Finder:** surface uninvested cash per platform so users can reinvest it (avoid cash drag).
- **Analytics + gapless history:** users must be able to trace how values changed over time.
- **Data export** for further processing (Excel, Portfolio Performance). Currently CSV + JSON backup — do not claim more formats than exist.
- **100% open source, 100% local:** no tracking, no server calls, no external data transfer of any kind. All credentials encrypted locally. This is a trust promise with direct architecture consequences (on-device AI only, local crypto, auditable code).

## Tech Stack & Constraints

- **Platform:** Chrome Extension MV3 (Strictly follow MV3 manifest and background service worker constraints).
- **Frontend:** React 19 + Tailwind CSS 4 + Vite
- **State & Storage:** Zustand 5 for app state. Dexie.js 4 for IndexedDB persistence.
- **Security:** Use ONLY native Web Crypto API (AES-GCM 256-bit).
- **Logic:** TypeScript in strict mode. Prefer functional patterns over classes.
- **Tooling:** pnpm for packages. Vitest for unit tests; Playwright for E2E.

**Do not use:**

- Node.js `crypto` module (browser extension context — use Web Crypto API only)
- `argon2` or any native Node modules (use `PBKDF2` via Web Crypto API for key derivation)
- `better-sqlite3` or any SQLite library (use Dexie.js / IndexedDB)
- Playwright for scraping inside the extension (use Chrome extension APIs: `chrome.tabs`, `chrome.scripting`, or offscreen documents)

## Architecture & Constraints

- **Security Iron Rule:** NEVER store plaintext credentials. Encrypt before persisting anywhere.
- **Credential storage (actual state):** Encrypted credentials live in the Dexie table `credentials` (IndexedDB). Keystore metadata (salt, verification hash) lives in `chrome.storage.local`. `chrome.storage.sync` is **not used anywhere** — do not introduce it (it would sync encrypted blobs to Google servers and break the local-only promise).
- **DB Access Iron Rule:** No Dexie/IndexedDB access from the service worker. The SW reaches the DB only via the offscreen document proxy (`withOffscreenLease`, message contract in `src/shared/db-messages.ts`, handler in `src/offscreen/index.ts`). Any direct Dexie usage must stay outside the service worker.
- **Scraping/Connector Engine:** see `docs/connector-architektur.md`
- The master password itself is never stored — only a PBKDF2-derived verification hash.
- **Platform catalog:** `src/shared/platforms/platform-catalog.json` is the single source for supported platforms (59 enabled). `manifest.json` `host_permissions` must match the catalog domains — when adding/changing catalog entries, verify the manifest hosts in the same change.
- **Data Access:** Refer to synthetic dashboard/login fixtures in `tests/fixtures/platform-html-bundle.js`. If live captures are needed for debugging, keep them outside Git or in ignored local paths only.

## Core Logic & Error Handling

- **Universal Connector:** Heuristic DOM parsing for `Portfolio Value`, `Free Cash`, `Yield`.
- **2FA/Captcha:** Do not block. Mark as "Manual Action Required", notify user, and continue.
- **Persistence:** If a platform is offline (15s timeout), display "Last Known Value" from IndexedDB.
- **Privacy Mode:** CSS-blur financial values; toggle state in `chrome.storage.local`.

### AI Extraction (Gemini Nano / Chrome Prompt API)

- AI-assisted extraction and login detection exist alongside the heuristic connector:
  - `src/content/ai-extractor.ts` — AI-powered candidate extraction
  - `src/content/ai-login.ts` — AI-powered login state detection
  - `src/content/ai-shared.ts` — shared LanguageModel/Prompt API utilities
  - `src/background/sync/extraction-verifier.ts` — verification of extraction results
  - `src/dashboard/components/GeminiActivationBanner.tsx` — UI for model availability/activation
- **On-device only Iron Rule:** AI runs exclusively via Chrome's built-in Gemini Nano (Prompt API). NEVER add external AI APIs, cloud LLM calls, or any network-based inference — page content contains financial data and must not leave the browser.
- AI paths are optional enhancements: heuristic extraction must keep working when the Prompt API is unavailable. Treat AI fallback wiring as preservation-sensitive — do not remove silently.

### Sync Flow Notes (regression-prone — do not "simplify" away)

- Sync opens one hidden popup window per platform, sequentially by default. Users may enable guarded parallel sync for at most two platforms, with 1.5–3.5s jitter between platform starts.
- The popup window is created **unfocused (not minimized)**; it is minimized only **after** the initial page load completes. Minimizing at creation stalls the first navigation — the tab never reaches "complete". (`openTab` in `src/background/sync/tab-session.ts`, `hideTabWindow` called from `sync.ts`.)
- **Safe mode:** after a failed login the platform syncs in a visible, focused window; reset on success.
- **2FA/captcha:** window is focused/restored for manual action, re-minimized after solve (unless safe mode).
- **Dashboard-link fallback:** if `portfolio_value` AND `free_cash` are both null after extraction, background sends `CLICK_DASHBOARD_LINK`; the content script clicks a visible Dashboard/Übersicht/Overview link, settles, and re-extracts once.

## Development Standards

- **Sideload:** Chrome -> Manage Extensions -> Load Unpacked (`/dist`).
- **Testing Requirement:** EVERY new feature or bugfix requires a corresponding test.
  - Logic/Crypto/Scoring: `vitest` unit tests.
  - User Flows/Scraping: `playwright` E2E tests.
- **Strict Rule:** No 3rd-party crypto libs. Clear sensitive RAM variables after login.
- **Version Management:** Do not change `manifest.json` version for ordinary feature, bugfix, refactor, or documentation changes. Only Web Store release preparation may bump `manifest.json` version; use `pnpm release:webstore`, which bumps the extension version and creates the Web Store release artifact.

### Branch / Worktree Completion Contract

- If an agent implements work in a branch or separate worktree, the task is not complete until the finished changes are integrated into `main`.
- Do not report branch-only or worktree-only implementation as finished. Before final completion, commit the implementation changes, switch to or operate from `main`, merge the completed branch/worktree changes into `main`, resolve conflicts without discarding unrelated user changes, and run the relevant verification after the merge.
- Merge/conflict resolution must preserve debugging, recovery, migration, import/export, fallback, and persistence-sensitive flows. These preservation contracts still apply during integration, not only during feature work.
- If the merge into `main` cannot be completed, report the task as blocked/incomplete and explain exactly why. The final response must clearly state whether `main` contains the finished changes.

## Feature Preservation Contracts

- Treat user-visible debugging, recovery, migration, import/export, and fallback flows as **preservation-sensitive features**. They must not disappear silently during refactors.
- Concrete export/backup contract (`src/dashboard/components/ExportPanel.tsx`): CSV export of overview metrics, JSON financial backup, and backup **validate + restore**. All three are preservation-sensitive user flows. Current formats are CSV and JSON only — no XLSX.
- If a refactor removes, splits, merges, renames, or reroutes an existing feature flow, call that out explicitly in the commit message and final summary. Hidden removals are regressions by default.
- Before deleting state, message fields, view routes, or UI actions, verify whether they belong to a user workflow and not just to an implementation detail.
- Preserve end-to-end feature contracts even when internals change. If the contract must change, update docs and tests in the same change.

### Preservation-sensitive Debug/Extractor Contract

- Debug mode is not just logging. It is a supported troubleshooting workflow.
- If live HTML capture exists for a platform page, the user must be able to inspect that HTML and run extractor diagnostics against that captured page without reconstructing the scenario manually.
- Login-page capture and dashboard-page capture are separate contracts. Do not assume one can replace the other.
- Removing any of the following requires explicit approval in the task/PR:
  - captured login HTML or captured dashboard HTML in debug snapshots
  - a UI action that transfers captured HTML into an extractor/debug test flow
  - extractor prefill context such as `platformId`, page type, or timestamp
  - debug-only views/tabs used for diagnosing broken selectors or extractors

### Preservation-sensitive Debitum Login Contract

- Debitum login automation is preservation-sensitive because it depends on SPA-hydrated login form behavior.
- Do not remove, weaken, or reroute any of the following without explicit user approval:
  - hidden form-control visibility semantics for `input`, `button`, `select`, and `textarea`
  - Debitum login selectors in the platform catalog
  - login-trigger retry behavior after opening the Debitum login page
  - login-page HTML capture used for debugging
  - Debug-to-Login-Extractor transfer for captured login pages
- Any approved change to this contract must include regression tests proving Debitum can still find and fill login credentials after landing-page login navigation.

### Refactor Safety Checklist

- For every refactor touching `background/`, `content/`, `dashboard/`, shared message types, or Zustand state:
  - list the existing user flows affected
  - state which flows were manually re-tested
  - state which tests prove those flows still work
  - state explicitly whether any feature was intentionally removed
- If the change touches message payloads, debug snapshot shape, persisted settings, or view routing, assume regression risk is high and add or update tests.

### Required Regression Coverage For Sensitive Flows

- If a feature spans more than one layer, prefer one test per contract boundary instead of only unit-testing helpers.
- Debug-to-extractor flows should have at least:
  - a unit/component test for transfer action wiring
  - a dashboard-level test for view switching and prefilled context
  - an E2E test for the user-visible troubleshooting flow when practical
- Refactors that change message/event shapes should add a regression test that fails if required fields disappear.

## Persistence Compatibility Mode

- **Release Status Flag:** See `docs/release-status.json` before changing any persisted contract.
- **Before first public release:** Storage keys, IndexedDB names, and settings field names may still be renamed deliberately.
- **After first public release:** Persisted data becomes a compatibility contract.
- Treat these as compatibility-sensitive:
  - IndexedDB database name, store names, key paths, indexes
  - `chrome.storage.local` / `chrome.storage.session` keys (`chrome.storage.sync` is not used)
  - Serialized settings, credential, and historical record shapes
- Current schema facts: `overviewMetrics` table was dropped (Dexie v10). `metricsHistory` is the source of truth — current values derive from the latest history snapshot. Do not reintroduce a separate "current metrics" store.
- After release, never rename or delete persisted keys/fields directly.
- After release, prefer additive changes by default.
- Any breaking persistence change requires:
  - an explicit migration path
  - tests proving upgrade keeps user data intact
- Resetting user DB/settings during update is a severe regression.

## Repository Map & Architecture

- **background/**: MV3 Service Worker (Sync & Encryption logic).
- **content/**: Scripts for P2P platform interaction.
- **offscreen/**: Dexie DB proxy for the service worker (the SW has no direct IndexedDB access — all DB reads/writes go through this offscreen document via `withOffscreenLease`).
- **popup/ & dashboard/**: React-based UI entry points.
- **shared/**: Core logic (wrappers for Web Crypto, Dexie.js, and Platform Connectors).

### Key MV3 Constraints

- **Service workers** replace background pages — no persistent state in memory across idle periods
- **`chrome.scripting.executeScript`** for injecting into P2P platform tabs
- **IndexedDB (Dexie)** for encrypted credentials, settings, and historical data; **`chrome.storage.local`** for keystore metadata (salt, verification hash) and small flags; **`chrome.storage.session`** for SW-restart-safe runtime state (e.g. `activeSyncRunId`). `chrome.storage.sync` is not used.

---

## Core Patterns

### Encryption (Iron Rule)

- Credentials are **always encrypted** before storage. Never pass plaintext to any Storage API.
- Use **AES-GCM 256-bit** via `window.crypto.subtle`.
- Key derivation: **PBKDF2** (SHA-256, 310,000 iterations) from master password, or auto-generate a random key stored in `chrome.storage.local`.
