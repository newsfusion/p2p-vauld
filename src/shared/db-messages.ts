import type {
  AppSettings,
  CredentialStatusEntry,
  ConnectorSyncResult,
  FinancialBackupPayload,
  FinancialBackupV1,
  IngestConnectorResultOutcome,
  IngestConnectorResultOptions,
  LoginFieldRole,
  LoginSelectorProfile,
  NavigationProfile,
  PlatformId,
  PlatformSyncState,
  SelectorProfile,
  StoredCredentials,
  ReplacedIngestionBatchRollback,
  ExtractionChoiceSignalKey,
  ExtractionTelemetryRecord,
  StoredIngestionBatch,
  StoredMetricsSnapshot,
  StoredOverviewMetrics,
  StoredSyncRun,
  SyncRunState,
} from "./types/index.js";

export type SyncRunUpdate = Partial<{
  state: SyncRunState;
  message: string;
  finishedAt: string;
}>;

export interface DbCreateSyncRunRequest {
  type: "DB_CREATE_SYNC_RUN";
  payload: { runId: string; platformIds: PlatformId[] };
}

export interface DbUpdateSyncRunRequest {
  type: "DB_UPDATE_SYNC_RUN";
  payload: { runId: string; update: SyncRunUpdate };
}

export interface DbUpdatePlatformProgressRequest {
  type: "DB_UPDATE_PLATFORM_PROGRESS";
  payload: {
    runId: string;
    platformId: PlatformId;
    state: PlatformSyncState;
  };
}

export interface DbGetLatestSyncRunRequest {
  type: "DB_GET_LATEST_SYNC_RUN";
}

export interface DbGetLastSuccessfulSyncAtRequest {
  type: "DB_GET_LAST_SUCCESSFUL_SYNC_AT";
}

export interface DbGetLatestMetricsRequest {
  type: "DB_GET_LATEST_METRICS";
}

export interface DbGetExportDataRequest {
  type: "DB_GET_EXPORT_DATA";
}

export interface DbListFinancialDataPlatformIdsRequest {
  type: "DB_LIST_FINANCIAL_DATA_PLATFORM_IDS";
}

export interface DbCreateFinancialBackupRequest {
  type: "DB_CREATE_FINANCIAL_BACKUP";
  payload: { appVersion: string; exportedAt?: string };
}

export interface DbRestoreFinancialBackupRequest {
  type: "DB_RESTORE_FINANCIAL_BACKUP";
  payload: { backup: FinancialBackupV1; restoredAt?: string };
}

export interface DbIngestConnectorResultRequest {
  type: "DB_INGEST_CONNECTOR_RESULT";
  payload: { result: ConnectorSyncResult; options?: IngestConnectorResultOptions };
}

export interface DbSaveCredentialsRequest {
  type: "DB_SAVE_CREDENTIALS";
  payload: { credentials: StoredCredentials };
}

export interface DbGetCredentialsRequest {
  type: "DB_GET_CREDENTIALS";
  payload: { platformId: PlatformId };
}

export interface DbDeleteCredentialsRequest {
  type: "DB_DELETE_CREDENTIALS";
  payload: { platformId: PlatformId };
}

export interface DbListCredentialPlatformIdsRequest {
  type: "DB_LIST_CREDENTIAL_PLATFORM_IDS";
}

export interface DbListCredentialStatusRequest {
  type: "DB_LIST_CREDENTIAL_STATUS";
}

export interface DbGetInvisibleKeyRequest {
  type: "DB_GET_INVISIBLE_KEY";
}

export interface DbSetInvisibleKeyRequest {
  type: "DB_SET_INVISIBLE_KEY";
  payload: { keyBase64: string };
}

export interface DbDeleteInvisibleKeyRequest {
  type: "DB_DELETE_INVISIBLE_KEY";
}

export interface DbHasInvisibleKeyRequest {
  type: "DB_HAS_INVISIBLE_KEY";
}

export interface DbLearnSelectorRequest {
  type: "DB_LEARN_SELECTOR";
  payload: { profile: SelectorProfile };
}

export interface DbGetSelectorProfilesRequest {
  type: "DB_GET_SELECTOR_PROFILES";
  payload: { platformId: PlatformId };
}

export interface DbResetSelectorProfilesRequest {
  type: "DB_RESET_SELECTOR_PROFILES";
  payload: { platformId: PlatformId };
}

export interface DbDeleteSelectorProfileRequest {
  type: "DB_DELETE_SELECTOR_PROFILE";
  payload: { platformId: PlatformId; signalKey: ExtractionChoiceSignalKey };
}

