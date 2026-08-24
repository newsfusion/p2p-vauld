# Product Requirements Document: P2P Portfolio Tracker (Chrome Extension)

> [!IMPORTANT]
> **Historical Document (MVP State)**
> This document describes the initial vision, core principles, and MVP goals of the project. While the mission and security guardrails remain valid, some specific feature scopes (e.g., "7 major P2P platforms") have since been vastly expanded (currently 59 platforms). For the current technical state, architectural rules, and up-to-date features, always refer to the `AGENTS.md` and `README.md` in the repository root.

## 1. Executive Summary

The **P2P Portfolio Tracker** is a privacy-first Chrome Extension (Manifest V3) designed to automate the aggregation of investment data from multiple P2P lending platforms. By porting logic from a legacy Electron application in folder /template-electron/, this extension allows users to securely log in, retrieve their "Free Cash," "Portfolio Value," and "Yield," and visualize their entire P2P ecosystem in a single, local dashboard.

The application is built using a modern stack: **React 19**, **Tailwind CSS 4**, and **Dexie.js 4 (IndexedDB)** for historical data persistence. Security is the core pillar, utilizing the **Web Crypto API** for AES-256 encryption. Unlike cloud-based trackers, all sensitive credentials and financial data remain under the user's control within the browser environment.

**MVP Goal:** Enable automated data retrieval for 7 major P2P platforms within a single dashboard, protected by optional local encryption, while ensuring resilience against bot-detection mechanisms.

---

## 2. Mission & Core Principles

**Mission Statement:** To provide P2P investors with a transparent, automated, and secure window into their portfolio, eliminating manual spreadsheet entry while maintaining absolute data sovereignty.

**Core Principles:**

1. **Privacy-First** — Financial data is sensitive. No data should ever be sent to a central server. All encryption happens locally.
2. **Zero-Friction Automation** — The "One-Click" philosophy. The user initiates the process; the extension handles the complexity of logins and navigation.
3. **Resilience by Design** — Scraping is fragile. The "Universal Connector" must use smart heuristics to survive platform UI updates without breaking the user experience.
4. **Security Without Compromise** — Plaintext passwords are a hard blocker. Every credential must be encrypted before it hits the disk/storage.
5. **Test-Driven Reliability** — Every platform connector is validated with E2E tests (Playwright) to ensure consistent performance across updates.

---

## 3. Target Users

### The Passive Investor

- **Who:** Investors with 5+ P2P accounts who check their balances weekly/monthly.
- **Need:** Wants to see a "Total Sum" across all platforms without spending 20 minutes logging into individual sites.
- **Key Feature:** The "Refresh All" button and the unified table view.

### The Diversification Expert

- **Who:** Professional P2P investors who manage large sums and monitor platform-specific risk.
- **Need:** Needs to see the percentage distribution of their capital to avoid over-exposure to a single platform.
- **Key Feature:** The Analytics dashboard and historical trend tracking.

---

## 4. MVP Scope

### In Scope

**Core Functionality:**

- ✅ **Automated Login & Scraping:** Support for Mintos, Debitum, Estateguru, Income Marketplace, Indemo, Peerberry, and Triple Dragon Funding.
- ✅ **Universal Connector (Phase 2):** Heuristic-based DOM parsing for identifying login fields and balance values.
- ✅ **Hybrid Storage:** `chrome.storage.sync` for encrypted settings; `IndexedDB` for historical portfolio data.
- ✅ **Encryption Engine:** AES-GCM 256-bit encryption with optional Master Password or background-generated key.
- ✅ **Dashboard:** Full-page tab with a sortable table and "Privacy Mode" (blurring values). The UI interface must closely follow the look and feel of the legacy application in the `/template-electron` folder.
- ✅ **Analytics:** Visual charts showing fund distribution across the 7 platforms.
- ✅ **Error Handling:** Graceful failure for 2FA/Captchas with clear user notifications.

**Technical:**

- ✅ **Manifest V3:** Strict adherence to modern extension standards.
- ✅ **React 19.2 + Tailwind 4.2.1:** For a performant and modern UI.
- ✅ **Dexie.js 4.3.0:** For robust IndexedDB management.
- ✅ **Rate Limiting:** Sequential fetching by default, with optional capped parallel sync (`max 2`) and randomized jitter (1.5s - 3.5s) to reduce bot-protection risk.

### Out of Scope

- ❌ **Cloud Sync:** No external database or cross-browser sync beyond `storage.sync`.
- ❌ **Trading/Investing:** The extension is "Read-Only." No automated investing or withdrawals.
- ❌ **Tax Export:** No PDF/CSV generation for tax purposes in the MVP.
- ❌ **Mobile App:** Desktop Chrome only.
- ❌ **WebLLM Integration:** Reserved for a future Phase (Advanced AI Scraping).

---

## 5. Technical Guardrails

### Security Protocol (The "Iron Rule")

- **No Plaintext:** Credentials MUST be encrypted before being passed to any Storage API.
- **Web Crypto API:** Native browser crypto only (no third-party JS crypto bloat).
- **Zero-Persistence RAM:** Clear sensitive variables from memory immediately after the login cycle completes.

### Scraping & Bot-Defense

