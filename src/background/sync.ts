/**
 * Sync engine — orchestrates login + extraction for each platform.
 * Runs in the background service worker. No direct DOM access.
 */

import type {
  PlatformCatalogEntry,
  PlatformId,
  ConnectorSyncResult,
  FinancialSignalKey,
  IngestConnectorResultOutcome,
  SyncEventType,
  SyncEvent,
  DebugSignalResult,
  StoredCredentials,
  ExtractionCandidate,
  ExtractionChoiceSignalKey,
  SelectorProfile,
  LoginFieldRole,
  LoginSelectorMap,
  LoginSelectorProfile,
  StoredMetricsSnapshot,
} from "../shared/types/index.js";
import type {
  LoginMessage,
  LoginResponse,
  CheckLoginResponse,
  WaitForReadyResponse,
  DismissOverlaysResponse,
  ClickDashboardLinkResponse,
  DashboardNavStrategy,
} from "../shared/messages.js";
import type { AiExtractionLog } from "../shared/types/index.js";
import { getErrorMessage } from "../shared/error-utils.js";
import {
  ingestConnectorResult,
  updatePlatformProgress,
  getLatestSyncRun,
  getSettings,
  calculateNetAnnualReturn,
  getSelectorProfiles,
  getMetricsHistory,
  logExtractionTelemetry,
  getLoginSelectorProfiles,
  learnSelector,
  learnLoginSelectors,
  markSelectorFailure,
  markLoginSelectorFailures,
  getNavigationProfile,
  learnNavigationProfile,
  markNavigationFailure,
  saveCredentials,
  revertPlatformBatch,
  revertReplacedIngestionBatch,
} from "./db-proxy.js";
import { detectCurrency } from "../shared/currency.js";
import { getEncryptionKey } from "./keystore.js";
import { credentialAad, decrypt } from "../shared/crypto/index.js";
import { getCredentials } from "./db-proxy.js";
import {
  createPlatformLogger,
  buildExtractionLogDetail,
  buildDebugSignal,
  type ExtractSignalResult,
  type PlatformLogger,
} from "./sync/debug-logger.js";
import {
  CancelledError,
  TimeoutError,
  abortableOperation,
  abortableDelay,
  createTimeoutSignal,
  throwIfAborted,
} from "./sync/cancellation.js";
import {
  closeTab,
  hideTabWindow,
  navigateTabToUrl,
  openTab,
  waitForTabLoad,
} from "./sync/tab-session.js";
import { sendToTabWithTimeout } from "./sync/content-messaging.js";
import { waitForManualAction } from "./sync/manual-action.js";
import {
  aiExtractSignalFromTextTree,
  capturePageHtml,
  extractSignalFromTab,
  getTextTreeFromTab,
  signalSelectors,
} from "./sync/extraction-orchestrator.js";
import {
  hasUnsafeDuplicateSignalCandidate,
  runConvergentExtraction,
  type ConvergentExtractionResult,
} from "./sync/extraction-verifier.js";
import { assessOverviewInvariants } from "../shared/plausibility.js";
import { PRODUCTION_CONFIDENCE_THRESHOLD } from "../shared/scoring.js";
import { isWellEvidenced, pageQualityScore } from "../shared/page-quality.js";
import {
  createCandidateFingerprint,
  GEMINI_ONLY_SELECTOR,
  isChoiceSignal,
  resolveExtractionChoice,
  type GeminiChoiceValue,
} from "../shared/extraction-choice.js";
import {
  ExtractionChoiceTimeoutError,
  waitForExtractionChoice,
} from "./sync/extraction-choice-action.js";
import { runPlatforms } from "./sync/sync-runner.js";
import {
  DEMO_CREDENTIALS,
  isDemoModeEnabled,
} from "../shared/demo.js";
import {
  clearStoredLoginError,
  recordStoredLoginFailure,
  resetStoredLoginFailureCount,
} from "./login-failure-state.js";

const PAGE_TIMEOUT_MS = 15_000;
const MAX_STEALTH_LOGIN_TIMEOUT_MS = 45_000;
const MAX_STEALTH_FIXED_DELAY_MS = 1_210;
const LOGIN_VERIFY_TIMEOUT_MS = 20_000;
const LOGIN_VERIFY_POLL_MS = 1_500;
const LOGIN_TRIGGER_NAV_TIMEOUT_MS = 5_000;
const POST_NAV_SETTLE_MS = 2_000;
/** Budget for the whole dashboard navigation ladder, incl. re-extraction. */
const NAV_LADDER_MAX_MS = 90_000;
const TAB_MSG_TIMEOUT_MS = 10_000;
const MANUAL_ACTION_WAIT_TIMEOUT_MS = 300_000;
const EXTRACTION_CHOICE_WAIT_TIMEOUT_MS = 300_000;
const PLATFORM_SYNC_TIMEOUT_MS = 4 * 60_000; // 4 minutes max per platform
const SYNC_RUN_TIMEOUT_MS = 8 * 60_000; // 8 minutes max for entire live sync run
const DEMO_SYNC_RUN_TIMEOUT_MS = 8 * 60_000; // demo cohorts can exercise 10 browser flows
const MANUAL_ACTION_POLL_MS = 2_000;
const PARALLEL_SYNC_LIMIT = 2;
const MANUAL_ACTION_GATE_POLL_MS = 250;
const AI_LOG_RAW_RESPONSE_PREVIEW_CHARS = 120;
const AUTO_SELECTOR_FAST_PATH_CONFIDENCE = 0.95;

async function assertSyncRunStillActive(
  runId: string,
  platformId: PlatformId,
  signal?: AbortSignal,
): Promise<void> {
  if (signal) throwIfAborted(signal);
  const run = await getLatestSyncRun();
  if (!run || run.runId !== runId) {
    throw new CancelledError("Sync run is no longer active");
  }
  if (run.state !== "running" && run.state !== "queued") {
    throw new CancelledError(`Sync run is ${run.state}`);
  }
  const platformState = run.platformProgress?.[platformId];
  if (platformState === "cancelled") {
    throw new CancelledError("Platform sync was cancelled");
  }
  if (signal) throwIfAborted(signal);
}

async function revertIngestionOutcomeOnAbort({
  outcome,
  platform,
  log,
}: {
  outcome: IngestConnectorResultOutcome | undefined;
  platform: PlatformCatalogEntry;
  log: PlatformLogger;
}): Promise<void> {
  if (!outcome) return;

  try {
    if (outcome.createdBatch && outcome.batchId !== undefined) {
      await revertPlatformBatch(platform.id, outcome.batchId);
      log(
        "Reverted cancelled sync ingestion",
        `batchId=${outcome.batchId}`,
        "warn",
      );
      return;
    }

    if (outcome.replacedExistingBatch && outcome.replacementRollback) {
      await revertReplacedIngestionBatch(platform.id, outcome.replacementRollback);
      log(
        "Reverted cancelled sync replacement ingestion",
        `batchId=${outcome.batchId ?? "unknown"}`,
        "warn",
      );
    }
  } catch (error) {
    log(
      "Failed to revert cancelled sync ingestion",
      getErrorMessage(error),
      "error",
    );
  }
}

// ─── Platform sync ────────────────────────────────────────────────────────────

export type { SyncEventType, SyncEvent };

function combineAbortSignals(
  signals: Array<AbortSignal | undefined>,
): AbortSignal | undefined {
  const sources = signals.filter((source): source is AbortSignal => source !== undefined);
  if (sources.length <= 1) return sources[0];
  return AbortSignal.any(sources);
}

class DeferredActionError extends Error {
  constructor(readonly actionType: "2fa" | "captcha") {
    super(actionType === "2fa" ? "2FA required (Deferred)" : "Captcha required (Deferred)");
    this.name = "DeferredActionError";
  }
}

function isPlatformOnlyCancelledError(
  err: unknown,
  platformSignal: AbortSignal | undefined,
  runnerSignal: AbortSignal | undefined,
  runSignal: AbortSignal | undefined,
): boolean {
  return (
    err instanceof CancelledError &&
    platformSignal?.aborted === true &&
    runnerSignal?.aborted !== true &&
    runSignal?.aborted !== true
  );
}

function compactLogText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatAiNoResultDetail(aiLog: AiExtractionLog): string {
  const reason = aiLog.error ?? aiLog.reason ?? "unknown";
  const parts = [`No result from AI: ${reason}`];
  if (aiLog.durationMs !== undefined) parts.push(`duration=${aiLog.durationMs}ms`);
  if (aiLog.estimatedTokens !== undefined) {
    parts.push(`tokens=${aiLog.estimatedTokens}`);
  }
  if (aiLog.rawResponse) {
    const raw = compactLogText(aiLog.rawResponse).slice(
      0,
      AI_LOG_RAW_RESPONSE_PREVIEW_CHARS,
    );
    parts.push(`rawResponse=${raw}`);
  }
  return parts.join(", ");
}

function formatDuplicateSignalDetail(
  portfolioValue: ExtractSignalResult,
  freeCash: ExtractSignalResult,
): string {
  const candidate = portfolioValue.candidate ?? freeCash.candidate;
  const selector = candidate?.selector ?? "unknown selector";
  const origin = candidate?.origin ?? "unknown origin";
  const value =
    portfolioValue.value !== null ? portfolioValue.value : freeCash.value;
  return [
    `portfolio_value and free_cash resolved to the same unsafe heuristic candidate`,
    `value=${value ?? "missing"}`,
    `selector=${selector}`,
    `origin=${origin}`,
    `portfolioConfidence=${(portfolioValue.confidence * 100).toFixed(0)}%`,
    `freeCashConfidence=${(freeCash.confidence * 100).toFixed(0)}%`,
  ].join(", ");
}

function createManualActionGate() {
  let activeManualActions = 0;

  return {
    enter(): void {
      activeManualActions += 1;
    },
    leave(): void {
      activeManualActions = Math.max(0, activeManualActions - 1);
    },
    async waitForClear(signal?: AbortSignal): Promise<void> {
      while (activeManualActions > 0) {
        if (signal) throwIfAborted(signal);
        await abortableDelay(MANUAL_ACTION_GATE_POLL_MS, signal);
      }
    },
  };
}

export function resolveExecutionModes(
  stored: Pick<StoredCredentials, "safeModeEnabled" | "stealthModeEnabled">,
  platform: Pick<PlatformCatalogEntry, "login">,
  globalStealthMode: boolean,
): { safeMode: boolean; stealthMode: boolean } {
  return {
    safeMode: stored.safeModeEnabled ?? platform.login.safeMode ?? false,
    stealthMode: stored.stealthModeEnabled ?? globalStealthMode,
  };
}

export function resolveSafeModeTimeoutMs(
  baseMs: number,
  safeMode: boolean,
): number {
  return safeMode ? baseMs * 2 : baseMs;
}

export function resolveLoginMessageTimeoutMs(
  baseMs: number,
  stealthMode: boolean,
  username: string,
  password: string,
): number {
  if (!stealthMode) return baseMs;
  const characterCount =
    Array.from(username).length + Array.from(password).length;
  return Math.min(
    MAX_STEALTH_LOGIN_TIMEOUT_MS,
    baseMs + characterCount * 100 + MAX_STEALTH_FIXED_DELAY_MS,
  );
}

async function persistSafeMode(
  stored: StoredCredentials | undefined,
  safeModeEnabled: boolean,
  platformSafeModeDefault = false,
): Promise<void> {
  if (!stored) {
    return;
  }

  const latest = await getCredentials(stored.platformId);
  if (!latest) {
    return;
  }

  if ((latest.safeModeEnabled ?? platformSafeModeDefault) === safeModeEnabled) {
    return;
  }

  await saveCredentials({
    ...latest,
    safeModeEnabled,
    updatedAt: new Date().toISOString(),
  });
}

