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
  ExtractionChoiceSignalKey,
  ExtractionTelemetryRecord,
  PlatformId,
  ReplacedIngestionBatchRollback,
  SelectorProfile,
  PlatformSyncState,
  StoredCredentials,
  StoredIngestionBatch,
  StoredMetricsSnapshot,
  StoredOverviewMetrics,
  StoredSyncRun,
} from "../shared/types/index.js";
import type {
  DbProxyMessageType,
  DbProxyRequestByType,
  DbProxyResponse,
  DbProxyResponseData,
  SyncRunUpdate,
} from "../shared/db-messages.js";
import { withOffscreenLease } from "./offscreen-manager.js";
import { createLogger } from "../shared/logger.js";

const log = createLogger("db-proxy");

async function sendDbRequest<T extends DbProxyMessageType>(
  request: DbProxyRequestByType<T>,
): Promise<DbProxyResponseData<T>> {
  const response = await withOffscreenLease("db", async () => {
    return (await chrome.runtime.sendMessage(request)) as
      | DbProxyResponse<DbProxyResponseData<T>>
      | undefined;
  });

  if (!response || typeof response !== "object" || !("ok" in response)) {
    throw new Error(`Invalid DB proxy response for ${request.type}`);
  }

  if (!response.ok) {
    throw new Error(response.error);
  }

  return response.data;
}

export async function createSyncRun(
  runId: string,
  platformIds: PlatformId[],
): Promise<number> {
  return sendDbRequest({
    type: "DB_CREATE_SYNC_RUN",
    payload: { runId, platformIds },
  });
}

export async function updateSyncRun(
  runId: string,
  update: SyncRunUpdate,
): Promise<void> {
  return sendDbRequest({
    type: "DB_UPDATE_SYNC_RUN",
    payload: { runId, update },
  });
}

export async function updatePlatformProgress(
  runId: string,
  platformId: PlatformId,
  state: PlatformSyncState,
): Promise<void> {
  return sendDbRequest({
    type: "DB_UPDATE_PLATFORM_PROGRESS",
    payload: { runId, platformId, state },
  });
}

export async function getLatestSyncRun(): Promise<StoredSyncRun | undefined> {
  return sendDbRequest({ type: "DB_GET_LATEST_SYNC_RUN" });
}

export async function getLastSuccessfulSyncAt(): Promise<string | null> {
  return sendDbRequest({ type: "DB_GET_LAST_SUCCESSFUL_SYNC_AT" });
}

export async function getLatestMetrics(): Promise<StoredOverviewMetrics[]> {
  return sendDbRequest({ type: "DB_GET_LATEST_METRICS" });
}

export async function getExportData(): Promise<FinancialBackupPayload> {
  return sendDbRequest({ type: "DB_GET_EXPORT_DATA" });
}

export async function listFinancialDataPlatformIds(): Promise<PlatformId[]> {
  return sendDbRequest({ type: "DB_LIST_FINANCIAL_DATA_PLATFORM_IDS" });
}

export async function createFinancialBackup(
  appVersion: string,
  exportedAt?: string,
): Promise<FinancialBackupV1> {
  return sendDbRequest({
    type: "DB_CREATE_FINANCIAL_BACKUP",
    payload:
      exportedAt === undefined ? { appVersion } : { appVersion, exportedAt },
  });
}

export async function restoreFinancialBackup(
  backup: FinancialBackupV1,
  restoredAt?: string,
): Promise<void> {
  return sendDbRequest({
    type: "DB_RESTORE_FINANCIAL_BACKUP",
    payload:
      restoredAt === undefined ? { backup } : { backup, restoredAt },
  });
}

export async function ingestConnectorResult(
  result: ConnectorSyncResult,
  options?: IngestConnectorResultOptions,
): Promise<IngestConnectorResultOutcome> {
  return sendDbRequest({
    type: "DB_INGEST_CONNECTOR_RESULT",
    payload: { result, ...(options ? { options } : {}) },
  });
}