export interface DbLearnLoginSelectorsRequest {
  type: "DB_LEARN_LOGIN_SELECTORS";
  payload: { platformId: PlatformId; profiles: LoginSelectorProfile[] };
}

export interface DbGetLoginSelectorProfilesRequest {
  type: "DB_GET_LOGIN_SELECTOR_PROFILES";
  payload: { platformId: PlatformId };
}

export interface DbMarkSelectorFailureRequest {
  type: "DB_MARK_SELECTOR_FAILURE";
  payload: { platformId: PlatformId; signalKey: ExtractionChoiceSignalKey };
}

export interface DbLearnNavigationProfileRequest {
  type: "DB_LEARN_NAVIGATION_PROFILE";
  payload: { profile: NavigationProfile };
}

export interface DbGetNavigationProfileRequest {
  type: "DB_GET_NAVIGATION_PROFILE";
  payload: { platformId: PlatformId };
}

export interface DbMarkNavigationFailureRequest {
  type: "DB_MARK_NAVIGATION_FAILURE";
  payload: { platformId: PlatformId };
}

export interface DbDeleteNavigationProfileRequest {
  type: "DB_DELETE_NAVIGATION_PROFILE";
  payload: { platformId: PlatformId };
}

export interface DbMarkLoginSelectorFailuresRequest {
  type: "DB_MARK_LOGIN_SELECTOR_FAILURES";
  payload: { platformId: PlatformId; fieldRoles: LoginFieldRole[] };
}

export interface DbGetMetricsHistoryRequest {
  type: "DB_GET_METRICS_HISTORY";
  payload: { platformId: PlatformId; limit?: number };
}

export interface DbUpdateMetricsSnapshotRequest {
  type: "DB_UPDATE_METRICS_SNAPSHOT";
  payload: {
    platformId: PlatformId;
    date: string;
    platformValue: number;
    freeCash: number;
  };
}

export interface DbDeleteMetricsSnapshotRequest {
  type: "DB_DELETE_METRICS_SNAPSHOT";
  payload: { platformId: PlatformId; date: string };
}

export interface DbLogExtractionTelemetryRequest {
  type: "DB_LOG_EXTRACTION_TELEMETRY";
  payload: { record: ExtractionTelemetryRecord };
}

export interface DbGetExtractionTelemetryRequest {
  type: "DB_GET_EXTRACTION_TELEMETRY";
  payload: { platformId: PlatformId; limit?: number };
}

export interface DbGetSettingsRequest {
  type: "DB_GET_SETTINGS";
}

export interface DbSaveSettingsRequest {
  type: "DB_SAVE_SETTINGS";
  payload: { settings: Partial<AppSettings> };
}

export interface DbPruneOldDataRequest {
  type: "DB_PRUNE_OLD_DATA";
  payload?: { historyRetentionDays?: number };
}

export interface DbCalculateNetAnnualReturnRequest {
  type: "DB_CALCULATE_NET_ANNUAL_RETURN";
  payload: { platformId: PlatformId };
}

export interface DbCleanupStaleSyncsRequest {
  type: "DB_CLEANUP_STALE_SYNCS";
}

export interface DbGetPlatformBatchHistoryRequest {
  type: "DB_GET_PLATFORM_BATCH_HISTORY";
  payload: { platformId: PlatformId };
}

export interface DbRevertPlatformBatchRequest {
  type: "DB_REVERT_PLATFORM_BATCH";
  payload: { platformId: PlatformId; batchId: number };
}

export interface DbRevertReplacedIngestionBatchRequest {
  type: "DB_REVERT_REPLACED_INGESTION_BATCH";
  payload: { platformId: PlatformId; rollback: ReplacedIngestionBatchRollback };
}

export type DbProxyRequest =
  | DbCreateSyncRunRequest
  | DbUpdateSyncRunRequest
  | DbUpdatePlatformProgressRequest
  | DbGetLatestSyncRunRequest
  | DbGetLastSuccessfulSyncAtRequest
  | DbGetLatestMetricsRequest
  | DbGetExportDataRequest
  | DbListFinancialDataPlatformIdsRequest
  | DbCreateFinancialBackupRequest
  | DbRestoreFinancialBackupRequest
  | DbIngestConnectorResultRequest
  | DbSaveCredentialsRequest
  | DbGetCredentialsRequest
  | DbDeleteCredentialsRequest
  | DbListCredentialPlatformIdsRequest
  | DbListCredentialStatusRequest
  | DbGetInvisibleKeyRequest
  | DbSetInvisibleKeyRequest
  | DbDeleteInvisibleKeyRequest
  | DbHasInvisibleKeyRequest
  | DbLearnSelectorRequest
  | DbGetSelectorProfilesRequest
  | DbResetSelectorProfilesRequest
  | DbDeleteSelectorProfileRequest
  | DbLearnLoginSelectorsRequest
  | DbGetLoginSelectorProfilesRequest
  | DbMarkSelectorFailureRequest
  | DbLearnNavigationProfileRequest
  | DbGetNavigationProfileRequest
  | DbMarkNavigationFailureRequest
  | DbDeleteNavigationProfileRequest
  | DbMarkLoginSelectorFailuresRequest
  | DbGetMetricsHistoryRequest
  | DbUpdateMetricsSnapshotRequest
  | DbDeleteMetricsSnapshotRequest
  | DbLogExtractionTelemetryRequest
  | DbGetExtractionTelemetryRequest
  | DbGetSettingsRequest
  | DbSaveSettingsRequest
  | DbPruneOldDataRequest
  | DbCalculateNetAnnualReturnRequest
  | DbCleanupStaleSyncsRequest
  | DbGetPlatformBatchHistoryRequest
  | DbRevertPlatformBatchRequest
  | DbRevertReplacedIngestionBatchRequest;

