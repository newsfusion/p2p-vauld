// ─── Platform Catalog ────────────────────────────────────────────────────────

export const PLATFORM_IDS = [
  "mintos",
  "bondora_go_grow",
  "peerberry",
  "robocash",
  "twino",
  "estateguru",
  "debitum",
  "esketit",
  "viainvest",
  "nectaro",
  "afranga",
  "asterra_estate",
  "devon",
  "ff_forest",
  "ventus_energy",
  "indemo",
  "inrento",
  "crowdpear",
  "income_marketplace",
  "lande",
  "capitalia",
  "fintown",
  "monefit_smartsaver",
  "mypeak_finance",
  "triple_dragon",
  "insoil_finance",
  "bondster",
  "crowdestor",
  "lendermarket",
  "swaper",
  "iuvo_group",
  "kviku_finance",
  "neo_finance",
  "finbee",
  "axia_funder",
  "maclear",
  "loanch",
  "savy",
  "quanloop",
  "bergfurst",
  "exporo",
  "stock_estate",
  "shojin",
  "crowdedhero",
  "hive5",
  "lonvest",
  "landex",
  "nibble",
  "modena",
  "profitus",
  "nordstreet",
  "linked_finance",
  "planethome",
  "letsinvest",
  "goparity",
  "wiwin",
  "bettervest",
  "dagobertinvest",
  "rendity",
] as const;

export type PlatformId = (typeof PLATFORM_IDS)[number];
export type ConnectorStrategy = "universal" | "special";

export interface PlatformDescriptor {
  id: PlatformId;
  name: string;
  enabled: boolean;
  strategy: ConnectorStrategy;
}

export interface PlatformCatalogEntry extends PlatformDescriptor {
  domains: string[];
  login: {
    entryUrl: string;
    usernameSelectors: string[];
    passwordSelectors: string[];
    submitSelectors: string[];
    otpSelectors: string[];
    postLoginIndicators: string[];
    safeMode?: boolean;
  };
  dashboard: {
    portfolioValueSelectors: string[];
    freeCashSelectors: string[];
    netAnnualReturnSelectors: string[];
    keywords?: Partial<Record<FinancialSignalKey, string[]>>;
    excludeKeywords?: Partial<Record<FinancialSignalKey, string[]>>;
  };
}

// ─── Sync Lifecycle ───────────────────────────────────────────────────────────

export type SyncRunState =
  | "queued"
  | "running"
  | "paused_2fa"
  | "paused_security_challenge"
  | "completed"
  | "failed"
  | "cancelled";

export type PlatformSyncState =
  | "pending"
  | "running"
  | "success"
  | "failed_login"
  | "failed_2fa"
  | "failed_captcha"
  | "failed_timeout"
  | "failed_extract"
  | "cancelled";

export interface SyncRunStatus {
  id: string;
  state: SyncRunState;
  startedAt: string;
  finishedAt?: string;
  message?: string;
  platformProgress: Partial<Record<PlatformId, PlatformSyncState>>;
}

// ─── Financial Data ───────────────────────────────────────────────────────────

export interface OverviewMetrics {
  platformValue: number;
  freeCash: number;
  netAnnualReturnPct?: number;
  currency: string;
  confidence: number;
  warnings?: string[];
}

export interface Cashflow {
  date: string;
  amount: number;
  currency: string;
  eurRate?: number;
  type:
    | "deposit"
    | "withdrawal"
    | "interest_paid"
    | "interest_accrued"
    | "fee"
    | "principal_repayment";
  platformId: PlatformId;
  instrumentId?: string;
  taxCategory: "thesaurierend" | "ausgezahlt" | "neutral";
}

export interface PositionSnapshot {
  platformId: PlatformId;
  instrumentId: string;
  label?: string;
  country?: string;
  assetClass?: string;
  riskClass?: string;
  value: number;
  currency: string;
  eurRate?: number;
  date: string;
}

export interface RiskEvent {
  platformId: PlatformId;
  loanId?: string;
  status: "grace" | "default";
  amountEur: number;
  since: string;
}

export interface ConnectorSyncResult {
  fetchedAt: string;
  platformId: PlatformId;
  cashflows: Cashflow[];
  positions: PositionSnapshot[];
  overviewMetrics?: OverviewMetrics;
  riskEvents?: RiskEvent[];
  warnings: string[];
}

// ─── Sync Events (broadcast from background to UI) ────────────────────────────