function profileForSignal(
  profiles: SelectorProfile[],
  signalKey: FinancialSignalKey,
): SelectorProfile | undefined {
  return profiles.find((profile) => profile.signalKey === signalKey);
}

async function dismissOverlaysFromTab(
  tabId: number,
  log: PlatformLogger,
): Promise<void> {
  try {
    const response = await sendToTabWithTimeout<DismissOverlaysResponse>(
      tabId,
      { type: "DISMISS_OVERLAYS" as const },
      TAB_MSG_TIMEOUT_MS,
    );
    if (response.clicked.length > 0 || response.blockingOverlayDetected) {
      log(
        "Overlay handling",
        `clicked=${response.clicked.length}, blocking=${response.blockingOverlayDetected}`,
        response.blockingOverlayDetected ? "warn" : "info",
      );
    }
  } catch (err) {
    log(
      "Overlay handling failed",
      getErrorMessage(err),
      "warn",
    );
  }
}

async function clickDashboardLinkInTab(
  tabId: number,
  log: PlatformLogger,
  strategy: DashboardNavStrategy = "keywords",
  excludeHrefs: string[] = [],
): Promise<ClickDashboardLinkResponse | null> {
  try {
    const response = await sendToTabWithTimeout<ClickDashboardLinkResponse>(
      tabId,
      {
        type: "CLICK_DASHBOARD_LINK" as const,
        payload: { strategy, excludeHrefs },
      },
      TAB_MSG_TIMEOUT_MS,
    );
    if (response.clicked) {
      log(
        "Dashboard link clicked",
        `strategy=${strategy}, text="${response.matchText ?? ""}", href=${response.href ?? "n/a"}, kind=${response.navigationKind ?? "click"}`,
      );
    } else {
      log(`No ${strategy} dashboard link found on page`, response.error, "warn");
    }
    return response;
  } catch (err) {
    log(
      "Dashboard link click failed",
      getErrorMessage(err),
      "warn",
    );
    return null;
  }
}

function normalizeVisitedHref(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const normalized = new URL(url);
    normalized.hash = "";
    return normalized.href;
  } catch {
    return null;
  }
}

/**
 * Accepts a stored URL only if it still belongs to the platform. Guards against
 * catalog domain changes and against a URL learned in demo mode ever being used
 * against a real platform.
 */
function resolvePlatformUrl(
  url: string,
  platform: PlatformCatalogEntry,
): string | null {
  const normalized = normalizeVisitedHref(url);
  if (!normalized) return null;
  const { hostname, protocol } = new URL(normalized);
  if (protocol !== "https:" && protocol !== "http:") return null;
  const belongsToPlatform = platform.domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  return belongsToPlatform ? normalized : null;
}

async function readCurrentTabHref(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return normalizeVisitedHref(tab.url);
  } catch {
    return null;
  }
}

async function recordExtractionTelemetry({
  platformId,
  runId,
  signalKey,
  stage,
  outcome,
  result,
  pollCount,
  warnings = [],
}: {
  platformId: PlatformId;
  runId: string;
  signalKey: "portfolio_value" | "free_cash";
  stage: "css" | "final" | "stored";
  outcome:
    | "auto_selected"
    | "choice_required"
    | "missing"
    | "low_confidence"
    | "stored_suspect"
    | "error";
  result: ExtractSignalResult;
  pollCount?: number;
  warnings?: string[];
}): Promise<void> {
  try {
    const topScore = result.allCandidates[0]?.score;
    await logExtractionTelemetry({
      platformId,
      runId,
      recordedAt: new Date().toISOString(),
      signalKey,
      stage,
      outcome,
      ...(result.value === null ? {} : { value: result.value }),
      confidence: result.confidence,
      ...(topScore === undefined ? {} : { topScore }),
      secondScore: result.allCandidates[1]?.score ?? null,
      candidateCount: result.allCandidates.length,
      elementsScanned: result.elementsScanned,
      ...(pollCount === undefined ? {} : { pollCount }),
      warnings,
    });
  } catch {
    // Telemetry must never block sync.
  }
}

async function autoLearnSelectorIfSafe({
  platformId,
  signalKey,
  result,
  warnings,
}: {
  platformId: PlatformId;
  signalKey: "portfolio_value" | "free_cash";
  result: ExtractSignalResult;
  warnings: string[];
}): Promise<void> {
  if (!result.candidate) return;
  if (result.confidence < 0.85) return;
  if (warnings.includes("suspect_value")) return;
  if (result.candidate.selector === GEMINI_ONLY_SELECTOR) return;
  const fingerprint =
    result.candidate.fingerprint ??
    createCandidateFingerprint(signalKey, result.candidate);
  await learnSelector({
    platformId,
    signalKey,
    selector: result.candidate.selector,
    fingerprint,
    confidence: result.confidence,
    source: "auto",
    learnedAt: new Date().toISOString(),
    lastVerifiedAt: new Date().toISOString(),
    failureCount: 0,
  });
}

/**
 * Remembers the page the accepted portfolio value came from, so the next sync
 * can go straight there, and retires a stored page that stopped working.
 */
async function recordNavigationOutcome({
  platformId,
  url,
  portfolio,
  warnings,
  userConfirmed,
  log,
}: {
  platformId: PlatformId;
  url: string | null;
  portfolio: ExtractSignalResult;
  warnings: string[];
  userConfirmed: boolean;
  log: ReturnType<typeof createPlatformLogger>;
}): Promise<void> {
  try {
    if (!url) return;
    const trustworthy =
      portfolio.value !== null &&
      portfolio.confidence >= 0.85 &&
      !warnings.includes("suspect_value");
    if (!trustworthy && !userConfirmed) return;

    await learnNavigationProfile({
      platformId,
      url,
      source: userConfirmed ? "user" : "auto",
      confidence: portfolio.confidence,
      learnedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
      failureCount: 0,
    });
    log("Learned overview page", url);
  } catch (err) {
    // Learning is an optimisation — never fail a sync over it.
    log("Could not persist overview page", getErrorMessage(err), "warn");
  }
}

function loginProfilesToSelectorMap(
  profiles: LoginSelectorProfile[],
): LoginSelectorMap | undefined {
  const selectors: LoginSelectorMap = {};
  for (const profile of profiles) {
    const existing = selectors[profile.fieldRole] ?? [];
    selectors[profile.fieldRole] = [...existing, profile.selector];
  }
  return Object.keys(selectors).length > 0 ? selectors : undefined;
}

function learnedLoginProfilesFromResult(
  platformId: PlatformId,
  loginResult: LoginResponse | undefined,
): LoginSelectorProfile[] {
  if (!loginResult?.learnedLoginSelectors) return [];
  const learnedAt = new Date().toISOString();
  const profiles: LoginSelectorProfile[] = [];

  for (const [fieldRole, selector] of Object.entries(
    loginResult.learnedLoginSelectors,
  ) as Array<[LoginFieldRole, string | undefined]>) {
    if (!selector || selector.includes("data-p2p-field")) continue;
    profiles.push({
      platformId,
      fieldRole,
      selector,
      fingerprint: `${fieldRole}|${selector}`,
      confidence: 1,
      source: "ai",
      learnedAt,
      failureCount: 0,
    });
  }

  return profiles;
}

async function learnVerifiedLoginSelectors(
  platformId: PlatformId,
  loginResult: LoginResponse | undefined,
  log: PlatformLogger,
): Promise<void> {
  const profiles = learnedLoginProfilesFromResult(platformId, loginResult);
  if (profiles.length === 0) return;

  try {
    await learnLoginSelectors(platformId, profiles);
    log(
      "Learned login selectors",
      profiles.map((profile) => profile.fieldRole).join(", "),
      "info",
    );
  } catch (err) {
    log(
      "Failed to persist learned login selectors",
      getErrorMessage(err),
      "warn",
    );
  }
}

async function markUsedLoginSelectorFailures(
  platformId: PlatformId,
  loginResult: LoginResponse | undefined,
  log: PlatformLogger,
): Promise<void> {
  const roles = loginResult?.staleLoginSelectorRoles ?? [];
  if (roles.length === 0) return;

  try {
    await markLoginSelectorFailures(platformId, roles);
    log("Marked stale login selector failures", roles.join(", "), "warn");
  } catch (err) {
    log(
      "Failed to mark login selector failures",
      getErrorMessage(err),
      "warn",
    );
  }
}