export async function saveCredentials(
  credentials: StoredCredentials,
): Promise<void> {
  return sendDbRequest({
    type: "DB_SAVE_CREDENTIALS",
    payload: { credentials },
  });
}

export async function getCredentials(
  platformId: PlatformId,
): Promise<StoredCredentials | undefined> {
  return sendDbRequest({
    type: "DB_GET_CREDENTIALS",
    payload: { platformId },
  });
}

export async function deleteCredentials(platformId: PlatformId): Promise<void> {
  return sendDbRequest({
    type: "DB_DELETE_CREDENTIALS",
    payload: { platformId },
  });
}

export async function listCredentialPlatformIds(): Promise<PlatformId[]> {
  return sendDbRequest({ type: "DB_LIST_CREDENTIAL_PLATFORM_IDS" });
}

export async function listCredentialStatus(): Promise<CredentialStatusEntry[]> {
  return sendDbRequest({ type: "DB_LIST_CREDENTIAL_STATUS" });
}

export async function getStoredInvisibleKey(): Promise<string | undefined> {
  return sendDbRequest({ type: "DB_GET_INVISIBLE_KEY" });
}

export async function setStoredInvisibleKey(keyBase64: string): Promise<void> {
  return sendDbRequest({
    type: "DB_SET_INVISIBLE_KEY",
    payload: { keyBase64 },
  });
}

export async function deleteStoredInvisibleKey(): Promise<void> {
  return sendDbRequest({ type: "DB_DELETE_INVISIBLE_KEY" });
}

export async function hasStoredInvisibleKey(): Promise<boolean> {
  return sendDbRequest({ type: "DB_HAS_INVISIBLE_KEY" });
}

export async function learnSelector(profile: SelectorProfile): Promise<void> {
  return sendDbRequest({
    type: "DB_LEARN_SELECTOR",
    payload: { profile },
  });
}

export async function getSelectorProfiles(
  platformId: PlatformId,
): Promise<SelectorProfile[]> {
  return sendDbRequest({
    type: "DB_GET_SELECTOR_PROFILES",
    payload: { platformId },
  });
}

export async function resetSelectorProfiles(platformId: PlatformId): Promise<void> {
  return sendDbRequest({
    type: "DB_RESET_SELECTOR_PROFILES",
    payload: { platformId },
  });
}

export async function deleteSelectorProfile(
  platformId: PlatformId,
  signalKey: ExtractionChoiceSignalKey,
): Promise<void> {
  return sendDbRequest({
    type: "DB_DELETE_SELECTOR_PROFILE",
    payload: { platformId, signalKey },
  });
}

export async function markSelectorFailure(
  platformId: PlatformId,
  signalKey: ExtractionChoiceSignalKey,
): Promise<void> {
  return sendDbRequest({
    type: "DB_MARK_SELECTOR_FAILURE",
    payload: { platformId, signalKey },
  });
}

export async function learnNavigationProfile(
  profile: NavigationProfile,
): Promise<void> {
  return sendDbRequest({
    type: "DB_LEARN_NAVIGATION_PROFILE",
    payload: { profile },
  });
}

export async function getNavigationProfile(
  platformId: PlatformId,
): Promise<NavigationProfile | undefined> {
  return sendDbRequest({
    type: "DB_GET_NAVIGATION_PROFILE",
    payload: { platformId },
  });
}

export async function markNavigationFailure(
  platformId: PlatformId,
): Promise<void> {
  return sendDbRequest({
    type: "DB_MARK_NAVIGATION_FAILURE",
    payload: { platformId },
  });
}

export async function deleteNavigationProfile(
  platformId: PlatformId,
): Promise<void> {
  return sendDbRequest({
    type: "DB_DELETE_NAVIGATION_PROFILE",
    payload: { platformId },
  });
}

export async function learnLoginSelectors(
  platformId: PlatformId,
  profiles: LoginSelectorProfile[],
): Promise<void> {
  return sendDbRequest({
    type: "DB_LEARN_LOGIN_SELECTORS",
    payload: { platformId, profiles },
  });
}

