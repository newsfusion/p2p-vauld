import type {
  PlatformId,
  SyncRunStatus,
  PlaintextCredentials,
  PlatformModeOverrides,
  CredentialStatusEntry,
  FinancialBackupPayload,
  FinancialBackupV1,
  StoredOverviewMetrics,
  StoredIngestionBatch,
  StoredMetricsSnapshot,
  StoredSyncRun,
  FinancialSignalKey,
  ExtractionCandidate,
  SyncEvent,
  ExtractionChoiceRequest,
  ManualActionRequest,
  ExtractionChoiceSignalKey,
  SelectorProfile,
  AppSettings,
  AiExtractionLog,
  AiLoginFieldLog,
  LearnedLoginSelectorMap,
  LoginFieldRole,
  LoginSelectorMap,
  GeminiStatus,
  GeminiDownloadProgress,
  CleanupStats,
} from "./types/index.js";

// ─── Background ← Popup/Dashboard ────────────────────────────────────────────

export interface StartSyncMessage {
  type: "START_SYNC";
  payload: {
    platformIds?: PlatformId[];
    forceExtractionChoiceForSignals?: ExtractionChoiceSignalKey[];
  };
}

export interface GetSyncStatusMessage {
  type: "GET_SYNC_STATUS";
}

export interface GetMetricsMessage {
  type: "GET_METRICS";
}

export interface GetExportDataMessage {
  type: "GET_EXPORT_DATA";
}

export interface CreateFinancialBackupMessage {
  type: "CREATE_FINANCIAL_BACKUP";
}

export interface ValidateFinancialBackupMessage {
  type: "VALIDATE_FINANCIAL_BACKUP";
  payload: { backup: unknown };
}

export interface RestoreFinancialBackupMessage {
  type: "RESTORE_FINANCIAL_BACKUP";
  payload: { backup: FinancialBackupV1 };
}

export interface SaveCredentialsMessage {
  type: "SAVE_CREDENTIALS";
  payload: {
    platformId: PlatformId;
    credentials: PlaintextCredentials;
    config?: PlatformModeOverrides;
  };
}

export interface UpdatePlatformModesMessage {
  type: "UPDATE_PLATFORM_MODES";
  payload: {
    platformId: PlatformId;
    config: PlatformModeOverrides;
  };
}

export interface DeleteCredentialsMessage {
  type: "DELETE_CREDENTIALS";
  payload: { platformId: PlatformId };
}

export interface ResetPlatformSelectorsMessage {
  type: "RESET_PLATFORM_SELECTORS";
  /** Without `signalKey` every learned selector of the platform is removed. */
  payload: { platformId: PlatformId; signalKey?: ExtractionChoiceSignalKey };
}

export interface GetSelectorProfilesMessage {
  type: "GET_SELECTOR_PROFILES";
  payload: { platformId: PlatformId };
}

export interface OpenDashboardMessage {
  type: "OPEN_DASHBOARD";
}

export interface GetCredentialStatusMessage {
  type: "GET_CREDENTIAL_STATUS";
}

export interface GetSettingsMessage {
  type: "GET_SETTINGS";
}

export interface SaveSettingsMessage {
  type: "SAVE_SETTINGS";
  payload: Partial<AppSettings>;
}

export interface GetCredentialPrefillMessage {
  type: "GET_CREDENTIAL_PREFILL";
}

export interface GetCredentialEditPrefillMessage {
  type: "GET_CREDENTIAL_EDIT_PREFILL";
  payload: { platformId: PlatformId };
}

export interface SetupMasterPasswordMessage {
  type: "SETUP_MASTER_PASSWORD";
  payload: { password: string };
}

export interface UnlockMessage {
  type: "UNLOCK";
  payload: { password: string };
}

export interface InitInvisibleKeyMessage {
  type: "INIT_INVISIBLE_KEY";
}

export interface GetGeminiStatusMessage {
  type: "GET_GEMINI_STATUS";
}

export interface TriggerGeminiDownloadMessage {
  type: "TRIGGER_GEMINI_DOWNLOAD";
}

export interface ProxyCheckAiMessage {
  type: "PROXY_CHECK_AI";
}

export interface ProxyAiPromptMessage {
  type: "PROXY_AI_PROMPT";
  payload: {
    systemPrompt: string;
    examples: Array<{ role: "user" | "assistant"; content: string }>;
    input: string;
    options?: { responseConstraint?: object };
  };
}

export interface GetLockStatusMessage {
  type: "GET_LOCK_STATUS";
}

export interface LockMessage {
  type: "LOCK";
}

export interface SessionActivityMessage {
  type: "SESSION_ACTIVITY";
}

export interface CancelSyncPlatformMessage {
  type: "CANCEL_SYNC_PLATFORM";
  payload: { platformId: PlatformId };
}

