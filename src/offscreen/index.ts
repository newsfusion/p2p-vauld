import {
  createSyncRun,
  updateSyncRun,
  updatePlatformProgress,
  getLatestSyncRun,
  getLastSuccessfulSyncAt,
  getLatestMetrics,
  getExportData,
  createFinancialBackup,
  listFinancialDataPlatformIds,
  restoreFinancialBackup,
  getPlatformBatchHistory,
  ingestConnectorResult,
  saveCredentials,
  getCredentials,
  deleteCredentials,
  listCredentialPlatformIds,
  listCredentialStatus,
  learnSelector,
  getSelectorProfiles,
  resetSelectorProfiles,
  deleteSelectorProfile,
  markSelectorFailure,
  learnNavigationProfile,
  getNavigationProfile,
  markNavigationFailure,
  deleteNavigationProfile,
  learnLoginSelectors,
  getLoginSelectorProfiles,
  markLoginSelectorFailures,
  getMetricsHistory,
  updateMetricsSnapshot,
  deleteMetricsSnapshot,
  logExtractionTelemetry,
  getExtractionTelemetry,
  getSettings,
  saveSettings,
  pruneOldData,
  revertPlatformBatch,
  revertReplacedIngestionBatch,
  calculateNetAnnualReturn,
  cleanupStaleSyncRuns,
} from "../shared/db/index.js";
import { getErrorMessage } from "../shared/error-utils.js";
import type {
  DbProxyMessageType,
  DbProxyRequest,
  DbProxyRequestByType,
  DbProxyResponse,
  DbProxyResponseData,
} from "../shared/db-messages.js";
import { isDbProxyRequest } from "../shared/db-messages.js";
import {
  isOffscreenControlMessage,
  type OffscreenStartHeartbeatMessage,
} from "../shared/offscreen-messages.js";
import { assertInternalSender } from "../background/sender-validation.js";
import {
  DbProxyRequestSchema,
  DbSaveSettingsPayloadSchema,
} from "../shared/validation.js";
import { createLogger } from "../shared/logger.js";
import {
  deleteStoredInvisibleKey,
  getStoredInvisibleKey,
  hasStoredInvisibleKey,
  setStoredInvisibleKey,
} from "./keystore-storage.js";

const log = createLogger("offscreen");