export type SyncEventType =
  | "platform_start"
  | "platform_queued"
  | "platform_progress"
  | "platform_done"
  | "platform_error"
  | "platform_cancelled"
  | "extraction_choice_required"
  | "manual_action_required"
  | "sync_complete"
  | "sync_failed"
  | "sync_cancelled";

export interface SyncEvent {
  type: SyncEventType;
  platformId: PlatformId | "";
  runId: string;
  message?: string;
  queuePosition?: number;
  result?: ConnectorSyncResult;
  state?: PlatformSyncState;
  debug?: DebugSignalResult[];
  debugLogs?: DebugLogEntry[];
  rawLoginHtml?: string;
  rawHtml?: string;
  requestId?: string;
  platformName?: string;
  signalKey?: ExtractionChoiceSignalKey;
  candidates?: ExtractionCandidate[];
  actionType?: "captcha" | "2fa";
  expiresAt?: string;
}

// ─── Extraction Candidates ────────────────────────────────────────────────────

export type FinancialSignalKey =
  | "portfolio_value"
  | "free_cash"
  | "net_annual_return";

export interface ExtractionCandidate {
  selector: string;
  text: string;
  value: number;
  score: number;
  /** Number of label keywords matched in the candidate's text/context. */
  keywordHits?: number;
  valueType?: "currency" | "percent";
  context?: string;
  period?: string;
  candidateId?: string;
  fingerprint?: string;
  geminiSupported?: boolean;
  origin?: "selector" | "heuristic" | "gemini";
  source?: "heuristic" | "selector_supported" | "gemini_supported" | "stored";
}

export interface ExtractionResult {
  signalKey: FinancialSignalKey;
  value: number | null;
  confidence: number;
  candidate?: ExtractionCandidate;
  warnings: string[];
}

// ─── Credentials & Security ───────────────────────────────────────────────────

import type { EncryptedBlob } from "../crypto/index.js";
export type { EncryptedBlob };

export interface StoredCredentials {
  platformId: PlatformId;
  encryptedUsername: EncryptedBlob;
  encryptedPassword: EncryptedBlob;
  createdAt: string;
  updatedAt: string;
  safeModeEnabled?: boolean;
  stealthModeEnabled?: boolean;
  consecutiveLoginFailureCount?: number;
  lastLoginError?: string;
}

export interface PlaintextCredentials {
  username: string;
  password: string;
}

export interface PlatformModeOverrides {
  safeModeEnabled?: boolean;
  stealthModeEnabled?: boolean;
}

export interface CredentialStatusEntry extends PlatformModeOverrides {
  platformId: PlatformId;
  lastLoginError?: string;
}

// ─── Selector Learning ────────────────────────────────────────────────────────

export interface SelectorProfile {
  platformId: PlatformId;
  signalKey: FinancialSignalKey;
  selector: string;
  fingerprint?: string;
  confidence: number;
  source?: "user" | "auto";
  learnedAt: string;
  lastVerifiedAt?: string;
  failureCount?: number;
}

/**
 * The page a platform's portfolio values were last successfully read from.
 * Platforms redirect to wildly different landing pages after login (a positions
 * list, a promo page, the actual overview), so we remember the page that worked
 * and go straight there next time instead of re-walking the navigation.
 */
export interface NavigationProfile {
  platformId: PlatformId;
  /** Absolute URL, hash stripped. */
  url: string;
  source: "user" | "auto";
  confidence: number;
  learnedAt: string;
  lastVerifiedAt?: string;
  failureCount?: number;
}

export type LoginFieldRole = "username" | "password" | "submit" | "otp";

export type LoginSelectorMap = Partial<Record<LoginFieldRole, string[]>>;

export type LearnedLoginSelectorMap = Partial<Record<LoginFieldRole, string>>;

export interface LoginSelectorProfile {
  platformId: PlatformId;
  fieldRole: LoginFieldRole;
  selector: string;
  fingerprint?: string;
  confidence: number;
  source: "ai";
  learnedAt: string;
  lastVerifiedAt?: string;
  failureCount: number;
}

export type ExtractionChoiceSignalKey = "portfolio_value" | "free_cash";

export interface ExtractionChoiceRequest {
  requestId: string;
  runId: string;
  platformId: PlatformId;
  platformName: string;
  signalKey: ExtractionChoiceSignalKey;
  candidates: ExtractionCandidate[];
  expiresAt: string;
}