export interface CancelSyncAllMessage {
  type: "CANCEL_SYNC_ALL";
}

export interface CleanupStaleSyncsMessage {
  type: "CLEANUP_STALE_SYNCS";
}

export interface GetPlatformBatchHistoryMessage {
  type: "GET_PLATFORM_BATCH_HISTORY";
  payload: { platformId: PlatformId };
}

export interface RevertPlatformBatchMessage {
  type: "REVERT_PLATFORM_BATCH";
  payload: { platformId: PlatformId; batchId: number };
}

export interface GetMetricsHistoryMessage {
  type: "GET_METRICS_HISTORY";
  payload: { platformId: PlatformId; limit?: number };
}

export interface UpdateMetricsSnapshotMessage {
  type: "UPDATE_METRICS_SNAPSHOT";
  payload: {
    platformId: PlatformId;
    date: string;
    platformValue: number;
    freeCash: number;
  };
}

export interface DeleteMetricsSnapshotMessage {
  type: "DELETE_METRICS_SNAPSHOT";
  payload: { platformId: PlatformId; date: string };
}

export interface ResolveExtractionChoiceMessage {
  type: "RESOLVE_EXTRACTION_CHOICE";
  payload: {
    requestId: string;
    candidateId: string;
  };
}

export interface ResolveManualActionMessage {
  type: "RESOLVE_MANUAL_ACTION";
  payload: {
    requestId: string;
    code?: string;
    actionType: "captcha" | "2fa";
    /**
     * Continue the sync without re-verifying the login state. Offered in the
     * dashboard only after a normal confirmation failed, and only for captcha.
     */
    force?: boolean;
  };
}

// ─── Background → Popup/Dashboard ────────────────────────────────────────────

export interface SyncProgressMessage {
  type: "SYNC_PROGRESS";
  payload: SyncEvent;
}

export interface MetricsUpdatedMessage {
  type: "METRICS_UPDATED";
  payload:
    | StoredOverviewMetrics[]
    | { metrics: StoredOverviewMetrics[]; dataPlatformIds?: PlatformId[] };
}

export interface GeminiStatusChangedMessage {
  type: "GEMINI_STATUS_CHANGED";
  payload: { status: GeminiStatus };
}

export interface GeminiDownloadProgressMessage {
  type: "GEMINI_DOWNLOAD_PROGRESS";
  payload: GeminiDownloadProgress;
}

export interface GeminiDownloadFailedMessage {
  type: "GEMINI_DOWNLOAD_FAILED";
  payload: { error: string };
}

// ─── Response types ───────────────────────────────────────────────────────────

export interface CredentialStatusResponse {
  platformIds: PlatformId[];
  credentials?: CredentialStatusEntry[];
}

export interface SettingsResponse {
  settings: AppSettings;
}

export interface CredentialPrefillResponse {
  username: string;
}

export interface UnlockResponse {
  success: boolean;
  error?: string;
}

export interface LockStatusResponse {
  locked: boolean;
  hasMasterPassword: boolean;
}

export type LockStatusChangeReason = "timeout" | "manual" | "unlock" | "setup";

export interface LockStatusChangedMessage {
  type: "LOCK_STATUS_CHANGED";
  payload: LockStatusResponse & { reason: LockStatusChangeReason };
}

export interface GeminiStatusResponse {
  status: GeminiStatus;
}

// ─── Background ↔ Content Script ─────────────────────────────────────────────

export interface LoginMessage {
  type: "LOGIN";
  payload: {
    username: string;
    password: string;
    usernameSelectors: string[];
    passwordSelectors: string[];
    submitSelectors: string[];
    otpSelectors: string[];
    cachedLoginSelectors?: LoginSelectorMap;
    postLoginIndicators: string[];
    stealthMode: boolean;
    safeMode: boolean;
  };
}

export interface CheckLoginMessage {
  type: "CHECK_LOGIN";
  payload: {
    postLoginIndicators: string[];
    usernameSelectors?: string[];
    passwordSelectors?: string[];
    otpSelectors?: string[];
    afterSubmission?: boolean;
    entryUrl?: string;
  };
}

export interface ExtractMessage {
  type: "EXTRACT";
  payload: {
    signalKey: FinancialSignalKey;
    selectors: string[];
    keywords?: Partial<Record<FinancialSignalKey, string[]>>;
    excludeKeywords?: Partial<Record<FinancialSignalKey, string[]>>;
    fresh?: boolean;
    selectorOnly?: boolean;
  };
}

export interface DismissOverlaysMessage {
  type: "DISMISS_OVERLAYS";
}