function errorMessage(error: unknown): string {
  return getErrorMessage(error);
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(message: OffscreenStartHeartbeatMessage): void {
  stopHeartbeat();
  const intervalMs = message.payload?.intervalMs ?? 20_000;
  heartbeatTimer = setInterval(() => {
    chrome.runtime
      .sendMessage({
        type: "OFFSCREEN_HEARTBEAT_TICK",
        payload: { timestamp: new Date().toISOString() },
      })
      .catch(() => {
        // Background may be restarting; keep the timer running.
      });
  }, intervalMs);
}

type DbHandler<T extends DbProxyMessageType> = (
  request: DbProxyRequestByType<T>,
) => Promise<DbProxyResponseData<T>> | DbProxyResponseData<T>;

type DbHandlerMap = {
  [TType in DbProxyMessageType]: DbHandler<TType>;
};

const dbHandlers: DbHandlerMap = {
  DB_CREATE_SYNC_RUN: (request) =>
    createSyncRun(request.payload.runId, request.payload.platformIds),
  DB_UPDATE_SYNC_RUN: (request) =>
    updateSyncRun(request.payload.runId, request.payload.update),
  DB_UPDATE_PLATFORM_PROGRESS: (request) =>
    updatePlatformProgress(
      request.payload.runId,
      request.payload.platformId,
      request.payload.state,
    ),
  DB_GET_LATEST_SYNC_RUN: () => getLatestSyncRun(),
  DB_GET_LAST_SUCCESSFUL_SYNC_AT: () => getLastSuccessfulSyncAt(),
  DB_GET_LATEST_METRICS: () => getLatestMetrics(),
  DB_GET_EXPORT_DATA: () => getExportData(),
  DB_LIST_FINANCIAL_DATA_PLATFORM_IDS: () => listFinancialDataPlatformIds(),
  DB_CREATE_FINANCIAL_BACKUP: (request) =>
    createFinancialBackup(
      request.payload.appVersion,
      request.payload.exportedAt,
    ),
  DB_RESTORE_FINANCIAL_BACKUP: (request) =>
    restoreFinancialBackup(
      request.payload.backup,
      request.payload.restoredAt,
    ),
  DB_INGEST_CONNECTOR_RESULT: (request) =>
    ingestConnectorResult(request.payload.result, request.payload.options),
  DB_SAVE_CREDENTIALS: (request) => saveCredentials(request.payload.credentials),
  DB_GET_CREDENTIALS: (request) => getCredentials(request.payload.platformId),
  DB_DELETE_CREDENTIALS: (request) => deleteCredentials(request.payload.platformId),
  DB_LIST_CREDENTIAL_PLATFORM_IDS: () => listCredentialPlatformIds(),
  DB_LIST_CREDENTIAL_STATUS: () => listCredentialStatus(),
  DB_GET_INVISIBLE_KEY: () => getStoredInvisibleKey(),
  DB_SET_INVISIBLE_KEY: (request) =>
    setStoredInvisibleKey(request.payload.keyBase64),
  DB_DELETE_INVISIBLE_KEY: () => deleteStoredInvisibleKey(),
  DB_HAS_INVISIBLE_KEY: () => hasStoredInvisibleKey(),
  DB_LEARN_SELECTOR: (request) => learnSelector(request.payload.profile),
  DB_GET_SELECTOR_PROFILES: (request) =>
    getSelectorProfiles(request.payload.platformId),
  DB_RESET_SELECTOR_PROFILES: (request) =>
    resetSelectorProfiles(request.payload.platformId),
  DB_DELETE_SELECTOR_PROFILE: (request) =>
    deleteSelectorProfile(request.payload.platformId, request.payload.signalKey),
  DB_MARK_SELECTOR_FAILURE: (request) =>
    markSelectorFailure(
      request.payload.platformId,
      request.payload.signalKey,
    ),
  DB_LEARN_NAVIGATION_PROFILE: (request) =>
    learnNavigationProfile(request.payload.profile),
  DB_GET_NAVIGATION_PROFILE: (request) =>
    getNavigationProfile(request.payload.platformId),
  DB_MARK_NAVIGATION_FAILURE: (request) =>
    markNavigationFailure(request.payload.platformId),
  DB_DELETE_NAVIGATION_PROFILE: (request) =>
    deleteNavigationProfile(request.payload.platformId),
  DB_LEARN_LOGIN_SELECTORS: (request) =>
    learnLoginSelectors(
      request.payload.platformId,
      request.payload.profiles,
    ),
  DB_GET_LOGIN_SELECTOR_PROFILES: (request) =>
    getLoginSelectorProfiles(request.payload.platformId),
  DB_MARK_LOGIN_SELECTOR_FAILURES: (request) =>
    markLoginSelectorFailures(
      request.payload.platformId,
      request.payload.fieldRoles,
    ),
  DB_GET_METRICS_HISTORY: (request) =>
    getMetricsHistory(
      request.payload.platformId,
      request.payload.limit,
    ),
  DB_UPDATE_METRICS_SNAPSHOT: (request) =>
    updateMetricsSnapshot(request.payload.platformId, request.payload.date, {
      platformValue: request.payload.platformValue,
      freeCash: request.payload.freeCash,
    }),
  DB_DELETE_METRICS_SNAPSHOT: (request) =>
    deleteMetricsSnapshot(request.payload.platformId, request.payload.date),
  DB_LOG_EXTRACTION_TELEMETRY: (request) =>
    logExtractionTelemetry(request.payload.record),
  DB_GET_EXTRACTION_TELEMETRY: (request) =>
    getExtractionTelemetry(
      request.payload.platformId,
      request.payload.limit,
    ),
  DB_GET_SETTINGS: () => getSettings(),
  DB_SAVE_SETTINGS: (request) => {
    const validated = DbSaveSettingsPayloadSchema.parse(request.payload);
    return saveSettings(validated.settings);
  },
  DB_PRUNE_OLD_DATA: (request) =>
    pruneOldData(request.payload?.historyRetentionDays),
  DB_CALCULATE_NET_ANNUAL_RETURN: (request) =>
    calculateNetAnnualReturn(request.payload.platformId),
  DB_CLEANUP_STALE_SYNCS: () => {
    log.debug("Received cleanup request for stale syncs");
    return cleanupStaleSyncRuns();
  },
  DB_GET_PLATFORM_BATCH_HISTORY: (request) =>
    getPlatformBatchHistory(request.payload.platformId),
  DB_REVERT_PLATFORM_BATCH: (request) =>
    revertPlatformBatch(request.payload.platformId, request.payload.batchId),
  DB_REVERT_REPLACED_INGESTION_BATCH: (request) =>
    revertReplacedIngestionBatch(
      request.payload.platformId,
      request.payload.rollback,
    ),
};

async function handleDbRequest<T extends DbProxyMessageType>(
  request: DbProxyRequestByType<T>,
): Promise<DbProxyResponseData<T>> {
  const handler = dbHandlers[request.type] as DbHandler<T>;
  return handler(request);
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isOffscreenControlMessage(message)) {
    // Control messages (start/stop heartbeat) should also be internal
    try {
      assertInternalSender(sender);
    } catch (error) {
      sendResponse({ ok: false, error: (error as Error).message });
      return false;
    }

    if (message.type === "OFFSCREEN_START_HEARTBEAT") {
      startHeartbeat(message);
    } else {
      stopHeartbeat();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (!isDbProxyRequest(message)) return false;

  // DB requests MUST be internal
  try {
    assertInternalSender(sender);
  } catch (error) {
    log.warn("Blocked unauthorized DB request");
    const response: DbProxyResponse<never> = {
      ok: false,
      error: errorMessage(error),
    };
    sendResponse(response);
    return false;
  }

  const parsed = DbProxyRequestSchema.safeParse(message);
  if (!parsed.success) {
    const response: DbProxyResponse<never> = {
      ok: false,
      error: parsed.error.message,
    };
    sendResponse(response);
    return false;
  }

  const request = parsed.data as DbProxyRequest;

  handleDbRequest(request)
    .then((data) => {
      const response: DbProxyResponse<unknown> = { ok: true, data };
      sendResponse(response);
    })
    .catch((error: unknown) => {
      const response: DbProxyResponse<never> = {
        ok: false,
        error: errorMessage(error),
      };
      sendResponse(response);
    });

  return true;
});