export type DbProxyMessageType = DbProxyRequest["type"];

export interface DbProxyResponseMap {
  DB_CREATE_SYNC_RUN: number;
  DB_UPDATE_SYNC_RUN: void;
  DB_UPDATE_PLATFORM_PROGRESS: void;
  DB_GET_LATEST_SYNC_RUN: StoredSyncRun | undefined;
  DB_GET_LAST_SUCCESSFUL_SYNC_AT: string | null;
  DB_GET_LATEST_METRICS: StoredOverviewMetrics[];
  DB_GET_EXPORT_DATA: FinancialBackupPayload;
  DB_LIST_FINANCIAL_DATA_PLATFORM_IDS: PlatformId[];
  DB_CREATE_FINANCIAL_BACKUP: FinancialBackupV1;
  DB_RESTORE_FINANCIAL_BACKUP: void;
  DB_INGEST_CONNECTOR_RESULT: IngestConnectorResultOutcome;
  DB_SAVE_CREDENTIALS: void;
  DB_GET_CREDENTIALS: StoredCredentials | undefined;
  DB_DELETE_CREDENTIALS: void;
  DB_LIST_CREDENTIAL_PLATFORM_IDS: PlatformId[];
  DB_LIST_CREDENTIAL_STATUS: CredentialStatusEntry[];
  DB_GET_INVISIBLE_KEY: string | undefined;
  DB_SET_INVISIBLE_KEY: void;
  DB_DELETE_INVISIBLE_KEY: void;
  DB_HAS_INVISIBLE_KEY: boolean;
  DB_LEARN_SELECTOR: void;
  DB_GET_SELECTOR_PROFILES: SelectorProfile[];
  DB_RESET_SELECTOR_PROFILES: void;
  DB_DELETE_SELECTOR_PROFILE: void;
  DB_LEARN_LOGIN_SELECTORS: void;
  DB_GET_LOGIN_SELECTOR_PROFILES: LoginSelectorProfile[];
  DB_MARK_SELECTOR_FAILURE: void;
  DB_LEARN_NAVIGATION_PROFILE: void;
  DB_GET_NAVIGATION_PROFILE: NavigationProfile | undefined;
  DB_MARK_NAVIGATION_FAILURE: void;
  DB_DELETE_NAVIGATION_PROFILE: void;
  DB_MARK_LOGIN_SELECTOR_FAILURES: void;
  DB_GET_METRICS_HISTORY: StoredMetricsSnapshot[];
  DB_UPDATE_METRICS_SNAPSHOT: void;
  DB_DELETE_METRICS_SNAPSHOT: void;
  DB_LOG_EXTRACTION_TELEMETRY: void;
  DB_GET_EXTRACTION_TELEMETRY: ExtractionTelemetryRecord[];
  DB_GET_SETTINGS: AppSettings;
  DB_SAVE_SETTINGS: void;
  DB_PRUNE_OLD_DATA: void;
  DB_CALCULATE_NET_ANNUAL_RETURN: number | null;
  DB_CLEANUP_STALE_SYNCS: void;
  DB_GET_PLATFORM_BATCH_HISTORY: StoredIngestionBatch[];
  DB_REVERT_PLATFORM_BATCH: void;
  DB_REVERT_REPLACED_INGESTION_BATCH: void;
}

export type DbProxyResponseData<T extends DbProxyMessageType> =
  DbProxyResponseMap[T];

export type DbProxyRequestByType<T extends DbProxyMessageType> = Extract<
  DbProxyRequest,
  { type: T }
>;

export type DbProxyResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function isDbProxyRequest(value: unknown): value is DbProxyRequest {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("DB_");
}