function resultFromCandidate(
  candidate: ExtractionCandidate,
  confidence: number,
  fallback: ExtractSignalResult,
  allCandidates: ExtractionCandidate[],
  warnings: string[] = [],
): ExtractSignalResult {
  return {
    value: candidate.value,
    confidence,
    candidate,
    allCandidates,
    elementsScanned: fallback.elementsScanned,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

function resultFromGeminiOnly(
  value: number,
  fallback: ExtractSignalResult,
): ExtractSignalResult {
  return {
    value,
    confidence: 0.95,
    allCandidates: fallback.allCandidates,
    elementsScanned: fallback.elementsScanned,
  };
}

async function applyStoredProfile(
  platformId: PlatformId,
  signalKey: ExtractionChoiceSignalKey,
  cssResult: ExtractSignalResult,
  storedProfile: SelectorProfile | undefined,
  log: ReturnType<typeof createPlatformLogger>,
  markFailure: (signalKey: ExtractionChoiceSignalKey) => Promise<void> = (key) =>
    markSelectorFailure(platformId, key),
): Promise<ExtractSignalResult | undefined> {
  if (!storedProfile) return undefined;

  const decision = resolveExtractionChoice({
    signalKey,
    candidates: cssResult.allCandidates,
    storedProfile,
  });

  if (decision.kind !== "selected" || decision.source !== "stored") {
    // For an explicit user choice an empty candidate set most likely means the
    // value has not rendered yet (SPA still loading), not that the selector
    // broke — do not penalise it. Auto-learned profiles keep expiring so they
    // can be replaced by a fresh auto-learn.
    const isUserProfile = (storedProfile.source ?? "user") === "user";
    if (!isUserProfile || cssResult.allCandidates.length > 0) {
      await markFailure(signalKey);
    }
    log(
      `${signalKey} stored selector did not match`,
      storedProfile.selector,
      "warn",
    );
    return undefined;
  }

  await learnSelector({
    ...storedProfile,
    confidence: decision.confidence,
    lastVerifiedAt: new Date().toISOString(),
    failureCount: 0,
  });

  return resultFromCandidate(
    decision.candidate,
    decision.confidence,
    cssResult,
    decision.allCandidates,
  );
}

type StoredSelectorFastPathResult =
  | { kind: "selected"; result: ExtractSignalResult }
  | { kind: "not_selected" }
  | { kind: "request_failed" };

async function tryStoredSelectorFastPath({
  tabId,
  platform,
  signalKey,
  storedProfile,
  fresh,
  log,
  markFailure,
}: {
  tabId: number;
  platform: PlatformCatalogEntry;
  signalKey: ExtractionChoiceSignalKey;
  storedProfile: SelectorProfile | undefined;
  fresh: boolean;
  log: ReturnType<typeof createPlatformLogger>;
  markFailure?: (signalKey: ExtractionChoiceSignalKey) => Promise<void>;
}): Promise<StoredSelectorFastPathResult> {
  const markSignalFailure =
    markFailure ?? ((key: ExtractionChoiceSignalKey) =>
      markSelectorFailure(platform.id, key));
  if (!storedProfile) return { kind: "not_selected" };
  if (
    storedProfile.source === "auto" &&
    storedProfile.confidence < AUTO_SELECTOR_FAST_PATH_CONFIDENCE
  ) {
    log(
      `${signalKey} stored selector fast-path skipped`,
      `auto confidence=${storedProfile.confidence.toFixed(2)}`,
    );
    return { kind: "not_selected" };
  }

  log(`${signalKey} stored selector fast-path`, storedProfile.selector);
  let selectorResult: ExtractSignalResult;
  try {
    selectorResult = await extractSignalFromTab(tabId, platform, signalKey, {
      ...(fresh ? { fresh: true } : {}),
      selectors: [storedProfile.selector],
      selectorOnly: true,
    });
  } catch (err) {
    await markSignalFailure(signalKey);
    log(
      `${signalKey} stored selector fast-path failed`,
      getErrorMessage(err),
      "warn",
    );
    return { kind: "request_failed" };
  }

  const result = await applyStoredProfile(
    platform.id,
    signalKey,
    selectorResult,
    storedProfile,
    log,
    markSignalFailure,
  );
  if (!result) return { kind: "not_selected" };

  log(`${signalKey} stored selector fast-path selected`, `value=${result.value}`);
  return { kind: "selected", result };
}

function resolveAutomaticSignalSelection({
  signalKey,
  cssResult,
  storedProfile,
  safeMode,
  log,
}: {
  signalKey: FinancialSignalKey;
  cssResult: ExtractSignalResult;
  /** Required so a remembered user choice can never be dropped by accident. */
  storedProfile: SelectorProfile | undefined;
  safeMode?: boolean;
  log: ReturnType<typeof createPlatformLogger>;
}): ExtractSignalResult | undefined {
  const decision = resolveExtractionChoice({
    signalKey,
    candidates: cssResult.allCandidates,
    storedProfile,
    ...(safeMode === undefined ? {} : { safeMode }),
  });

  if (decision.kind === "selected") {
    log(
      `${signalKey} selected`,
      `${decision.source}, value=${decision.value}`,
    );
    return resultFromCandidate(
      decision.candidate,
      decision.confidence,
      cssResult,
      decision.allCandidates,
      decision.warnings ?? [],
    );
  }

  if (decision.kind === "gemini_only") {
    log(`${signalKey} selected`, `gemini_only, value=${decision.value}`);
    return resultFromGeminiOnly(decision.value, cssResult);
  }

  return undefined;
}

async function resolveSignalSelection({
  platform,
  runId,
  signalKey,
  cssResult,
  storedProfile,
  gemini,
  onEvent,
  log,
  signal,
  safeMode,
  allowManualChoice = true,
  forceChoice = false,
  onUserWaitStart,
  onUserWaitEnd,
}: {
  platform: PlatformCatalogEntry;
  runId: string;
  signalKey: FinancialSignalKey;
  cssResult: ExtractSignalResult;
  /** Required so a remembered user choice can never be dropped by accident. */
  storedProfile: SelectorProfile | undefined;
  gemini?: GeminiChoiceValue | undefined;
  onEvent: (event: SyncEvent) => void;
  log: ReturnType<typeof createPlatformLogger>;
  signal?: AbortSignal | undefined;
  safeMode?: boolean;
  allowManualChoice?: boolean;
  forceChoice?: boolean;
  onUserWaitStart?: () => void;
  onUserWaitEnd?: () => void;
}): Promise<ExtractSignalResult> {
  const decision = resolveExtractionChoice({
    signalKey,
    candidates: cssResult.allCandidates,
    storedProfile,
    ...(gemini === undefined ? {} : { gemini }),
    ...(safeMode === undefined ? {} : { safeMode }),
    forceChoice,
  });

  if (decision.kind === "selected") {
    log(
      `${signalKey} selected`,
      `${decision.source}, value=${decision.value}`,
    );
    return resultFromCandidate(
      decision.candidate,
      decision.confidence,
      cssResult,
      decision.allCandidates,
      decision.warnings ?? [],
    );
  }

  if (decision.kind === "gemini_only") {
    log(`${signalKey} selected`, `gemini_only, value=${decision.value}`);
    return resultFromGeminiOnly(decision.value, cssResult);
  }

  if (decision.kind === "choice_required" && isChoiceSignal(signalKey)) {
    if (!allowManualChoice) {
      log(
        `${signalKey} choice skipped`,
        "Using best CSS candidate without manual selection",
        "warn",
      );
      return cssResult;
    }
    log(
      `${signalKey} choice required`,
      `${decision.candidates.length} candidates`,
      "warn",
    );
    let candidateId: string;
    onUserWaitStart?.();
    try {
      candidateId = await waitForExtractionChoice({
        platform,
        runId,
        signalKey,
        candidates: decision.candidates,
        onEvent,
        timeoutMs: EXTRACTION_CHOICE_WAIT_TIMEOUT_MS,
        signal,
      });
    } finally {
      onUserWaitEnd?.();
    }
    const selected = decision.candidates.find(
      (candidate) =>
        candidate.candidateId === candidateId ||
        candidate.fingerprint === candidateId ||
        candidate.selector === candidateId,
    );
    if (!selected) {
      throw new Error(`Selected candidate no longer exists for ${signalKey}`);
    }

    const fingerprint =
      selected.fingerprint ?? createCandidateFingerprint(signalKey, selected);
    if (selected.selector !== GEMINI_ONLY_SELECTOR) {
      await learnSelector({
        platformId: platform.id,
        signalKey,
        selector: selected.selector,
        fingerprint,
        confidence: 1,
        source: "user",
        learnedAt: new Date().toISOString(),
        lastVerifiedAt: new Date().toISOString(),
        failureCount: 0,
      });
      log(`${signalKey} user choice saved`, selected.selector);
    } else {
      log(`${signalKey} user choice used for this run`, selected.selector);
    }

    return resultFromCandidate(
      { ...selected, fingerprint, source: "stored" },
      1,
      cssResult,
      decision.allCandidates,
    );
  }

  return cssResult;
}

async function syncPlatform(
  runId: string,
  platform: PlatformCatalogEntry,
  globalStealthMode: boolean,
  debugMode: boolean,
  onEvent: (event: SyncEvent) => void,
  signal?: AbortSignal,
  getFetchedAt?: (platformId: PlatformId) => string,
  onUserWaitStart?: (platformId: PlatformId) => void,
  onUserWaitEnd?: (platformId: PlatformId) => void,
  allowManualAction = true,
  forceExtractionChoiceForSignals: readonly ExtractionChoiceSignalKey[] = [],
  showTwoFactorManualActionDialog = true,
): Promise<ConnectorSyncResult | { deferred: boolean; actionType: "2fa" | "captcha" } | null> {
  let tabId: number | undefined;
  let debugSignals: DebugSignalResult[] | undefined;
  let rawLoginHtml: string | undefined;
  let rawHtml: string | undefined;
  let loginVerified = false;
  const syncStartedAt = Date.now();
  const elapsed = () => Date.now() - syncStartedAt;
  const log = createPlatformLogger(platform.id, runId, debugMode, onEvent);
  const withCapturedHtml = <T extends object>(payload: T) => ({
    ...payload,
    ...(rawLoginHtml !== undefined ? { rawLoginHtml } : {}),
    ...(rawHtml !== undefined ? { rawHtml } : {}),
  });
  const credentialStorage = { getCredentials, saveCredentials };
  const finishLoginFailure = async (message: string): Promise<void> => {
    await updatePlatformProgress(runId, platform.id, "failed_login");
    if (!isDemoModeEnabled) {
      try {
        await recordStoredLoginFailure(
          platform.id,
          message,
          credentialStorage,
        );
      } catch (err) {
        log(
          "Login failure metadata persistence failed",
          getErrorMessage(err),
          "warn",
        );
      }
    }
    onEvent(
      withCapturedHtml({
        type: "platform_error",
        platformId: platform.id,
        runId,
        message,
        state: "failed_login",
      }),
    );
  };

  const platformTimeout = createTimeoutSignal(
    PLATFORM_SYNC_TIMEOUT_MS,
    "Platform sync timeout exceeded (4 minutes)",
  );
  signal = combineAbortSignals([signal, platformTimeout.signal]);
  const startUserWait = () => {
    platformTimeout.pause();
    onUserWaitStart?.(platform.id);
  };
  const endUserWait = () => {
    platformTimeout.resume();
    onUserWaitEnd?.(platform.id);
  };
  let removeAbortListener: (() => void) | undefined;
  let tabClosePromise: Promise<void> | undefined;

  const closeActiveTab = (): Promise<void> => {
    if (tabId === undefined) {
      return Promise.resolve();
    }
    tabClosePromise ??= closeTab(tabId);
    return tabClosePromise;
  };
  const closeAndThrowIfAborted = async (): Promise<void> => {
    if (!signal?.aborted) return;
    await closeActiveTab();
    throwIfAborted(signal);
  };

  if (signal) {
    const abort = () => {
      void closeActiveTab();
    };
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener("abort", abort, { once: true });
      removeAbortListener = () => {
        signal?.removeEventListener("abort", abort);
      };
    }
  }

  try {
    return await (async (): Promise<ConnectorSyncResult | null> => {
        onEvent({ type: "platform_start", platformId: platform.id, runId });
        await updatePlatformProgress(runId, platform.id, "running");
        log("Starting sync", platform.name);
        if (!isDemoModeEnabled) {
          try {
            await clearStoredLoginError(platform.id, credentialStorage);
          } catch (err) {
            log("Persisted login error clear failed", getErrorMessage(err), "warn");
          }
        }

    const demoCredentials = isDemoModeEnabled ? DEMO_CREDENTIALS : null;

    let executionModes: { safeMode: boolean; stealthMode: boolean };
    let storedCredentials: StoredCredentials | undefined;
    let encryptionKey: Awaited<ReturnType<typeof getEncryptionKey>> | undefined;

    if (demoCredentials) {
      executionModes = {
        safeMode: false,
        stealthMode: false,
      };
      log("Using demo credentials", "in-memory only");
    } else {
      log("Loading encrypted credentials");
      const encKey = await getEncryptionKey();
      if (!encKey) {
        log("Unlock required", "No encryption key available", "error");
        throw new Error("No encryption key — unlock required");
      }
      encryptionKey = encKey;

      const stored = await getCredentials(platform.id);
      if (!stored) {
        log("Credentials missing", platform.name, "error");
        throw new Error(`No credentials saved for ${platform.name}`);
      }
      storedCredentials = stored;

      executionModes = resolveExecutionModes(stored, platform, globalStealthMode);
      log("Encrypted credentials loaded");
    }
    if (signal) throwIfAborted(signal);
    const pageLoadTimeoutMs = resolveSafeModeTimeoutMs(
      PAGE_TIMEOUT_MS,
      executionModes.safeMode,
    );
    const loginTriggerNavTimeoutMs = resolveSafeModeTimeoutMs(
      LOGIN_TRIGGER_NAV_TIMEOUT_MS,
      executionModes.safeMode,
    );

    log("Opening tab", platform.login.entryUrl);
    const tab = await openTab(platform.login.entryUrl, executionModes.safeMode);
    tabId = tab.id!;
    await closeAndThrowIfAborted();
    log("Waiting for initial page load", `Tab ${tabId}`);
    await abortableOperation(waitForTabLoad(tabId, pageLoadTimeoutMs), signal);
    await closeAndThrowIfAborted();
    if (!executionModes.safeMode) {
      await hideTabWindow(tabId);
    }
    let tabInfo = await chrome.tabs.get(tabId);
    log("Initial page loaded", tabInfo.url ?? "unknown URL", "info", elapsed());

    await abortableDelay(POST_NAV_SETTLE_MS, signal);

    try {
      const readyResult = await sendToTabWithTimeout<WaitForReadyResponse>(
        tabId,
        {
          type: "WAIT_FOR_READY" as const,
          payload: { stableMs: 1200, maxWaitMs: 6000 },
        },
        TAB_MSG_TIMEOUT_MS,
      );
      log(
        "Initial page ready",
        `waitedMs=${readyResult.waitedMs}, domStable=${readyResult.domStable}, readyState=${readyResult.readyState}`,
      );
      await dismissOverlaysFromTab(tabId, log);
    } catch (err) {
      const errMsg = getErrorMessage(err);
      log(
        "Initial page readiness check failed (falling back to static wait)",
        errMsg,
        "warn",
      );
      await abortableDelay(POST_NAV_SETTLE_MS, signal);
    }

    const checkLoginMsg = {
      type: "CHECK_LOGIN" as const,
      payload: {
        postLoginIndicators: platform.login.postLoginIndicators,
        usernameSelectors: platform.login.usernameSelectors,
        passwordSelectors: platform.login.passwordSelectors,
        otpSelectors: platform.login.otpSelectors,
      },
    };

    onEvent({
      type: "platform_progress",
      platformId: platform.id,
      runId,
      message: "Checking login session…",
    });

    let alreadyLoggedIn = false;
    let sessionEvidence = false;
    try {
      const checkResult = await sendToTabWithTimeout<CheckLoginResponse>(
        tabId,
        checkLoginMsg,
        TAB_MSG_TIMEOUT_MS,
      );
      alreadyLoggedIn = checkResult.loggedIn;
      sessionEvidence = checkResult.sessionEvidence ?? false;
      log(
        "Initial CHECK_LOGIN response",
        `loggedIn=${checkResult.loggedIn}, url=${checkResult.url ?? "unknown"}, 2fa=${checkResult.requires2FA ?? false}, captcha=${checkResult.requiresCaptcha ?? false}, sessionEvidence=${sessionEvidence}`,
      );
    } catch (err) {
      const errMsg = getErrorMessage(err);
      log("Initial CHECK_LOGIN failed (continuing with LOGIN)", errMsg, "warn");
    }

    // Captured before any session-recovery navigation so the debug artifact
    // really is the login page.
    if (debugMode) {
      try {
        rawLoginHtml = await capturePageHtml(tabId, log);
      } catch (err) {
        log(
          "Login page HTML capture failed",
          getErrorMessage(err),
          "warn",
        );
      }
    }

    // Some platforms keep serving the login page with the full signed-in header
    // while the session cookie is still valid (e.g. Debitum). Submitting
    // credentials there fails, so navigate into the authenticated area first and
    // re-check before touching credentials.
    if (!alreadyLoggedIn && sessionEvidence && tabId !== undefined) {
      const recoveryTabId = tabId;
      log("Existing session detected on login page — attempting recovery navigation");
      onEvent({
        type: "platform_progress",
        platformId: platform.id,
        runId,
        message: "Existing session detected — opening overview…",
      });

      const visited = new Set<string>();
      const initialHref = await readCurrentTabHref(recoveryTabId);
      if (initialHref) visited.add(initialHref);

      const recoveryStrategies: DashboardNavStrategy[] = [
        "keywords",
        "logo",
        "first-nav",
      ];

      for (const strategy of recoveryStrategies) {
        if (signal) throwIfAborted(signal);

        const linkResult = await clickDashboardLinkInTab(
          recoveryTabId,
          log,
          strategy,
          Array.from(visited),
        );
        if (!linkResult?.clicked) continue;

        try {
          const readyResult = await sendToTabWithTimeout<WaitForReadyResponse>(
            recoveryTabId,
            {
              type: "WAIT_FOR_READY" as const,
              payload: { stableMs: 1200, maxWaitMs: 6000 },
            },
            TAB_MSG_TIMEOUT_MS,
          );
          log(
            "Session recovery page ready",
            `strategy=${strategy}, waitedMs=${readyResult.waitedMs}, readyState=${readyResult.readyState}`,
          );
        } catch (err) {
          log(
            "Session recovery readiness check failed (falling back to static wait)",
            getErrorMessage(err),
            "warn",
          );
          await abortableDelay(POST_NAV_SETTLE_MS, signal);
        }
        await dismissOverlaysFromTab(recoveryTabId, log);

        const currentHref = await readCurrentTabHref(recoveryTabId);
        if (currentHref) visited.add(currentHref);

        try {
          const recheck = await sendToTabWithTimeout<CheckLoginResponse>(
            recoveryTabId,
            checkLoginMsg,
            TAB_MSG_TIMEOUT_MS,
          );
          log(
            "Session recovery CHECK_LOGIN response",
            `strategy=${strategy}, loggedIn=${recheck.loggedIn}, url=${recheck.url ?? "unknown"}`,
          );
          if (recheck.loggedIn) {
            alreadyLoggedIn = true;
            log("Session recovery succeeded — skipping login");
            break;
          }
        } catch (err) {
          log(
            "Session recovery CHECK_LOGIN failed",
            getErrorMessage(err),
            "warn",
          );
        }
      }

      if (!alreadyLoggedIn) {
        log(
          "Session recovery navigation did not reach an authenticated page — falling back to normal login",
          undefined,
          "warn",
        );
      }
    }

    let cachedLoginSelectors: LoginSelectorMap | undefined;
    if (!alreadyLoggedIn) {
      try {
        cachedLoginSelectors = loginProfilesToSelectorMap(
          await getLoginSelectorProfiles(platform.id),
        );
        if (cachedLoginSelectors) {
          log("Loaded cached login selectors");
        }
      } catch (err) {
        log(
          "Failed to load cached login selectors",
          getErrorMessage(err),
          "warn",
        );
      }
    }

    let latestLoginResult: LoginResponse | undefined;
    if (!alreadyLoggedIn) {
      if (signal) throwIfAborted(signal);
      onEvent({
        type: "platform_progress",
        platformId: platform.id,
        runId,
        message: "Logging in…",
      });
      log("Logging in");
      if (tabId === undefined) {
        throw new Error("Missing sync tab before login");
      }
      const activeTabId = tabId;

      const logLoginResult = (loginResult: LoginResponse): void => {
        log(
          "LOGIN response",
          `success=${loginResult.success}, submitted=${loginResult.submitted ?? false}, loginTriggerClicked=${loginResult.loginTriggerClicked ?? false}, error=${loginResult.error ?? "none"}`,
        );

        if (loginResult.foundElements) {
          for (const [role, elDesc] of Object.entries(loginResult.foundElements)) {
            if (elDesc && typeof elDesc === "string") {
              log(`Used login field: ${role}`, elDesc);
            }
          }
        }
      };

      const sendLoginAttempt = async (): Promise<LoginResponse> => {
        log(
          "Sending LOGIN to content script",
          `tabId=${activeTabId}, url=${tabInfo.url ?? "unknown"}`,
        );
        let loginUsername = demoCredentials?.username ?? "";
        let loginPassword = demoCredentials?.password ?? "";
        let loginMsg: LoginMessage | undefined;
        try {
          if (!demoCredentials) {
            if (!encryptionKey || !storedCredentials) {
              throw new Error("Encrypted credentials unavailable");
            }
            loginUsername = await decrypt(
              encryptionKey,
              storedCredentials.encryptedUsername,
              credentialAad(platform.id, "username"),
            );
            loginPassword = await decrypt(
              encryptionKey,
              storedCredentials.encryptedPassword,
              credentialAad(platform.id, "password"),
            );
            log("Credentials decrypted for login attempt");
          }
          loginMsg = {
            type: "LOGIN",
            payload: {
              username: loginUsername,
              password: loginPassword,
              usernameSelectors: platform.login.usernameSelectors,
              passwordSelectors: platform.login.passwordSelectors,
              submitSelectors: platform.login.submitSelectors,
              otpSelectors: platform.login.otpSelectors,
              ...(cachedLoginSelectors ? { cachedLoginSelectors } : {}),
              postLoginIndicators: platform.login.postLoginIndicators,
              stealthMode: executionModes.stealthMode,
              safeMode: executionModes.safeMode,
            },
          };
          const loginResult = await sendToTabWithTimeout<LoginResponse>(
            activeTabId,
            loginMsg,
            resolveLoginMessageTimeoutMs(
              PAGE_TIMEOUT_MS,
              executionModes.stealthMode,
              loginUsername,
              loginPassword,
            ),
            undefined,
            signal,
          );
          logLoginResult(loginResult);
          return loginResult;
        } catch (err) {
          const errMsg = getErrorMessage(err);
          const isConnectionError =
            errMsg.includes("Content script not reachable") ||
            errMsg.includes("Could not establish connection");
          log(
            isConnectionError
              ? "LOGIN: content script disconnected (expected after form submit navigation)"
              : "LOGIN: unexpected error",
            errMsg,
            isConnectionError ? "warn" : "error",
            elapsed(),
          );
          const fallbackResult: LoginResponse = isConnectionError
            ? { success: false, submitted: true }
            : { success: false, submitted: false, error: errMsg };
          logLoginResult(fallbackResult);
          return fallbackResult;
        } finally {
          // eslint-disable-next-line no-useless-assignment -- Intentionally clear sensitive credential references after use.
          loginUsername = "";
          // eslint-disable-next-line no-useless-assignment -- Intentionally clear sensitive credential references after use.
          loginPassword = "";
          if (loginMsg) {
            loginMsg.payload.username = "";
            loginMsg.payload.password = "";
          }
        }
      };

      const settleAfterLoginTrigger = async (): Promise<void> => {
        onEvent({
          type: "platform_progress",
          platformId: platform.id,
          runId,
          message: "Opening login page…",
        });
        log("Login trigger clicked — waiting for login page");

        try {
          await abortableOperation(
            waitForTabLoad(activeTabId, loginTriggerNavTimeoutMs),
            signal,
          );
          log("Login page loaded after trigger");
        } catch {
          log("Login trigger navigation wait timed out", undefined, "warn");
        }

        await abortableDelay(POST_NAV_SETTLE_MS, signal);

        try {
          const readyResult = await sendToTabWithTimeout<WaitForReadyResponse>(
            activeTabId,
            {
              type: "WAIT_FOR_READY" as const,
              payload: { stableMs: 800, maxWaitMs: 4000 },
            },
            TAB_MSG_TIMEOUT_MS,
          );
          log(
            "Login page ready after trigger",
            `waitedMs=${readyResult.waitedMs}, domStable=${readyResult.domStable}, readyState=${readyResult.readyState}`,
          );
          await dismissOverlaysFromTab(activeTabId, log);
        } catch (err) {
          log(
            "Login page readiness after trigger failed",
            getErrorMessage(err),
            "warn",
          );
        }

        tabInfo = await chrome.tabs.get(activeTabId);
      };

      // Phase 1: Submit login form, or first open a landing-page login view.
      const runLoginPhase1 = async (): Promise<LoginResponse> => {
        let result = await sendLoginAttempt();
        if (result.loginTriggerClicked) {
          await settleAfterLoginTrigger();
          result = await sendLoginAttempt();

          if (result.loginTriggerClicked) {
            result = {
              ...result,
              loginTriggerClicked: false,
              error:
                result.error ??
                "Login form fields not found after opening login page",
            };
          }
        }
        return result;
      };

      let loginResult = await runLoginPhase1();

      // One transient-failure retry: if the login form never appeared (SPA
      // still rendering, overlay covering fields, A/B variant), reload once and
      // try again before giving up. Skip when the form WAS submitted or a
      // 2FA/captcha challenge is pending — those are handled below.
      if (
        !loginResult.success &&
        !loginResult.submitted &&
        !loginResult.requires2FA &&
        !loginResult.requiresCaptcha
      ) {
        log(
          "Login form not found — reloading tab for one retry",
          loginResult.error ?? "unknown",
          "warn",
        );
        onEvent({
          type: "platform_progress",
          platformId: platform.id,
          runId,
          message: "Retrying login…",
        });
        try {
          await chrome.tabs.reload(activeTabId);
          await abortableOperation(
            waitForTabLoad(activeTabId, pageLoadTimeoutMs),
            signal,
          );
          await abortableDelay(POST_NAV_SETTLE_MS, signal);
          try {
            const readyResult = await sendToTabWithTimeout<WaitForReadyResponse>(
              activeTabId,
              {
                type: "WAIT_FOR_READY" as const,
                payload: { stableMs: 800, maxWaitMs: 4000 },
              },
              TAB_MSG_TIMEOUT_MS,
            );
            log(
              "Login page ready after reload retry",
              `waitedMs=${readyResult.waitedMs}, domStable=${readyResult.domStable}`,
            );
          } catch (err) {
            log(
              "Readiness check after reload retry failed",
              getErrorMessage(err),
              "warn",
            );
          }
          await dismissOverlaysFromTab(activeTabId, log);
          tabInfo = await chrome.tabs.get(activeTabId);
          loginResult = await runLoginPhase1();
        } catch (err) {
          if (err instanceof CancelledError) throw err;
          log("Login reload retry failed", getErrorMessage(err), "warn");
        }
      }

      latestLoginResult = loginResult;

      let twoFaSolved = false;
      let captchaSolved = false;
      const waitForManualActionWithHooks = async (
        actionType: "captcha" | "2fa",
      ): Promise<boolean> => {
        startUserWait();
        try {
          const solved = await waitForManualAction({
            tabId: tabId!,
            platform,
            runId,
            log,
            onEvent,
            actionType,
            showDashboardPrompt:
              actionType !== "2fa" || showTwoFactorManualActionDialog,
            signal,
            timeoutMs: MANUAL_ACTION_WAIT_TIMEOUT_MS,
            pollMs: MANUAL_ACTION_POLL_MS,
          });
          return solved;
        } finally {
          endUserWait();
        }
      };
      const hideAfterManualActionIfNeeded = async (): Promise<void> => {
        if (!executionModes.safeMode && tabId !== undefined) {
          await hideTabWindow(tabId);
        }
      };
      if (!loginResult.success && !loginResult.submitted) {
        if (loginResult.requires2FA) {
          log("2FA required", undefined, "warn");
          if (!allowManualAction) {
            throw new DeferredActionError("2fa");
          }
          const solved = await waitForManualActionWithHooks("2fa");
          if (!solved) {
            await updatePlatformProgress(runId, platform.id, "failed_2fa");
            onEvent(withCapturedHtml({
              type: "platform_error",
              platformId: platform.id,
              runId,
              message: "2FA not solved in time",
              state: "failed_2fa",
            }));
            return null;
          }
          twoFaSolved = true;
          // Wait for any post-2FA navigation
          try {
            await abortableOperation(waitForTabLoad(tabId!, pageLoadTimeoutMs), signal);
          } catch {
            /* may already be loaded */
          }
          await abortableDelay(POST_NAV_SETTLE_MS, signal);
          await hideAfterManualActionIfNeeded();
        } else if (loginResult.requiresCaptcha) {
          log("Captcha detected before login", undefined, "warn");
          if (!allowManualAction) {
            throw new DeferredActionError("captcha");
          }
          const solved = await waitForManualActionWithHooks("captcha");
          if (!solved) {
            await updatePlatformProgress(runId, platform.id, "failed_captcha");
            onEvent(withCapturedHtml({
              type: "platform_error",
              platformId: platform.id,
              runId,
              message: "Captcha not solved in time",
              state: "failed_captcha",
            }));
            return null;
          }
          captchaSolved = true;
          // Wait for any post-captcha navigation
          try {
            await abortableOperation(waitForTabLoad(tabId!, pageLoadTimeoutMs), signal);
          } catch {
            /* may already be loaded */
          }
          await abortableDelay(POST_NAV_SETTLE_MS, signal);
          await hideAfterManualActionIfNeeded();
        }
        if (!captchaSolved && !twoFaSolved) {
          log(
            "Login failed",
            loginResult.error ?? "Unknown login error",
            "error",
          );
          await markUsedLoginSelectorFailures(
            platform.id,
            latestLoginResult,
            log,
          );
          await finishLoginFailure(loginResult.error ?? "Login failed");
          return null;
        }
      }

      // Phase 2: Verify login after navigation
      if (loginResult.success || captchaSolved || twoFaSolved) {
        loginVerified = true;
        log(
          captchaSolved || twoFaSolved
            ? "Captcha/2FA solved — skipping verification"
            : "Already logged in — skipping verification",
        );
      } else {
        // Form was submitted — wait for post-login navigation
        log("Form submitted — waiting for navigation");
        onEvent({
          type: "platform_progress",
          platformId: platform.id,
          runId,
          message: "Waiting for login redirect…",
        });

        try {
          await abortableOperation(waitForTabLoad(tabId, pageLoadTimeoutMs), signal);
          log("Post-login page loaded");
        } catch {
          log("Post-login page load timeout", undefined, "warn");
        }

        // Give the page time to settle (SPAs may need extra time after load event)
        await abortableDelay(POST_NAV_SETTLE_MS, signal);
        log("Post-navigation settle complete", `${POST_NAV_SETTLE_MS}ms`);

        // Poll CHECK_LOGIN on the new page's content script
        const postSubmissionCheckLoginMsg = {
          type: "CHECK_LOGIN" as const,
          payload: {
            postLoginIndicators: platform.login.postLoginIndicators,
            usernameSelectors: platform.login.usernameSelectors,
            passwordSelectors: platform.login.passwordSelectors,
            otpSelectors: platform.login.otpSelectors,
            afterSubmission: true,
            entryUrl: platform.login.entryUrl,
          },
        };
        const verifyDeadline = Date.now() + LOGIN_VERIFY_TIMEOUT_MS;
        let verified = false;

        while (Date.now() < verifyDeadline) {
          if (signal) throwIfAborted(signal);
          try {
            const checkResult = await sendToTabWithTimeout<CheckLoginResponse>(
              tabId,
              postSubmissionCheckLoginMsg,
              TAB_MSG_TIMEOUT_MS,
            );
            log(
              "CHECK_LOGIN response",
              `loggedIn=${checkResult.loggedIn}, url=${checkResult.url ?? "unknown"}, 2fa=${checkResult.requires2FA ?? false}, captcha=${checkResult.requiresCaptcha ?? false}`,
            );

            if (checkResult.loggedIn) {
              log(
                "Login verified on post-login page",
                checkResult.url ?? "unknown URL",
              );
              loginVerified = true;
              verified = true;
              break;
            }
            if (checkResult.requires2FA) {
              log("2FA required after login", undefined, "warn");
              if (!allowManualAction) {
                throw new DeferredActionError("2fa");
              }
              const solved = await waitForManualActionWithHooks("2fa");
              if (!solved) {
                await updatePlatformProgress(
                  runId,
                  platform.id,
                  "failed_2fa",
                );
                onEvent(withCapturedHtml({
                  type: "platform_error",
                  platformId: platform.id,
                  runId,
                  message: "2FA not solved in time",
                  state: "failed_2fa",
                }));
                return null;
              }
              log("2FA solved — login confirmed after navigation");
              loginVerified = true;
              verified = true;
              break;
            }
            if (checkResult.requiresCaptcha) {
              log("Captcha detected after login submit", undefined, "warn");
              if (!allowManualAction) {
                throw new DeferredActionError("captcha");
              }
              const solved = await waitForManualActionWithHooks("captcha");
              if (!solved) {
                await updatePlatformProgress(
                  runId,
                  platform.id,
                  "failed_captcha",
                );
                onEvent(withCapturedHtml({
                  type: "platform_error",
                  platformId: platform.id,
                  runId,
                  message: "Captcha not solved in time",
                  state: "failed_captcha",
                }));
                return null;
              }
              log("Captcha solved — login confirmed after navigation");
              loginVerified = true;
              verified = true;
              break;
            }
            if (checkResult.credentialError) {
              log(
                "Login rejected — invalid credentials banner detected",
                undefined,
                "error",
              );
              await markUsedLoginSelectorFailures(
                platform.id,
                latestLoginResult,
                log,
              );
              await finishLoginFailure("Login rejected — invalid credentials");
              return null;
            }
          } catch (err) {
            if (err instanceof DeferredActionError || err instanceof CancelledError) {
              throw err;
            }
            const errMsg = getErrorMessage(err);
            log("CHECK_LOGIN failed (retrying)", errMsg, "warn");
          }

          await abortableDelay(LOGIN_VERIFY_POLL_MS, signal);
        }

        if (!verified) {
          log(
            "Login verification failed",
            "Could not confirm post-login state after navigation",
            "error",
          );
          await markUsedLoginSelectorFailures(
            platform.id,
            latestLoginResult,
            log,
          );
          await finishLoginFailure(
            "Login verification timeout — could not confirm post-login state",
          );
          return null;
        }

        log("Login verified on post-login page", undefined, "info", elapsed());
      }

      await learnVerifiedLoginSelectors(platform.id, latestLoginResult, log);
    } else {
      loginVerified = true;
      log("Existing login session detected");
    }

    log("Login successful", undefined, "info", elapsed());
    if (!isDemoModeEnabled) {
      try {
        await resetStoredLoginFailureCount(platform.id, credentialStorage);
      } catch (err) {
        log("Login failure counter reset failed", getErrorMessage(err), "warn");
      }
    }
    if (signal) throwIfAborted(signal);
    log("Waiting for dashboard render + DOM stability");
    try {
      const readyResult = await sendToTabWithTimeout<WaitForReadyResponse>(
        tabId,
        {
          type: "WAIT_FOR_READY" as const,
          payload: { stableMs: 1000, maxWaitMs: 8000 },
        },
        TAB_MSG_TIMEOUT_MS,
      );
      log(
        "Page ready",
        `waitedMs=${readyResult.waitedMs}, domStable=${readyResult.domStable}, readyState=${readyResult.readyState}`,
        "info",
        elapsed(),
      );
      await dismissOverlaysFromTab(tabId, log);
    } catch (err) {
      const errMsg = getErrorMessage(err);
      log(
        "Page readiness check failed (falling back to static wait)",
        errMsg,
        "warn",
      );
      await abortableDelay(POST_NAV_SETTLE_MS, signal);
    }

    // Go straight to the page that worked last time. Platforms redirect to all
    // sorts of landing pages after login; if we already know where the account
    // totals live, walking the navigation again is wasted effort. On any
    // failure we simply stay put — the navigation ladder is the safety net.
    let navigatedViaStoredUrl = false;
    if (!isDemoModeEnabled) {
      try {
        const navProfile = await getNavigationProfile(platform.id);
        const targetUrl = navProfile
          ? resolvePlatformUrl(navProfile.url, platform)
          : null;
        const currentHref = targetUrl ? await readCurrentTabHref(tabId) : null;
        if (targetUrl && targetUrl !== currentHref) {
          log("Navigating to learned overview page", targetUrl);
          await abortableOperation(
            navigateTabToUrl(tabId, targetUrl, pageLoadTimeoutMs),
            signal,
          );
          await abortableDelay(POST_NAV_SETTLE_MS, signal);
          await sendToTabWithTimeout<WaitForReadyResponse>(
            tabId,
            {
              type: "WAIT_FOR_READY" as const,
              payload: { stableMs: 1000, maxWaitMs: 8000 },
            },
            TAB_MSG_TIMEOUT_MS,
          );
          await dismissOverlaysFromTab(tabId, log);
          navigatedViaStoredUrl = true;
        }
      } catch (err) {
        if (err instanceof CancelledError) throw err;
        // Count this against the stored page too. A URL that cannot even be
        // loaded (dead domain, navigation timeout) would otherwise never reach
        // the ladder's failure check and would cost a timeout on every sync.
        try {
          await markNavigationFailure(platform.id);
        } catch {
          // Best effort — never fail a sync over bookkeeping.
        }
        log(
          "Could not reach learned overview page",
          getErrorMessage(err),
          "warn",
        );
      }
    }

    if (debugMode) {
      rawHtml = await capturePageHtml(tabId, log);
    }

    if (signal) throwIfAborted(signal);
    onEvent({
      type: "platform_progress",
      platformId: platform.id,
      runId,
      message: "Extracting data…",
    });
    log("Extracting data", `tabId=${tabId}`);

    const selectorProfiles = await getSelectorProfiles(platform.id);
    const forcedChoiceSignals = new Set(forceExtractionChoiceForSignals);
    const isForcedChoiceSignal = (signalKey: ExtractionChoiceSignalKey) =>
      forcedChoiceSignals.has(signalKey);
    const storedPortfolioProfile = profileForSignal(
      selectorProfiles,
      "portfolio_value",
    );
    const storedFreeCashProfile = profileForSignal(selectorProfiles, "free_cash");
    const extractionFastPathTabId = tabId;
    if (extractionFastPathTabId === undefined) {
      throw new Error("Missing active tab for extraction");
    }
    const staleStoredFastPathSignals = new Set<ExtractionChoiceSignalKey>();
    // Retry paths clear `staleStoredFastPathSignals`, so without this guard a
    // single run could raise failureCount several times and bury the profile.
    const markedFailureSignals = new Set<ExtractionChoiceSignalKey>();
    const markStoredSelectorFailureOnce = async (
      signalKey: ExtractionChoiceSignalKey,
    ): Promise<void> => {
      if (markedFailureSignals.has(signalKey)) return;
      markedFailureSignals.add(signalKey);
      await markSelectorFailure(platform.id, signalKey);
    };
    const extractSignalWithStoredFastPath = async (
      signalKey: ExtractionChoiceSignalKey,
      storedProfile: SelectorProfile | undefined,
      freshForNextExtract: () => boolean,
      fallback: (fresh: boolean) => Promise<ExtractSignalResult>,
    ): Promise<ExtractSignalResult> => {
      if (isForcedChoiceSignal(signalKey)) {
        log(
          `${signalKey} stored selector fast-path skipped`,
          "Manual value selection forced",
        );
        return fallback(freshForNextExtract());
      }
      if (storedProfile && !staleStoredFastPathSignals.has(signalKey)) {
        if (
          storedProfile.source === "auto" &&
          storedProfile.confidence < AUTO_SELECTOR_FAST_PATH_CONFIDENCE
        ) {
          log(
            `${signalKey} stored selector fast-path skipped`,
            `auto confidence=${storedProfile.confidence.toFixed(2)}`,
          );
          staleStoredFastPathSignals.add(signalKey);
        } else {
          const fastPathFresh = freshForNextExtract();
          const storedResult = await tryStoredSelectorFastPath({
            tabId: extractionFastPathTabId,
            platform,
            signalKey,
            storedProfile,
            fresh: fastPathFresh,
            log,
            markFailure: markStoredSelectorFailureOnce,
          });
          if (storedResult.kind === "selected") return storedResult.result;
          staleStoredFastPathSignals.add(signalKey);
          if (storedResult.kind === "request_failed") {
            return fallback(fastPathFresh);
          }
        }
      }
      return fallback(freshForNextExtract());
    };

    // Step 1: Poll default DOM candidates until the SPA has rendered stable values.
    log("Polling CSS signals", "Waiting for stable non-placeholder values");
    let preCssPortfolio: ExtractSignalResult = { value: null, confidence: 0, allCandidates: [], elementsScanned: 0 };
    let preCssFreeCash: ExtractSignalResult = { value: null, confidence: 0, allCandidates: [], elementsScanned: 0 };
    let extractionPollCount = 0;
    let verifierWarnings: string[] = [];
    let history: StoredMetricsSnapshot[] = [];
    /** URL the accepted extraction came from — learned for the next sync. */
    let extractionPageHref: string | null = null;
    try {
      const extractionTabId = tabId;
      history = await getMetricsHistory(platform.id, 5);
      let verified = await runConvergentExtraction({
        history,
        ...(signal === undefined ? {} : { signal }),
        extract: async () => {
          let freshUsed = false;
          const freshForNextExtract = () => {
            if (freshUsed) return false;
            freshUsed = true;
            return true;
          };
          return {
            portfolio_value: await extractSignalWithStoredFastPath(
              "portfolio_value",
              storedPortfolioProfile,
              freshForNextExtract,
              (fresh) =>
                extractSignalFromTab(extractionTabId, platform, "portfolio_value", {
                  ...(fresh ? { fresh: true } : {}),
                }),
            ),
            free_cash: await extractSignalWithStoredFastPath(
              "free_cash",
              storedFreeCashProfile,
              freshForNextExtract,
              (fresh) =>
                extractSignalFromTab(extractionTabId, platform, "free_cash", {
                  ...(fresh ? { fresh: true } : {}),
                }),
            ),
          };
        },
      });
      if (!verified.converged && verified.warnings.includes("placeholder_zero")) {
        log(
          "Reloading dashboard after placeholder extraction",
          verified.warnings.join(", "),
          "warn",
        );
        if (signal) throwIfAborted(signal);
        await chrome.tabs.reload(extractionTabId);
        await abortableOperation(
          waitForTabLoad(extractionTabId, pageLoadTimeoutMs),
          signal,
        );
        if (signal) throwIfAborted(signal);
        try {
          const readyResult = await sendToTabWithTimeout<WaitForReadyResponse>(
            extractionTabId,
            {
              type: "WAIT_FOR_READY" as const,
              payload: { stableMs: 1000, maxWaitMs: 8000 },
            },
            TAB_MSG_TIMEOUT_MS,
          );
          log(
            "Reloaded dashboard ready",
            `waitedMs=${readyResult.waitedMs}, domStable=${readyResult.domStable}, readyState=${readyResult.readyState}`,
            "info",
            elapsed(),
          );
          await dismissOverlaysFromTab(extractionTabId, log);
        } catch (err) {
          const errMsg = getErrorMessage(err);
          log(
            "Reloaded dashboard readiness check failed",
            errMsg,
            "warn",
          );
        }
        staleStoredFastPathSignals.clear();
        const retry = await runConvergentExtraction({
          history,
          ...(signal === undefined ? {} : { signal }),
          extract: async () => {
            let freshUsed = false;
            const freshForNextExtract = () => {
              if (freshUsed) return false;
              freshUsed = true;
              return true;
            };
            return {
              portfolio_value: await extractSignalWithStoredFastPath(
                "portfolio_value",
                storedPortfolioProfile,
                freshForNextExtract,
                (fresh) =>
                  extractSignalFromTab(extractionTabId, platform, "portfolio_value", {
                    ...(fresh ? { fresh: true } : {}),
                  }),
              ),
              free_cash: await extractSignalWithStoredFastPath(
                "free_cash",
                storedFreeCashProfile,
                freshForNextExtract,
                (fresh) =>
                  extractSignalFromTab(extractionTabId, platform, "free_cash", {
                    ...(fresh ? { fresh: true } : {}),
                  }),
              ),
            };
          },
        });
        verified = {
          ...retry,
          pollCount: verified.pollCount + retry.pollCount,
        };
      }

      // The portfolio value has no real evidence behind it — either the page
      // carries no numbers at all, or it carries unlabelled ones (a positions
      // list scores ~2.4 purely from being currency). Either way the redirect
      // probably did not land on the account overview: walk the navigation and
      // keep the best page we find.
      if (!isWellEvidenced(verified.portfolio)) {
        // We went to the stored page and still have to go hunting, so that page
        // is no longer where the values live. Recorded here rather than at the
        // end of the run because a run that fails extraction outright never
        // reaches the end — and that is exactly when a stale URL is to blame.
        if (navigatedViaStoredUrl) {
          try {
            await markNavigationFailure(platform.id);
            log(
              "Learned overview page did not yield values",
              "Marked as failing",
              "warn",
            );
          } catch (err) {
            log(
              "Could not mark overview page as failing",
              getErrorMessage(err),
              "warn",
            );
          }
        }
        log(
          "No well-evidenced portfolio value on current page",
          alreadyLoggedIn
            ? "Trying dashboard navigation fallback (existing session)"
            : "Trying dashboard navigation fallback (fresh login)",
          "warn",
        );

        const settleAndReextract = async () => {
          if (signal) throwIfAborted(signal);
          try {
            await abortableOperation(
              waitForTabLoad(extractionTabId, pageLoadTimeoutMs),
              signal,
            );
          } catch (err) {
            log(
              "No full page load after dashboard link click (SPA navigation?)",
              getErrorMessage(err),
              "warn",
            );
          }
          await abortableDelay(POST_NAV_SETTLE_MS, signal);
          try {
            const readyResult = await sendToTabWithTimeout<WaitForReadyResponse>(
              extractionTabId,
              {
                type: "WAIT_FOR_READY" as const,
                payload: { stableMs: 1000, maxWaitMs: 8000 },
              },
              TAB_MSG_TIMEOUT_MS,
            );
            log(
              "Dashboard link target ready",
              `waitedMs=${readyResult.waitedMs}, domStable=${readyResult.domStable}, readyState=${readyResult.readyState}`,
              "info",
              elapsed(),
            );
            await dismissOverlaysFromTab(extractionTabId, log);
          } catch (err) {
            log(
              "Dashboard link target readiness check failed",
              getErrorMessage(err),
              "warn",
            );
          }
          if (signal) throwIfAborted(signal);
          staleStoredFastPathSignals.clear();
          return runConvergentExtraction({
            history,
            ...(signal === undefined ? {} : { signal }),
            extract: async () => {
              let freshUsed = false;
              const freshForNextExtract = () => {
                if (freshUsed) return false;
                freshUsed = true;
                return true;
              };
              return {
                portfolio_value: await extractSignalWithStoredFastPath(
                  "portfolio_value",
                  storedPortfolioProfile,
                  freshForNextExtract,
                  (fresh) =>
                    extractSignalFromTab(
                      extractionTabId,
                      platform,
                      "portfolio_value",
                      {
                        ...(fresh ? { fresh: true } : {}),
                      },
                    ),
                ),
                free_cash: await extractSignalWithStoredFastPath(
                  "free_cash",
                  storedFreeCashProfile,
                  freshForNextExtract,
                  (fresh) =>
                    extractSignalFromTab(extractionTabId, platform, "free_cash", {
                      ...(fresh ? { fresh: true } : {}),
                    }),
                ),
              };
            },
          });
        };

        // The repeated "keywords" leg is deliberate: `visited` grows after every
        // attempt and is passed as excludeHrefs, so the second run picks the
        // next-best keyword link instead of the same one.
        const strategies: DashboardNavStrategy[] = [
          "keywords",
          "keywords",
          "logo",
          "first-nav",
        ];
        const visited = new Set<string>();
        const initialHref = await readCurrentTabHref(extractionTabId);
        if (initialHref) visited.add(initialHref);
        let totalPollCount = verified.pollCount;

        const pages: Array<{
          href: string | null;
          result: ConvergentExtractionResult;
          quality: number;
        }> = [
          {
            href: initialHref,
            result: verified,
            quality: pageQualityScore({
              portfolio: verified.portfolio,
              freeCash: verified.freeCash,
              warnings: verified.warnings,
            }),
          },
        ];

        const ladderStartedAt = Date.now();

        for (const strategy of strategies) {
          if (Date.now() - ladderStartedAt > NAV_LADDER_MAX_MS) {
            log(
              "Dashboard navigation budget exhausted",
              `Skipping remaining strategies after ${NAV_LADDER_MAX_MS}ms`,
              "warn",
            );
            break;
          }

          const linkResult = await clickDashboardLinkInTab(
            extractionTabId,
            log,
            strategy,
            Array.from(visited),
          );
          if (!linkResult?.clicked) continue;

          // Exclude the link's own href immediately — an SPA redirect can leave
          // the tab on a different URL and let the same link be clicked again.
          const clickedHref = normalizeVisitedHref(linkResult.href);
          if (clickedHref) visited.add(clickedHref);

          onEvent({
            type: "platform_progress",
            platformId: platform.id,
            runId,
            message: "Opening overview page…",
          });

          const linkRetry = await settleAndReextract();
          totalPollCount += linkRetry.pollCount;

          const currentHref = await readCurrentTabHref(extractionTabId);
          if (currentHref) visited.add(currentHref);

          pages.push({
            href: currentHref ?? clickedHref,
            result: linkRetry,
            quality: pageQualityScore({
              portfolio: linkRetry.portfolio,
              freeCash: linkRetry.freeCash,
              warnings: linkRetry.warnings,
            }),
          });

          if (isWellEvidenced(linkRetry.portfolio)) break;
        }

        let best = pages[0]!;
        for (const page of pages) {
          // Strict >: ties keep the earlier page, which is the one we were
          // redirected to and therefore the platform's own idea of "home".
          if (page.quality > best.quality) best = page;
        }

        verified = { ...best.result, pollCount: totalPollCount };
        extractionPageHref = best.href ?? initialHref;

        if (pages.length > 1) {
          log(
            "Dashboard navigation ladder finished",
            `visited=${pages.length} pages, best=${best.href ?? "unknown"} (quality ${best.quality.toFixed(2)})`,
          );
        }

        // Later stages (Gemini text tree, the choice modal's candidates) read
        // the tab as it is now, so the winning page has to be the live one.
        const liveHref = await readCurrentTabHref(extractionTabId);
        if (best.href && liveHref && best.href !== liveHref) {
          try {
            await abortableOperation(
              navigateTabToUrl(extractionTabId, best.href, pageLoadTimeoutMs),
              signal,
            );
            await abortableDelay(POST_NAV_SETTLE_MS, signal);
            await sendToTabWithTimeout<WaitForReadyResponse>(
              extractionTabId,
              {
                type: "WAIT_FOR_READY" as const,
                payload: { stableMs: 1000, maxWaitMs: 8000 },
              },
              TAB_MSG_TIMEOUT_MS,
            );
            await dismissOverlaysFromTab(extractionTabId, log);
            log("Returned to best extraction page", best.href);
          } catch (err) {
            log(
              "Could not return to best extraction page",
              getErrorMessage(err),
              "warn",
            );
          }
        }
      }
      extractionPageHref ??= await readCurrentTabHref(extractionTabId);
      preCssPortfolio = verified.portfolio;
      preCssFreeCash = verified.freeCash;
      extractionPollCount = verified.pollCount;
      verifierWarnings = verified.warnings;
      if (!verified.converged) {
        log(
          "CSS signal convergence incomplete",
          verifierWarnings.join(", ") || "No stable value within budget",
          "warn",
        );
      }
    } catch (err) {
      if (err instanceof CancelledError || err instanceof TimeoutError) {
        throw err;
      }
      if (signal?.aborted) {
        throwIfAborted(signal);
      }
      log("Failed to poll CSS signals", String(err), "warn");
    }

    await recordExtractionTelemetry({
      platformId: platform.id,
      runId,
      signalKey: "portfolio_value",
      stage: "css",
      outcome: preCssPortfolio.value === null ? "missing" : "auto_selected",
      result: preCssPortfolio,
      pollCount: extractionPollCount,
      warnings: verifierWarnings,
    });
    await recordExtractionTelemetry({
      platformId: platform.id,
      runId,
      signalKey: "free_cash",
      stage: "css",
      outcome: preCssFreeCash.value === null ? "missing" : "auto_selected",
      result: preCssFreeCash,
      pollCount: extractionPollCount,
      warnings: verifierWarnings,
    });

    if (debugMode) {
      debugSignals = [
        buildDebugSignal(
          "portfolio_value",
          signalSelectors(platform, "portfolio_value"),
          preCssPortfolio,
        ),
        buildDebugSignal(
          "free_cash",
          signalSelectors(platform, "free_cash"),
          preCssFreeCash,
        ),
      ];
    }

    // A stored-selector fast-path hit is already the user's remembered choice —
    // re-running the heuristics on its single candidate would discard it and
    // re-prompt (safe mode blocks auto-select entirely).
    const acceptStoredFastPathResult = (
      signalKey: ExtractionChoiceSignalKey,
      result: ExtractSignalResult,
    ): ExtractSignalResult | undefined => {
      if (result.candidate?.source !== "stored") return undefined;
      log(`${signalKey} selected`, `stored, value=${result.value}`);
      return result;
    };

    let portfolioValue = isForcedChoiceSignal("portfolio_value")
      ? undefined
      : acceptStoredFastPathResult("portfolio_value", preCssPortfolio) ??
        resolveAutomaticSignalSelection({
          signalKey: "portfolio_value",
          cssResult: preCssPortfolio,
          storedProfile: storedPortfolioProfile,
          safeMode: executionModes.safeMode,
          log,
        });
    let freeCash = isForcedChoiceSignal("free_cash")
      ? undefined
      : acceptStoredFastPathResult("free_cash", preCssFreeCash) ??
        resolveAutomaticSignalSelection({
          signalKey: "free_cash",
          cssResult: preCssFreeCash,
          storedProfile: storedFreeCashProfile,
          safeMode: executionModes.safeMode,
          log,
        });

    const aiLogs: Partial<Record<FinancialSignalKey, AiExtractionLog>> = {};
    const geminiValues: Partial<Record<FinancialSignalKey, GeminiChoiceValue>> = {};
    const geminiSignalKeys = ([
      ...(portfolioValue || isForcedChoiceSignal("portfolio_value")
        ? []
        : ["portfolio_value" as const]),
      ...(freeCash || isForcedChoiceSignal("free_cash")
        ? []
        : ["free_cash" as const]),
    ] satisfies FinancialSignalKey[]);

    // Step 2: Gemini only supports unresolved default extraction cases.
    if (geminiSignalKeys.length > 0) {
      let textTree: string | null = null;
      let textTreeTruncated = false;
      try {
        log("Fetching text tree for AI extraction", `tabId=${tabId}`);
        const fetched = await getTextTreeFromTab(tabId);
        textTree = fetched.textTree;
        textTreeTruncated = fetched.truncated;
        log(
          "Text tree fetched",
          `${textTree.length} chars, nodes=${fetched.nodeCount ?? "?"}, truncated=${textTreeTruncated}`,
          textTreeTruncated ? "warn" : "info",
        );
      } catch (err) {
        log(
          "Failed to fetch text tree",
          getErrorMessage(err),
          "warn",
        );
      }

      for (const key of geminiSignalKeys) {
        if (!textTree) break;
        log(`AI extraction for ${key}`, "Querying Gemini Nano");
        try {
          const aiResult = await aiExtractSignalFromTextTree(textTree, key, {
            truncated: textTreeTruncated,
          });
          aiLogs[key] = aiResult.aiLog;
          if (aiResult.ok) {
            geminiValues[key] = {
              value: aiResult.value,
              currency: aiResult.currency,
            };
            log(
              `AI extraction ${key}`,
              `value=${aiResult.value}, currency=${aiResult.currency}`,
              "info",
            );
          } else {
            log(
              `AI extraction ${key}`,
              formatAiNoResultDetail(aiResult.aiLog),
              "warn",
            );
          }
        } catch (err) {
          log(
            `AI extraction ${key} failed`,
            getErrorMessage(err),
            "warn",
          );
        }
      }
    }

    // The user picking a portfolio value in the modal is the strongest possible
    // confirmation that this page is the right one to come back to.
    let portfolioChoiceShown = false;
    if (!portfolioValue) {
      portfolioValue = await resolveSignalSelection({
        platform,
        runId,
        signalKey: "portfolio_value",
        cssResult: preCssPortfolio,
        storedProfile: storedPortfolioProfile,
        gemini: geminiValues.portfolio_value,
        onEvent,
        log,
        signal,
        safeMode: executionModes.safeMode,
        allowManualChoice:
          isForcedChoiceSignal("portfolio_value") || !isDemoModeEnabled,
        forceChoice: isForcedChoiceSignal("portfolio_value"),
        onUserWaitStart: () => {
          portfolioChoiceShown = true;
          startUserWait();
        },
        onUserWaitEnd: endUserWait,
      });
    }
    const portfolioLog = buildExtractionLogDetail(portfolioValue);
    log("portfolio_value resolved", portfolioLog.detail, portfolioLog.level);

    if (!freeCash) {
      freeCash = await resolveSignalSelection({
        platform,
        runId,
        signalKey: "free_cash",
        cssResult: preCssFreeCash,
        storedProfile: storedFreeCashProfile,
        gemini: geminiValues.free_cash,
        onEvent,
        log,
        signal,
        safeMode: executionModes.safeMode,
        allowManualChoice:
          isForcedChoiceSignal("free_cash") || !isDemoModeEnabled,
        forceChoice: isForcedChoiceSignal("free_cash"),
        onUserWaitStart: startUserWait,
        onUserWaitEnd: endUserWait,
      });
    }
    const freeCashLog = buildExtractionLogDetail(freeCash);
    log("free_cash resolved", freeCashLog.detail, freeCashLog.level);

    const portfolioTelemetryWarnings = [
      ...new Set([...verifierWarnings, ...(portfolioValue.warnings ?? [])]),
    ];
    const freeCashTelemetryWarnings = [
      ...new Set([...verifierWarnings, ...(freeCash.warnings ?? [])]),
    ];
    const finalTelemetryWarnings = [
      ...new Set([
        ...portfolioTelemetryWarnings,
        ...freeCashTelemetryWarnings,
      ]),
    ];
    await recordExtractionTelemetry({
      platformId: platform.id,
      runId,
      signalKey: "portfolio_value",
      stage: "final",
      outcome:
        portfolioValue.value === null
          ? "missing"
          : portfolioValue.confidence < PRODUCTION_CONFIDENCE_THRESHOLD
            ? "low_confidence"
            : "auto_selected",
      result: portfolioValue,
      pollCount: extractionPollCount,
      warnings: portfolioTelemetryWarnings,
    });
    await recordExtractionTelemetry({
      platformId: platform.id,
      runId,
      signalKey: "free_cash",
      stage: "final",
      outcome:
        freeCash.value === null
          ? "missing"
          : freeCash.confidence < PRODUCTION_CONFIDENCE_THRESHOLD
            ? "low_confidence"
            : "auto_selected",
      result: freeCash,
      pollCount: extractionPollCount,
      warnings: freeCashTelemetryWarnings,
    });

    // Step 4: Calculate net annual return from DB (not extracted)
    log("Calculating net annual return from DB");
    const calculatedReturn = await calculateNetAnnualReturn(platform.id);
    if (calculatedReturn !== null) {
      log("Net annual return calculated", `${calculatedReturn.toFixed(2)}%`);
    } else {
      log("Net annual return", "No cashflow data available", "warn");
    }

    debugSignals = debugMode
      ? [
          {
            ...buildDebugSignal(
              "portfolio_value",
              signalSelectors(platform, "portfolio_value"),
              portfolioValue,
            ),
            ...(aiLogs.portfolio_value
              ? { aiLog: aiLogs.portfolio_value }
              : {}),
          },
          {
            ...buildDebugSignal(
              "free_cash",
              signalSelectors(platform, "free_cash"),
              freeCash,
            ),
            ...(aiLogs.free_cash ? { aiLog: aiLogs.free_cash } : {}),
          },
        ]
      : undefined;

    if (hasUnsafeDuplicateSignalCandidate(portfolioValue, freeCash)) {
      const detail = formatDuplicateSignalDetail(portfolioValue, freeCash);
      log("Conflicting extraction candidates", detail, "error");
      await updatePlatformProgress(runId, platform.id, "failed_extract");
      onEvent(withCapturedHtml({
        type: "platform_error",
        platformId: platform.id,
        runId,
        message: "Conflicting extraction candidates",
        state: "failed_extract",
        ...(debugSignals ? { debug: debugSignals } : {}),
      }));
      return null;
    }

    if (portfolioValue.value === null || freeCash.value === null) {
      log(
        "Required signals missing",
        "Could not extract portfolio value or free cash",
        "error",
      );
      await updatePlatformProgress(runId, platform.id, "failed_extract");
      onEvent(withCapturedHtml({
        type: "platform_error",
        platformId: platform.id,
        runId,
        message: "Could not extract portfolio value or free cash",
        state: "failed_extract",
        ...(debugSignals ? { debug: debugSignals } : {}),
      }));
      return null;
    }

    const confidence = Math.min(portfolioValue.confidence, freeCash.confidence);
    const warnings: string[] = [...finalTelemetryWarnings];
    if (confidence < PRODUCTION_CONFIDENCE_THRESHOLD) {
      warnings.push(`Low confidence extraction: ${confidence.toFixed(2)}`);
      log(
        "Low confidence extraction",
        `Minimum confidence ${(confidence * 100).toFixed(0)}%`,
        "warn",
      );
    }
    const invariantAssessment = assessOverviewInvariants({
      portfolioValue: portfolioValue.value,
      freeCash: freeCash.value,
      history,
    });
    if (invariantAssessment.status === "suspicious") {
      warnings.push("suspect_value");
      warnings.push(...invariantAssessment.reasons);
      await recordExtractionTelemetry({
        platformId: platform.id,
        runId,
        signalKey: "free_cash",
        stage: "stored",
        outcome: "stored_suspect",
        result: freeCash,
        pollCount: extractionPollCount,
        warnings: invariantAssessment.reasons,
      });
    }

    const currency =
      detectCurrency(portfolioValue.candidate?.text ?? "", "") ||
      detectCurrency(freeCash.candidate?.text ?? "", "") ||
      "EUR";

    const result: ConnectorSyncResult = {
      fetchedAt: getFetchedAt?.(platform.id) ?? new Date().toISOString(),
      platformId: platform.id,
      cashflows: [],
      positions: [],
      overviewMetrics: {
        platformValue: portfolioValue.value,
        freeCash: freeCash.value,
        ...(calculatedReturn !== null
          ? { netAnnualReturnPct: calculatedReturn }
          : {}),
        currency,
        confidence,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      warnings,
    };

    if (!isForcedChoiceSignal("portfolio_value")) {
      await autoLearnSelectorIfSafe({
        platformId: platform.id,
        signalKey: "portfolio_value",
        result: portfolioValue,
        warnings,
      });
    }
    if (!isForcedChoiceSignal("free_cash")) {
      await autoLearnSelectorIfSafe({
        platformId: platform.id,
        signalKey: "free_cash",
        result: freeCash,
        warnings,
      });
    }

    if (!isDemoModeEnabled) {
      await recordNavigationOutcome({
        platformId: platform.id,
        url: extractionPageHref,
        portfolio: portfolioValue,
        warnings,
        userConfirmed: portfolioChoiceShown && portfolioValue.value !== null,
        log,
      });
    }

    log("Persisting sync result");
    let ingestOutcome: IngestConnectorResultOutcome | undefined;
    try {
      await assertSyncRunStillActive(runId, platform.id, signal);
      ingestOutcome = await ingestConnectorResult(result, { sourceKind: "sync", runId });
      await assertSyncRunStillActive(runId, platform.id, signal);
    } catch (err) {
      if (err instanceof CancelledError || err instanceof TimeoutError) {
        await revertIngestionOutcomeOnAbort({
          outcome: ingestOutcome,
          platform,
          log,
        });
      }
      throw err;
    }
    await updatePlatformProgress(runId, platform.id, "success");
    try {
      await persistSafeMode(
        storedCredentials,
        false,
        platform.login.safeMode ?? false,
      );
    } catch (err) {
      log(
        "Safe Mode disable failed",
        getErrorMessage(err),
        "warn",
      );
    }
    log(
      "Sync completed",
      `Portfolio ${portfolioValue.value}, free cash ${freeCash.value}`,
      "info",
      elapsed(),
    );
    onEvent(withCapturedHtml({
      type: "platform_done",
      platformId: platform.id,
      runId,
      result,
      ...(debugSignals ? { debug: debugSignals } : {}),
    }));

    return result;
      })();
  } catch (err) {
    if (err instanceof TimeoutError) {
      const message = err.message;
      log("Sync timed out", message, "error", elapsed());
      await updatePlatformProgress(runId, platform.id, "failed_timeout");
      onEvent(withCapturedHtml({
        type: "platform_error",
        platformId: platform.id,
        runId,
        message,
        state: "failed_timeout",
        ...(debugSignals ? { debug: debugSignals } : {}),
      }));
      return null;
    }
    if (err instanceof CancelledError) {
      log("Sync cancelled by user", undefined, "warn", elapsed());
      await updatePlatformProgress(runId, platform.id, "cancelled");
      onEvent(withCapturedHtml({
        type: "platform_cancelled",
        platformId: platform.id,
        runId,
        message: "Cancelled by user",
        state: "cancelled",
        ...(debugSignals ? { debug: debugSignals } : {}),
      }));
      throw err;
    }
    if (err instanceof DeferredActionError) {
      log("Sync deferred for manual action", err.message, "info");
      const state = err.actionType === "2fa" ? ("failed_2fa" as const) : ("failed_captcha" as const);
      await updatePlatformProgress(runId, platform.id, state);
      onEvent({
        type: "platform_progress",
        platformId: platform.id,
        runId,
        message: err.message,
      });
      return { deferred: true, actionType: err.actionType };
    }
    if (
      err instanceof ExtractionChoiceTimeoutError ||
      (err instanceof Error && err.message === "Extraction choice timeout")
    ) {
      const message = err.message;
      log("Extraction choice timed out", message, "error", elapsed());
      await updatePlatformProgress(runId, platform.id, "failed_extract");
      onEvent(withCapturedHtml({
        type: "platform_error",
        platformId: platform.id,
        runId,
        message,
        state: "failed_extract",
        ...(debugSignals ? { debug: debugSignals } : {}),
      }));
      return null;
    }
    const message = getErrorMessage(err);
    const state = message.includes("Content script not reachable") ||
          message.includes("Could not establish connection")
        ? ("failed_extract" as const)
        : loginVerified
          ? ("failed_extract" as const)
          : ("failed_login" as const);
    log("Sync failed", message, "error", elapsed());
    if (state === "failed_login") {
      await finishLoginFailure(message);
      return null;
    }
    await updatePlatformProgress(runId, platform.id, state);
    onEvent(withCapturedHtml({
      type: "platform_error",
      platformId: platform.id,
      runId,
      message,
      state,
      ...(debugSignals ? { debug: debugSignals } : {}),
    }));
    return null;
  } finally {
    platformTimeout.clear();
    removeAbortListener?.();
    await closeActiveTab();
    // Clear credentials from memory (variables go out of scope — GC will collect)
  }
}

// ─── Full sync run ────────────────────────────────────────────────────────────

export function resolveFirstPassAllowManualAction(
  parallelSyncEnabled: boolean,
): boolean {
  return !parallelSyncEnabled;
}

export async function runSync(
  runId: string,
  platforms: PlatformCatalogEntry[],
  stealthMode: boolean,
  onEvent: (event: SyncEvent) => void,
  signal?: AbortSignal,
  getPlatformSignal?: (id: PlatformId) => AbortSignal,
  getFetchedAt?: (platformId: PlatformId) => string,
  getForceExtractionChoiceSignals?: (
    platformId: PlatformId,
  ) => readonly ExtractionChoiceSignalKey[] | undefined,
): Promise<void> {
  const settings = await getSettings();
  const debugMode = settings.debugModeEnabled ?? false;
  const parallelSyncEnabled = settings.parallelSyncEnabled ?? false;
  const showTwoFactorManualActionDialog =
    settings.showTwoFactorManualActionDialog ?? false;
  const syncRunTimeoutMs = isDemoModeEnabled
    ? DEMO_SYNC_RUN_TIMEOUT_MS
    : SYNC_RUN_TIMEOUT_MS;
  const manualActionGate = createManualActionGate();
  const runTimeout = createTimeoutSignal(
    syncRunTimeoutMs,
    "Sync run exceeded maximum duration",
  );
  const runSignal = combineAbortSignals([signal, runTimeout.signal]);

  let cancelled = false;
  const processedPlatformIds = new Set<PlatformId>();
  try {
    const deferredPlatforms: { platform: PlatformCatalogEntry; actionType: "2fa" | "captcha" }[] = [];
    await (async () => {
        await runPlatforms(platforms, async (platform, runnerSignal) => {
          processedPlatformIds.add(platform.id);
          const platformSignal = getPlatformSignal?.(platform.id);
          const effectiveSignal = combineAbortSignals([
            platformSignal,
            runnerSignal,
            runSignal,
          ]);
          let res: Awaited<ReturnType<typeof syncPlatform>>;
          try {
            res = await syncPlatform(
              runId,
              platform,
              stealthMode,
              debugMode,
              onEvent,
              effectiveSignal,
              getFetchedAt,
              () => {
                manualActionGate.enter();
                runTimeout.pause();
              },
              () => {
                runTimeout.resume();
                manualActionGate.leave();
              },
              resolveFirstPassAllowManualAction(parallelSyncEnabled),
              getForceExtractionChoiceSignals?.(platform.id) ?? [],
              showTwoFactorManualActionDialog,
            );
          } catch (err) {
            if (
              isPlatformOnlyCancelledError(
                err,
                platformSignal,
                runnerSignal,
                runSignal,
              )
            ) {
              return null;
            }
            throw err;
          }
          if (res && "deferred" in res) {
            deferredPlatforms.push({ platform, actionType: res.actionType });
          }
          return res;
        }, {
          concurrency: parallelSyncEnabled ? PARALLEL_SYNC_LIMIT : 1,
          ...(runSignal === undefined ? {} : { signal: runSignal }),
          ...(parallelSyncEnabled
            ? {
                waitForClear: (waitSignal?: AbortSignal) =>
                  manualActionGate.waitForClear(waitSignal),
              }
            : {}),
        });

        // Run deferred platforms sequentially at the end of the queue
        for (const deferred of deferredPlatforms) {
          if (runSignal?.aborted) break;
          const platformSignal = getPlatformSignal?.(deferred.platform.id);
          const effectiveSignal = combineAbortSignals([platformSignal, runSignal]);
          try {
            await syncPlatform(
              runId,
              deferred.platform,
              stealthMode,
              debugMode,
              onEvent,
              effectiveSignal,
              getFetchedAt,
              () => {
                manualActionGate.enter();
                runTimeout.pause();
              },
              () => {
                runTimeout.resume();
                manualActionGate.leave();
              },
              true, // allowManualAction = true (allow manual action at end of queue)
              getForceExtractionChoiceSignals?.(deferred.platform.id) ?? [],
              showTwoFactorManualActionDialog,
            );
          } catch (err) {
            if (
              isPlatformOnlyCancelledError(
                err,
                platformSignal,
                undefined,
                runSignal,
              )
            ) {
              continue;
            }
            throw err;
          }
        }
      })();
  } catch (err) {
    if (err instanceof CancelledError) {
      cancelled = true;
      // Mark remaining unprocessed platforms as cancelled
      for (const p of platforms) {
        if (!processedPlatformIds.has(p.id)) {
          await updatePlatformProgress(runId, p.id, "cancelled");
          onEvent({
            type: "platform_cancelled",
            platformId: p.id,
            runId,
            message: "Cancelled by user",
            state: "cancelled",
          });
        }
      }
    } else {
      throw err;
    }
  } finally {
    runTimeout.clear();
  }

  if (cancelled) {
    onEvent({ type: "sync_cancelled", platformId: "", runId });
  } else {
    onEvent({ type: "sync_complete", platformId: "", runId });
  }
}