export async function getLoginSelectorProfiles(
  platformId: PlatformId,
): Promise<LoginSelectorProfile[]> {
  return sendDbRequest({
    type: "DB_GET_LOGIN_SELECTOR_PROFILES",
    payload: { platformId },
  });
}

export async function markLoginSelectorFailures(
  platformId: PlatformId,
  fieldRoles: LoginFieldRole[],
): Promise<void> {
  return sendDbRequest({
    type: "DB_MARK_LOGIN_SELECTOR_FAILURES",
    payload: { platformId, fieldRoles },
  });
}

export async function getSettings(): Promise<AppSettings> {
  return sendDbRequest({ type: "DB_GET_SETTINGS" });
}

export async function getMetricsHistory(
  platformId: PlatformId,
  limit?: number,
): Promise<StoredMetricsSnapshot[]> {
  return sendDbRequest({
    type: "DB_GET_METRICS_HISTORY",
    payload: limit === undefined ? { platformId } : { platformId, limit },
  });
}

export async function updateMetricsSnapshot(
  platformId: PlatformId,
  date: string,
  update: { platformValue: number; freeCash: number },
): Promise<void> {
  return sendDbRequest({
    type: "DB_UPDATE_METRICS_SNAPSHOT",
    payload: { platformId, date, ...update },
  });
}

export async function deleteMetricsSnapshot(
  platformId: PlatformId,
  date: string,
): Promise<void> {
  return sendDbRequest({
    type: "DB_DELETE_METRICS_SNAPSHOT",
    payload: { platformId, date },
  });
}

export async function logExtractionTelemetry(
  record: ExtractionTelemetryRecord,
): Promise<void> {
  return sendDbRequest({
    type: "DB_LOG_EXTRACTION_TELEMETRY",
    payload: { record },
  });
}

export async function getExtractionTelemetry(
  platformId: PlatformId,
  limit?: number,
): Promise<ExtractionTelemetryRecord[]> {
  return sendDbRequest({
    type: "DB_GET_EXTRACTION_TELEMETRY",
    payload: limit === undefined ? { platformId } : { platformId, limit },
  });
}

export async function saveSettings(
  settings: Partial<AppSettings>,
): Promise<void> {
  return sendDbRequest({
    type: "DB_SAVE_SETTINGS",
    payload: { settings },
  });
}

export async function pruneOldData(historyRetentionDays = 0): Promise<void> {
  return sendDbRequest({
    type: "DB_PRUNE_OLD_DATA",
    payload: { historyRetentionDays },
  });
}

export async function calculateNetAnnualReturn(
  platformId: PlatformId,
): Promise<number | null> {
  return sendDbRequest({
    type: "DB_CALCULATE_NET_ANNUAL_RETURN",
    payload: { platformId },
  });
}

export async function cleanupStaleSyncRuns(): Promise<void> {
  log.debug("Requesting stale sync cleanup from offscreen");
  return sendDbRequest({ type: "DB_CLEANUP_STALE_SYNCS" });
}

export async function getPlatformBatchHistory(
  platformId: PlatformId,
): Promise<StoredIngestionBatch[]> {
  return sendDbRequest({
    type: "DB_GET_PLATFORM_BATCH_HISTORY",
    payload: { platformId },
  });
}

export async function revertPlatformBatch(
  platformId: PlatformId,
  batchId: number,
): Promise<void> {
  return sendDbRequest({
    type: "DB_REVERT_PLATFORM_BATCH",
    payload: { platformId, batchId },
  });
}

export async function revertReplacedIngestionBatch(
  platformId: PlatformId,
  rollback: ReplacedIngestionBatchRollback,
): Promise<void> {
  return sendDbRequest({
    type: "DB_REVERT_REPLACED_INGESTION_BATCH",
    payload: { platformId, rollback },
  });
}
