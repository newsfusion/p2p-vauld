import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getLatestSyncRunMock = vi.fn();
const getLatestMetricsMock = vi.fn();
const getExportDataMock = vi.fn();
const createFinancialBackupMock = vi.fn();
const listFinancialDataPlatformIdsMock = vi.fn();
const revertPlatformBatchMock = vi.fn();
const restoreFinancialBackupMock = vi.fn();
const getMetricsHistoryMock = vi.fn();
const updateMetricsSnapshotMock = vi.fn();
const deleteMetricsSnapshotMock = vi.fn();

function installChromeMocks() {
  const onMessageAddListener = vi.fn();

  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: onMessageAddListener },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    },
    action: {
      onClicked: { addListener: vi.fn() },
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setTitle: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    },
    alarms: {
      onAlarm: { addListener: vi.fn() },
      create: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
      session: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue(undefined),
    },
    windows: {
      update: vi.fn().mockResolvedValue(undefined),
    },
  };

  return { onMessageAddListener };
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("background REVERT_PLATFORM_BATCH handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installChromeMocks();

    vi.doMock("../../src/shared/platforms/index.js", () => ({
      getPlatformCatalog: vi.fn(() => []),
    }));
    vi.doMock("../../src/shared/ai/gemini.js", () => ({
      checkGeminiAvailability: vi.fn(async () => ({ status: "unavailable" })),
      triggerGeminiDownload: vi.fn(),
    }));
    vi.doMock("../../src/shared/ai/provider.js", () => ({
      getPromptApiLanguageModel: vi.fn(() => undefined),
      PROMPT_API_TEXT_LANGUAGE_OPTIONS: [],
    }));
    vi.doMock("../../src/shared/logger.js", () => ({
      createLogger: vi.fn(() => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      })),
    }));
    vi.doMock("../../src/background/sync-targets.js", () => ({
      resolveSyncTargets: vi.fn(),
    }));
    vi.doMock("../../src/background/db-proxy.js", () => ({
      createSyncRun: vi.fn(),
      updateSyncRun: vi.fn(),
      updatePlatformProgress: vi.fn(),
      getLatestSyncRun: getLatestSyncRunMock,
      getLastSuccessfulSyncAt: vi.fn(async () => null),
      getLatestMetrics: getLatestMetricsMock,
      getExportData: getExportDataMock,
      createFinancialBackup: createFinancialBackupMock,
      listFinancialDataPlatformIds: listFinancialDataPlatformIdsMock,
      getPlatformBatchHistory: vi.fn(),
      getMetricsHistory: getMetricsHistoryMock,
      updateMetricsSnapshot: updateMetricsSnapshotMock,
      deleteMetricsSnapshot: deleteMetricsSnapshotMock,
      saveCredentials: vi.fn(),
      getCredentials: vi.fn(),
      deleteCredentials: vi.fn(),
      getSettings: vi.fn(async () => ({
        privacyModeEnabled: false,
        stealthModeEnabled: true,
        debugModeEnabled: false,
        parallelSyncEnabled: false,
        disabledPlatformIds: [],
        language: "en",
        syncReminderDays: 7,
        sessionTimeoutMinutes: 0,
        historyRetentionDays: 0,
        geminiActivationBannerDismissed: false,
      })),
      saveSettings: vi.fn(),
      listCredentialPlatformIds: vi.fn(async () => []),
      listCredentialStatus: vi.fn(async () => []),
      pruneOldData: vi.fn(),
      cleanupStaleSyncRuns: vi.fn(),
      revertPlatformBatch: revertPlatformBatchMock,
      restoreFinancialBackup: restoreFinancialBackupMock,
    }));
    vi.doMock("../../src/shared/crypto/index.js", () => ({
      encrypt: vi.fn(),
      credentialAad: vi.fn((platformId: string, field: string) => `${platformId}:${field}`),
    }));
    vi.doMock("../../src/background/keystore.js", () => ({
      getEncryptionKey: vi.fn(async () => null),
      hasInvisibleKey: vi.fn(async () => false),
      initInvisibleKey: vi.fn(),
      hasMasterPassword: vi.fn(async () => false),
      lockSession: vi.fn(),
      setupMasterPassword: vi.fn(),
      unlockWithMasterPassword: vi.fn(async () => false),
      resetSessionTimeout: vi.fn(),
      SESSION_TIMEOUT_ALARM_NAME: "session-timeout",
    }));
    vi.doMock("../../src/background/credential-prefill.js", () => ({
      clearCredentialPrefill: vi.fn(async () => undefined),
      getCredentialPrefill: vi.fn(async () => ""),
      removeUnsafeCredentialPrefill: vi.fn(async () => undefined),
      saveCredentialPrefill: vi.fn(),
    }));
    vi.doMock("../../src/background/sender-validation.js", () => ({
      assertBackgroundMessageSender: vi.fn(),
    }));
    vi.doMock("../../src/background/sync.js", () => ({
      runSync: vi.fn(),
    }));
    vi.doMock("../../src/background/sync/extraction-choice-action.js", () => ({
      resolvePendingExtractionChoice: vi.fn(async () => true),
      getPersistedPendingExtractionChoice: vi.fn(async () => undefined),
      clearPersistedPendingExtractionChoice: vi.fn(async () => undefined),
    }));
    vi.doMock("../../src/background/sync/manual-action.js", () => ({
      resolvePendingManualAction: vi.fn(async () => true),
      getPersistedPendingManualAction: vi.fn(async () => undefined),
      clearPersistedPendingManualAction: vi.fn(async () => undefined),
    }));
    vi.doMock("../../src/background/platform-modes.js", () => ({
      updateStoredPlatformModes: vi.fn(),
    }));
    vi.doMock("../../src/background/offscreen-manager.js", () => ({
      acquireOffscreenLease: vi.fn(),
      closeManagedOffscreenDocumentIfIdle: vi.fn(),
      startOffscreenHeartbeat: vi.fn(),
      stopOffscreenHeartbeat: vi.fn(),
    }));
    vi.doMock("../../src/background/demo-clock.js", () => ({
      createDemoTimestampProvider: vi.fn(),
      reserveNextDemoSyncIndex: vi.fn(),
    }));
    vi.doMock("../../src/shared/demo.js", () => ({
      DEMO_PLATFORM_IDS: [],
      getDemoCredentialStatus: vi.fn(async () => []),
      isDemoModeEnabled: vi.fn(async () => false),
    }));
    vi.doMock("../../src/background/storage-migrations.js", () => ({
      runStorageMigrations: vi.fn(async () => ({ appliedVersions: [] })),
    }));
    vi.doMock("../../src/background/sync-reminder.js", () => ({
      getSyncingBadgeState: vi.fn(() => ({ text: "", title: "" })),
      getSyncReminderBadgeState: vi.fn(() => ({ text: "", title: "" })),
      SYNC_REMINDER_ALARM: "sync-reminder",
    }));
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("returns a typed failure response when reverting a batch throws", async () => {
    getLatestSyncRunMock.mockResolvedValue(undefined);
    revertPlatformBatchMock.mockRejectedValue(
      new Error("Only the latest import can be reverted"),
    );

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as Record<string, any>).chrome;
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    expect(typeof listener).toBe("function");

    const sendResponse = vi.fn();
    const keepChannelOpen = listener(
      {
        type: "REVERT_PLATFORM_BATCH",
        payload: { platformId: "mintos", batchId: 70 },
      },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );

    expect(keepChannelOpen).toBe(true);
    await settleAsyncWork();

    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: "Only the latest import can be reverted",
    });
  });

  it("waits for the metrics broadcast before confirming a reverted batch", async () => {
    const metrics = [
      {
        platformId: "mintos",
        fetchedAt: "2026-06-08T10:00:00.000Z",
        platformValue: 1100,
        freeCash: 30,
        currency: "EUR",
        confidence: 1,
      },
    ];
    let resolveBroadcast: () => void = () => undefined;
    const broadcastSettled = new Promise<void>((resolve) => {
      resolveBroadcast = resolve;
    });
    getLatestSyncRunMock.mockResolvedValue(undefined);
    revertPlatformBatchMock.mockResolvedValue(undefined);
    getLatestMetricsMock.mockResolvedValue(metrics);
    listFinancialDataPlatformIdsMock.mockResolvedValue(["mintos"]);

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as Record<string, any>).chrome;
    chromeApi.runtime.sendMessage.mockReturnValueOnce(broadcastSettled);
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      {
        type: "REVERT_PLATFORM_BATCH",
        payload: { platformId: "mintos", batchId: 70 },
      },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );

    await settleAsyncWork();

    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "METRICS_UPDATED",
      payload: { metrics, dataPlatformIds: ["mintos"] },
    });
    expect(sendResponse).not.toHaveBeenCalled();

    resolveBroadcast();
    await settleAsyncWork();

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("updates a metrics snapshot and broadcasts refreshed metrics", async () => {
    const metrics = [
      {
        platformId: "mintos",
        fetchedAt: "2026-06-08T10:00:00.000Z",
        platformValue: 1100,
        freeCash: 30,
        currency: "EUR",
        confidence: 1,
      },
    ];
    getLatestSyncRunMock.mockResolvedValue(undefined);
    updateMetricsSnapshotMock.mockResolvedValue(undefined);
    getLatestMetricsMock.mockResolvedValue(metrics);
    listFinancialDataPlatformIdsMock.mockResolvedValue(["mintos"]);

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as Record<string, any>).chrome;
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      {
        type: "UPDATE_METRICS_SNAPSHOT",
        payload: {
          platformId: "mintos",
          date: "2026-06-08",
          platformValue: 1100,
          freeCash: 30,
        },
      },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );

    await settleAsyncWork();

    expect(updateMetricsSnapshotMock).toHaveBeenCalledWith("mintos", "2026-06-08", {
      platformValue: 1100,
      freeCash: 30,
    });
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "METRICS_UPDATED",
      payload: { metrics, dataPlatformIds: ["mintos"] },
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("refuses to edit history while the platform is syncing", async () => {
    getLatestSyncRunMock.mockResolvedValue({
      runId: "run-1",
      state: "running",
      startedAt: "2026-06-08T09:00:00.000Z",
      platformProgress: { mintos: "running" },
    });

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as Record<string, any>).chrome;
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      {
        type: "UPDATE_METRICS_SNAPSHOT",
        payload: {
          platformId: "mintos",
          date: "2026-06-08",
          platformValue: 1100,
          freeCash: 30,
        },
      },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );

    await settleAsyncWork();

    expect(updateMetricsSnapshotMock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: "Cannot edit history while this platform is syncing",
    });
  });

  it("deletes a metrics snapshot and broadcasts refreshed metrics", async () => {
    getLatestSyncRunMock.mockResolvedValue(undefined);
    deleteMetricsSnapshotMock.mockResolvedValue(undefined);
    getLatestMetricsMock.mockResolvedValue([]);
    listFinancialDataPlatformIdsMock.mockResolvedValue([]);

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as Record<string, any>).chrome;
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      {
        type: "DELETE_METRICS_SNAPSHOT",
        payload: { platformId: "mintos", date: "2026-06-08" },
      },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );

    await settleAsyncWork();

    expect(deleteMetricsSnapshotMock).toHaveBeenCalledWith("mintos", "2026-06-08");
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "METRICS_UPDATED",
      payload: { metrics: [], dataPlatformIds: [] },
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("rejects financial restore while a sync is active", async () => {
    getLatestSyncRunMock.mockResolvedValue({
      runId: "run-1",
      state: "running",
      startedAt: "2026-06-08T09:00:00.000Z",
      platformProgress: { mintos: "running" },
    });

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as Record<string, any>).chrome;
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      {
        type: "RESTORE_FINANCIAL_BACKUP",
        payload: {
          backup: {
            format: "p2p-portfolio-tracker-financial-backup",
            version: 1,
            exportedAt: "2026-06-08T10:00:00.000Z",
            appVersion: "0.12.75",
            payload: {
              overviewMetrics: [],
              metricsHistory: [],
              cashflows: [],
              positions: [],
              riskEvents: [],
              deltaLogs: [],
            },
          },
        },
      },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );

    await settleAsyncWork();

    expect(restoreFinancialBackupMock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: "Cannot restore a backup while sync is running",
    });
  });

  it("restores a financial backup and broadcasts refreshed metrics", async () => {
    const metrics = [
      {
        platformId: "mintos",
        fetchedAt: "2026-06-08T10:00:00.000Z",
        platformValue: 1000,
        freeCash: 25,
        currency: "EUR",
        confidence: 0.9,
      },
    ];
    getLatestSyncRunMock.mockResolvedValue(undefined);
    restoreFinancialBackupMock.mockResolvedValue(undefined);
    getLatestMetricsMock.mockResolvedValue(metrics);
    listFinancialDataPlatformIdsMock.mockResolvedValue(["mintos"]);

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as Record<string, any>).chrome;
    const listener = chromeApi.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      {
        type: "RESTORE_FINANCIAL_BACKUP",
        payload: {
          backup: {
            format: "p2p-portfolio-tracker-financial-backup",
            version: 1,
            exportedAt: "2026-06-08T10:00:00.000Z",
            appVersion: "0.12.75",
            payload: {
              overviewMetrics: metrics,
              metricsHistory: [],
              cashflows: [],
              positions: [],
              riskEvents: [],
              deltaLogs: [],
            },
          },
        },
      },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );

    await settleAsyncWork();

    expect(restoreFinancialBackupMock).toHaveBeenCalled();
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "METRICS_UPDATED",
      payload: { metrics, dataPlatformIds: ["mintos"] },
    });
    expect(sendResponse).toHaveBeenCalledWith({
      success: true,
      metrics,
      dataPlatformIds: ["mintos"],
    });
  });
});