export interface ManualActionRequest {
  requestId: string;
  runId: string;
  platformId: PlatformId;
  platformName: string;
  actionType: "captcha" | "2fa";
  expiresAt: string;
  message?: string;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface AppSettings {
  privacyModeEnabled: boolean;
  stealthModeEnabled: boolean;
  debugModeEnabled: boolean;
  /** Run up to two platform syncs in parallel. */
  parallelSyncEnabled: boolean;
  /** Show the dashboard modal that accepts 2FA codes during sync. */
  showTwoFactorManualActionDialog: boolean;
  /** Include low-confidence extracted metrics in popup totals. */
  showLowConfidenceMetricsInPopup: boolean;
  disabledPlatformIds: PlatformId[];
  language: "de" | "en" | "nl" | "fr" | "it" | "es";
  /** Show an extension icon reminder after this many days without successful sync data. */
  syncReminderDays: number;
  /** Whether inactivity auto-lock is enabled in master-password mode. */
  autoLockEnabled: boolean;
  /** Inactivity timeout in minutes. Only effective in master-password mode. */
  sessionTimeoutMinutes: 5 | 15 | 30 | 60;
  /** Metrics history retention in days. 0 = unlimited. */
  historyRetentionDays: number;
  /** User dismissed the first-run Gemini Nano activation banner. */
  geminiActivationBannerDismissed: boolean;
}

// ─── Debug Data ──────────────────────────────────────────────────────────────

export interface DebugSignalResult {
  signalKey: FinancialSignalKey;
  selectors: string[];
  candidates: ExtractionCandidate[];
  picked: ExtractionCandidate | null;
  confidence: number;
  elementsScanned: number;
  aiLog?: AiExtractionLog;
}

export interface DebugLogEntry {
  timestamp: string;
  step: string;
  detail?: string;
  level: "info" | "warn" | "error";
  elapsedMs?: number;
}

export interface AiLoginFieldLog {
  available: boolean;
  reason?: string;
  candidateCount?: number;
  promptText?: string;
  rawResponse?: string;
  detectedFields?: {
    username?: number;
    password?: number;
    submit?: number;
    otp?: number;
  };
  error?: string;
  durationMs?: number;
}

export interface AiExtractionLog {
  available: boolean;
  reason?: string;
  snippetCount?: number;
  estimatedTokens?: number;
  promptText?: string;
  rawResponse?: string;
  parsedValue?: number;
  parsedCurrency?: string;
  error?: string;
  durationMs?: number;
  /** Characters of the prompt actually sent — makes budget overruns visible. */
  promptChars?: number;
  /** True when the text tree was pruned to fit the shared prompt budget. */
  textTreeTruncated?: boolean;
}

export interface DebugPlatformSnapshot {
  platformId: PlatformId;
  platformName: string;
  timestamp: string;
  signals: DebugSignalResult[];
  loginSuccess: boolean;
  cancelled?: boolean;
  error?: string;
  logs: DebugLogEntry[];
  rawLoginHtml?: string;
  rawHtml?: string;
}

// ─── Extractor Transfer ─────────────────────────────────────────────────────

export type ExtractorPageType = "login" | "dashboard";

export interface ExtractorTransfer {
  platformId: PlatformId;
  platformName: string;
  pageType: ExtractorPageType;
  html: string;
  timestamp: string;
}

// ─── HTML Cleanup ───────────────────────────────────────────────────────────

export interface CleanupStats {
  /** Character count of original body innerHTML */
  rawLength: number;
  /** Character count after cleanup */
  cleanedLength: number;
  /** Percentage reduction (0-100) */
  reductionPct: number;
  /** Number of elements removed */
  elementsRemoved: number;
  /** Number of attributes stripped */
  attributesStripped: number;
}

// ─── DB Stored Types ──────────────────────────────────────────────────────────

export interface StoredSyncRun {
  id?: number;
  runId: string;
  state: SyncRunState;
  startedAt: string;
  finishedAt?: string;
  platformProgress: Partial<Record<PlatformId, PlatformSyncState>>;
  message?: string;
}

/**
 * Derived view of the latest `metricsHistory` snapshot per platform.
 * Not persisted in its own table — `metricsHistory` is the source of truth.
 */
export interface StoredOverviewMetrics extends OverviewMetrics {
  platformId: PlatformId;
  fetchedAt: string;
}

export type IngestionSourceKind = "sync" | "restore";

export interface IngestConnectorResultOptions {
  sourceKind: IngestionSourceKind;
  runId?: string;
}

export interface ReplacedIngestionBatchRollback {
  batch: StoredIngestionBatch;
  previousDailySnapshot?: StoredMetricsSnapshot;
}

export interface IngestConnectorResultOutcome {
  batchId?: number;
  createdBatch: boolean;
  replacedExistingBatch: boolean;
  replacementRollback?: ReplacedIngestionBatchRollback;
}

export interface IngestionBatchOverview {
  platformId: PlatformId;
  platformValue?: number;
  freeCash?: number;
  netAnnualReturnPct?: number;
  currency?: string;
  confidence?: number;
  fetchedAt: string;
}

export interface StoredMetricsSnapshot {
  platformId: PlatformId;
  date: string; // YYYY-MM-DD
  platformValue: number;
  freeCash: number;
  netAnnualReturnPct?: number;
  fetchedAt: string; // ISO timestamp
  batchId?: number;
  currency?: string;
  confidence?: number;
  warnings?: string[];
}

export type StoredCashflow = Cashflow & {
  id?: number;
  batchId?: number;
};

export type StoredPosition = PositionSnapshot & {
  id?: number;
  batchId?: number;
};

export type StoredRiskEvent = RiskEvent & {
  id?: number;
  recordedAt: string;
  batchId?: number;
};

export interface StoredIngestionBatch {
  id?: number;
  platformId: PlatformId;
  sourceKind: IngestionSourceKind;
  runId?: string;
  appliedAt: string;
  revertible: boolean;
  legacyBackfilled: boolean;
  beforeOverview?: IngestionBatchOverview;
  afterOverview?: IngestionBatchOverview;
  beforeDailySnapshot?: StoredMetricsSnapshot;
  afterDailySnapshot?: StoredMetricsSnapshot;
  cashflowCount: number;
  positionCount: number;
  riskEventCount: number;
}

export type ExtractionTelemetryStage = "css" | "final" | "stored";
export type ExtractionTelemetryOutcome =
  | "auto_selected"
  | "choice_required"
  | "missing"
  | "low_confidence"
  | "stored_suspect"
  | "error";

export interface ExtractionTelemetryRecord {
  id?: number;
  platformId: PlatformId;
  runId: string;
  recordedAt: string;
  signalKey: ExtractionChoiceSignalKey;
  stage: ExtractionTelemetryStage;
  outcome: ExtractionTelemetryOutcome;
  value?: number;
  confidence?: number;
  topScore?: number;
  secondScore?: number | null;
  candidateCount: number;
  elementsScanned: number;
  durationMs?: number;
  pollCount?: number;
  warnings: string[];
}

// ─── Delta / Audit Log ──────────────────────────────────────────────────────

export type DeltaField = "platformValue" | "freeCash" | "netAnnualReturnPct";

export interface StoredDeltaLog {
  id?: number;
  platformId: PlatformId;
  timestamp: string; // ISO 8601
  field: DeltaField;
  oldValue: number;
  newValue: number;
  delta: number; // newValue - oldValue (signed)
  batchId?: number;
}

// ─── Financial Export / Backup ──────────────────────────────────────────────

export interface FinancialBackupPayload {
  overviewMetrics: StoredOverviewMetrics[];
  metricsHistory: Omit<StoredMetricsSnapshot, "batchId">[];
  cashflows: Omit<StoredCashflow, "id" | "batchId">[];
  positions: Omit<StoredPosition, "id" | "batchId">[];
  riskEvents: Omit<StoredRiskEvent, "id" | "batchId">[];
  deltaLogs: Omit<StoredDeltaLog, "id" | "batchId">[];
}

export interface FinancialBackupV1 {
  format: "p2p-portfolio-tracker-financial-backup";
  version: 1;
  exportedAt: string;
  appVersion: string;
  payload: FinancialBackupPayload;
}

// ─── Gemini AI Status ────────────────────────────────────────────────────────

export type GeminiStatus =
  | "api_not_supported" // LanguageModel is undefined
  | "unavailable" // LanguageModel.availability() -> unavailable
  | "downloadable" // LanguageModel.availability() -> downloadable
  | "downloading" // LanguageModel.availability() -> downloading
  | "available"; // LanguageModel.availability() -> available

export interface GeminiDownloadProgress {
  loaded: number;
  total: number;
}