export interface ClickDashboardLinkMessage {
  type: "CLICK_DASHBOARD_LINK";
  payload?: {
    strategy?: DashboardNavStrategy;
    excludeHrefs?: string[];
  };
}

export type DashboardNavStrategy = "keywords" | "logo" | "first-nav";

export interface CaptureHtmlMessage {
  type: "CAPTURE_HTML";
}

export interface WaitForReadyMessage {
  type: "WAIT_FOR_READY";
  payload: {
    stableMs: number;
    maxWaitMs: number;
  };
}

export interface GetTextTreeMessage {
  type: "GET_TEXT_TREE";
}

export interface SubmitOtpMessage {
  type: "SUBMIT_OTP";
  payload: {
    code: string;
    otpSelectors: string[];
    submitSelectors: string[];
    postLoginIndicators: string[];
  };
}

export interface GetTextTreeResponse {
  success: boolean;
  textTree?: string;
  nodeCount?: number;
  /** True when nodes were pruned to fit the shared prompt budget. */
  truncated?: boolean;
  error?: string;
}

export interface WaitForReadyResponse {
  ready: boolean;
  readyState: string;
  waitedMs: number;
  domStable: boolean;
}

export interface DismissOverlaysResponse {
  success: boolean;
  clicked: Array<{
    vendor: "onetrust" | "cookiebot" | "usercentrics";
    selector: string;
    text: string;
    action: "reject" | "accept";
  }>;
  blockingOverlayDetected: boolean;
  error?: string;
}

export interface ClickDashboardLinkResponse {
  success: boolean;
  clicked: boolean;
  matchText?: string;
  href?: string;
  navigationKind?: "click" | "assign";
  error?: string;
}

// ─── Content Script → Background ─────────────────────────────────────────────

export interface LoginResponse {
  success: boolean;
  loggedIn?: boolean;
  submitted?: boolean;
  requires2FA?: boolean;
  requiresCaptcha?: boolean;
  credentialError?: boolean;
  foundElements?: {
    username?: string;
    password?: string;
    submit?: string;
    loginTrigger?: string;
  };
  learnedLoginSelectors?: LearnedLoginSelectorMap;
  usedLoginSelectorRoles?: LoginFieldRole[];
  staleLoginSelectorRoles?: LoginFieldRole[];
  loginTriggerClicked?: boolean;
  error?: string;
}

export interface CheckLoginResponse {
  loggedIn: boolean;
  requires2FA?: boolean;
  requiresCaptcha?: boolean;
  credentialError?: boolean;
  /**
   * Not logged in per the strict check, but the page carries signed-in markers
   * (logout control, authenticated nav, account widget). The background should
   * navigate into the authenticated area and re-check before submitting
   * credentials.
   */
  sessionEvidence?: boolean;
  url?: string;
}

export interface ExtractResponse {
  success: boolean;
  candidates?: ExtractionCandidate[];
  elementsScanned?: number;
  error?: string;
  cleanupStats?: CleanupStats | undefined;
}

export interface CaptureHtmlResponse {
  html: string;
  cleanupStats?: CleanupStats | undefined;
}

// ─── AI response types (kept for disconnected AI files) ──────────────────────

export interface AiExtractResponse {
  success: boolean;
  candidate?: ExtractionCandidate;
  aiLog: AiExtractionLog;
  error?: string;
}

export interface DetectLoginFieldsResponse {
  detected: boolean;
  fields?: {
    username?: string;
    password?: string;
    submit?: string;
    otp?: string;
  };
  stableSelectors?: LearnedLoginSelectorMap;
  fieldElements?: {
    username?: string;
    password?: string;
    submit?: string;
    otp?: string;
  };
  aiLog: AiLoginFieldLog;
  error?: string;
}

// ─── Union types ──────────────────────────────────────────────────────────────

export type BackgroundMessage =
  | StartSyncMessage
  | GetSyncStatusMessage
  | GetMetricsMessage
  | GetExportDataMessage
  | CreateFinancialBackupMessage
  | ValidateFinancialBackupMessage
  | RestoreFinancialBackupMessage
  | SaveCredentialsMessage
  | UpdatePlatformModesMessage
  | DeleteCredentialsMessage
  | ResetPlatformSelectorsMessage
  | GetSelectorProfilesMessage
  | OpenDashboardMessage
  | GetCredentialStatusMessage
  | GetLockStatusMessage
  | GetSettingsMessage
  | GetCredentialPrefillMessage
  | GetCredentialEditPrefillMessage
  | SaveSettingsMessage
  | SetupMasterPasswordMessage
  | UnlockMessage
  | LockMessage
  | SessionActivityMessage
  | InitInvisibleKeyMessage
  | GetGeminiStatusMessage
  | TriggerGeminiDownloadMessage
  | ProxyCheckAiMessage
  | ProxyAiPromptMessage
  | CancelSyncPlatformMessage
  | CancelSyncAllMessage
  | CleanupStaleSyncsMessage
  | GetPlatformBatchHistoryMessage
  | RevertPlatformBatchMessage
  | GetMetricsHistoryMessage
  | UpdateMetricsSnapshotMessage
  | DeleteMetricsSnapshotMessage
  | ResolveExtractionChoiceMessage
  | ResolveManualActionMessage;