- **Guarded Execution:** Default to sequential execution. Optional parallel mode may run up to 2 platforms at once, with staggered starts and manual-action guardrails.
- **Action Delays:** 50-100ms delay between simulated keystrokes.
- **Shadow DOM:** Use Shadow DOM for UI overlays to prevent CSS leaking into the target P2P websites.

---

## 6. Roadmap & Phases

### Phase 1: Foundation & Security

- Setup Manifest V3 boilerplate.
- Implement Encryption Engine (AES-GCM).
- Develop the Master Password / Invisible Key logic.

### Phase 2: The Universal Connector (Core)

- Build sync engine with sequential default and optional guarded parallel mode.
- Implement connectors for the first 3 platforms (Mintos, Peerberry, Estateguru).
- Committed scraper fixtures must be synthetic and live in `tests/fixtures/platform-html-bundle.js`; real dashboard captures are local-only debugging data and must stay ignored.
- Test Playwright E2E flows for successful and failed logins.

### Phase 3: Data Persistence & UI

- Integrate Dexie.js for historical tracking.
- Build the React Dashboard (Table view & Privacy Mode), ensuring the UI strictly matches the design of the legacy `/template-electron` app.
- Connect the remaining 4 platforms.

### Phase 4: Analytics & Refinement

- Implement Distribution Charts (Pie/Bar).
- Finalize 2FA Error Handling and Status Logs.
- Prepare for Chrome Web Store submission.

---

## 7. Testing & Deployment

- **E2E Testing:** Playwright must cover:

1. Successful automated login and data extraction.
2. System behavior when 2FA is encountered.
3. Encryption/Decryption integrity checks.

- **Deployment:**
  - **Dev:** Sideloading via "Load Unpacked" (ZIP).
  - **Prod:** Chrome Web Store (pending security review).

---

## 8. User Stories & Acceptance Criteria

### 8.1 Security & Access

**User Story:** _As an investor, I want to protect my sensitive credentials with a master password, so that anyone with access to my computer cannot see my login data._

- **Acceptance Criteria:**
- Upon first launch, the user is asked if they want to set a master password.
- If "No" is selected, an "invisible key" is generated locally for AES-GCM encryption.
- If "Yes" is selected, the user must enter the password to unlock the dashboard and start the scraping process.
- The password itself is never stored; only a derived hash is used for verification.

### 8.2 Automated Data Retrieval

**User Story:** _As a user, I want the extension to log into my P2P accounts automatically, so that I don't have to manually open 7 different websites._

- **Acceptance Criteria:**
- The extension navigates to the login page of the selected platforms in a background/offscreen process.
- Credentials are decrypted in memory only during the active login session.
- The extension identifies the "Portfolio Value" and "Free Cash" fields using the Universal Connector.
- A status indicator shows the progress (e.g., "Scanning Mintos... 4/7 completed").

### 8.3 Data Privacy & Display

**User Story:** _As a user, I want to be able to blur my financial figures in the dashboard, so that I can use the tool in public spaces (like a café or train)._

- **Acceptance Criteria:**
- A "Privacy Mode" toggle is available in the header.
- When active, all currency values are blurred using CSS, but remain readable when hovered or toggled off.
- The state of the "Privacy Mode" is persisted in `chrome.storage.local`.

### 8.4 Analytics & Portfolio Health

**User Story:** _As a diversification expert, I want to see my capital distribution as a chart, so that I can identify if I am over-exposed to a single platform._

- **Acceptance Criteria:**
- A pie chart automatically calculates the percentage share of each platform based on the total portfolio value.
- Clicking a platform in the chart filters the table view.

### 8.5 Handling Failed Logins

**User Story:** _As a user, I want to be notified immediately if my credentials for a platform are no longer valid, so that I can update them promptly._

- **Acceptance Criteria:**
- If the plugin detects an "Invalid Credentials" message on the target site, the retrieval process for that specific platform is aborted.
- A red warning icon appears in the dashboard table with the message: _"Login failed - Please check credentials."_
- The user is provided with a direct "Update" button within the table row to modify the stored credentials for that platform.

### 8.6 2FA & Bot-Protection (The "Showstopper")

**User Story:** _As a user, I don't want the entire retrieval process to freeze if a platform triggers a Two-Factor Authentication (2FA) prompt or a Captcha._

- **Acceptance Criteria:**
- The plugin must detect common 2FA input fields or Captcha elements.
- Instead of waiting indefinitely, the plugin marks the platform as _"Manual Action Required."_
- The background process continues to fetch data for the remaining platforms without interruption.
- Clicking the error message opens the platform's login page in a new tab, allowing the user to solve the 2FA challenge manually.

### 8.7 Website Maintenance & Downtime

**User Story:** _As a user, I want to be informed if a P2P platform is currently undergoing maintenance, so I know the error isn't caused by the extension._

- **Acceptance Criteria:**
- **Timeout Logic:** If a page fails to load or respond within 15 seconds, the attempt is aborted.
- **Status Display:** The table displays the status _"Platform Offline / Maintenance."_
- **Data Persistence:** The plugin retains and displays the "Last Known Value" (grayed out) rather than showing a zero balance, ensuring the total portfolio calculation remains as accurate as possible.