export type ContentMessage =
  | LoginMessage
  | CheckLoginMessage
  | ExtractMessage
  | DismissOverlaysMessage
  | ClickDashboardLinkMessage
  | CaptureHtmlMessage
  | WaitForReadyMessage
  | GetTextTreeMessage
  | SubmitOtpMessage;

// ─── Background response type map ────────────────────────────────────────────

export type BackgroundMessageMap = {
  START_SYNC: {
    runId?: string;
    queued?: boolean;
    queuedPlatformIds?: PlatformId[];
    error?: string;
  };
  GET_SYNC_STATUS: {
    run: StoredSyncRun | undefined;
    pendingChoice?: ExtractionChoiceRequest;
    pendingManualAction?: ManualActionRequest;
    queuedPlatformIds?: PlatformId[];
  };
  GET_METRICS: { metrics: StoredOverviewMetrics[]; dataPlatformIds?: PlatformId[] };
  GET_EXPORT_DATA: { data: FinancialBackupPayload };
  CREATE_FINANCIAL_BACKUP: { backup: FinancialBackupV1 };
  VALIDATE_FINANCIAL_BACKUP:
    | { valid: true; backup: FinancialBackupV1 }
    | { valid: false; error: string };
  RESTORE_FINANCIAL_BACKUP: {
    success: boolean;
    error?: string;
    metrics?: StoredOverviewMetrics[];
    dataPlatformIds?: PlatformId[];
  };
  SAVE_CREDENTIALS: { success: boolean; error?: string };
  UPDATE_PLATFORM_MODES: { success: boolean; error?: string };
  DELETE_CREDENTIALS: { success: boolean };
  RESET_PLATFORM_SELECTORS: { success: boolean; error?: string };
  GET_SELECTOR_PROFILES: {
    success: boolean;
    profiles: SelectorProfile[];
    error?: string;
  };
  OPEN_DASHBOARD: Record<string, never>;
  GET_CREDENTIAL_STATUS: CredentialStatusResponse;
  GET_SETTINGS: SettingsResponse;
  GET_CREDENTIAL_PREFILL: CredentialPrefillResponse;
  GET_CREDENTIAL_EDIT_PREFILL: CredentialPrefillResponse;
  SAVE_SETTINGS: { success: boolean };
  SETUP_MASTER_PASSWORD: { success: boolean; error?: string };
  UNLOCK: UnlockResponse;
  GET_LOCK_STATUS: LockStatusResponse;
  LOCK: { success: boolean };
  SESSION_ACTIVITY: { success: boolean };
  INIT_INVISIBLE_KEY: { success: boolean };
  GET_GEMINI_STATUS: GeminiStatusResponse;
  TRIGGER_GEMINI_DOWNLOAD: { success: boolean };
  PROXY_CHECK_AI: GeminiStatusResponse;
  PROXY_AI_PROMPT: { text?: string; error?: string };
  CANCEL_SYNC_PLATFORM: { success: boolean; error?: string };
  CANCEL_SYNC_ALL: { success: boolean; error?: string };
  CLEANUP_STALE_SYNCS: { success: boolean };
  GET_PLATFORM_BATCH_HISTORY: { batches: StoredIngestionBatch[] };
  REVERT_PLATFORM_BATCH: { success: boolean; error?: string };
  GET_METRICS_HISTORY: { snapshots: StoredMetricsSnapshot[] };
  UPDATE_METRICS_SNAPSHOT: { success: boolean; error?: string };
  DELETE_METRICS_SNAPSHOT: { success: boolean; error?: string };
  RESOLVE_EXTRACTION_CHOICE: { success: boolean; error?: string };
  RESOLVE_MANUAL_ACTION: { success: boolean; error?: string; gone?: boolean };
};

// ─── Typed message sender ────────────────────────────────────────────────────

type MessagePayload<T extends BackgroundMessage["type"]> =
  Extract<BackgroundMessage, { type: T }> extends { payload: infer P }
    ? { type: T; payload: P }
    : { type: T };

export function sendBackground<T extends BackgroundMessage["type"]>(
  message: MessagePayload<T>,
): Promise<BackgroundMessageMap[T]> {
  return chrome.runtime.sendMessage(message);
}

// Re-export SyncRunStatus for consumers that need it
export type { SyncRunStatus };
