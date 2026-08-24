import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformCatalogEntry, StoredSyncRun } from "../../src/shared/types/index.js";

const createSyncRunMock = vi.fn();
const updateSyncRunMock = vi.fn();
const updatePlatformProgressMock = vi.fn();
const getLatestSyncRunMock = vi.fn();
const getLatestMetricsMock = vi.fn();
const listFinancialDataPlatformIdsMock = vi.fn();
const listCredentialPlatformIdsMock = vi.fn();
const runSyncMock = vi.fn();
const cleanupStaleSyncRunsMock = vi.fn();
const clearPersistedPendingExtractionChoiceMock = vi.fn();
const getPersistedPendingExtractionChoiceMock = vi.fn();
const lockSessionMock = vi.fn();

const platform: PlatformCatalogEntry = {
  id: "mintos",
  name: "Mintos",
  enabled: true,
  strategy: "universal",
  domains: ["mintos.test"],
  login: {
    entryUrl: "https://mintos.test/login",
    usernameSelectors: ["#email"],
    passwordSelectors: ["#password"],
    submitSelectors: ["button"],
    otpSelectors: [],
    postLoginIndicators: [".dashboard"],
  },
  dashboard: {
    portfolioValueSelectors: [".portfolio"],
    freeCashSelectors: [".cash"],
    netAnnualReturnSelectors: [".yield"],
  },
};

function installChromeMocks() {
  const sessionStorage = new Map<string, unknown>();
  const onMessageAddListener = vi.fn();

  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: onMessageAddListener },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      getManifest: vi.fn(() => ({ version: "0.12.83" })),
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
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            sessionStorage.set(key, value);
          }
        }),
        remove: vi.fn(async (key: string) => {
          sessionStorage.delete(key);
        }),
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

describe("background CANCEL_SYNC_ALL handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installChromeMocks();

    createSyncRunMock.mockResolvedValue(undefined);
    updateSyncRunMock.mockResolvedValue(undefined);
    updatePlatformProgressMock.mockResolvedValue(undefined);
    getLatestMetricsMock.mockResolvedValue([]);
    listFinancialDataPlatformIdsMock.mockResolvedValue([]);
    listCredentialPlatformIdsMock.mockResolvedValue(["mintos"]);
    runSyncMock.mockImplementation(
      (
        runId: string,
        _platforms: PlatformCatalogEntry[],
        _stealth: boolean,
        _onEvent: unknown,
        signal?: AbortSignal,
      ) =>
        new Promise<void>((resolve) => {
          signal?.addEventListener(
            "abort",
            () => {
              void updatePlatformProgressMock(runId, "mintos", "cancelled");
              void updatePlatformProgressMock(runId, "debitum", "cancelled");
              resolve();
            },
            { once: true },
          );
        }),
    );
    cleanupStaleSyncRunsMock.mockResolvedValue(undefined);
    clearPersistedPendingExtractionChoiceMock.mockResolvedValue(undefined);
    getPersistedPendingExtractionChoiceMock.mockResolvedValue(undefined);
    lockSessionMock.mockResolvedValue(undefined);
    getLatestSyncRunMock.mockImplementation(async (): Promise<StoredSyncRun> => {
      const runId = createSyncRunMock.mock.calls[0]?.[0] as string | undefined;
      return {
        runId: runId ?? "run-1",
        state: "running",
        startedAt: "2026-06-08T10:00:00.000Z",
        platformProgress: {
          mintos: "running",
          debitum: "pending",
          peerberry: "success",
        },
      };
    });

    vi.doMock("../../src/shared/platforms/index.js", () => ({
      getPlatformCatalog: vi.fn(() => [platform]),
    }));
    vi.doMock("../../src/background/sync-targets.js", () => ({
      resolveSyncTargets: vi.fn(() => [platform]),
    }));
    vi.doMock("../../src/background/db-proxy.js", () => ({
      createSyncRun: (...args: unknown[]) => createSyncRunMock(...args),
      updateSyncRun: (...args: unknown[]) => updateSyncRunMock(...args),
      updatePlatformProgress: (...args: unknown[]) =>
        updatePlatformProgressMock(...args),
      getLatestSyncRun: () => getLatestSyncRunMock(),
      getLastSuccessfulSyncAt: vi.fn(async () => null),
      getLatestMetrics: () => getLatestMetricsMock(),
      getExportData: vi.fn(),
      createFinancialBackup: vi.fn(),
      listFinancialDataPlatformIds: () => listFinancialDataPlatformIdsMock(),
      getPlatformBatchHistory: vi.fn(),
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
      listCredentialPlatformIds: () => listCredentialPlatformIdsMock(),
      listCredentialStatus: vi.fn(async () => []),
      pruneOldData: vi.fn(),
    cleanupStaleSyncRuns: (...args: unknown[]) => cleanupStaleSyncRunsMock(...args),
      revertPlatformBatch: vi.fn(),
      restoreFinancialBackup: vi.fn(),
    }));
    vi.doMock("../../src/background/sync.js", () => ({
      runSync: (...args: unknown[]) => runSyncMock(...args),
    }));
    vi.doMock("../../src/shared/crypto/index.js", () => ({
      encrypt: vi.fn(),
      credentialAad: vi.fn((platformId: string, field: string) => `${platformId}:${field}`),
    }));
    vi.doMock("../../src/background/keystore.js", () => ({
      getEncryptionKey: vi.fn(async () => ({ key: "test-key" })),
      hasInvisibleKey: vi.fn(async () => false),
      initInvisibleKey: vi.fn(),
      hasMasterPassword: vi.fn(async () => false),
      lockSession: () => lockSessionMock(),
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
    vi.doMock("../../src/background/sync/extraction-choice-action.js", () => ({
      resolvePendingExtractionChoice: vi.fn(() => true),
      getPersistedPendingExtractionChoice: (...args: unknown[]) =>
        getPersistedPendingExtractionChoiceMock(...args),
      clearPersistedPendingExtractionChoice: (...args: unknown[]) =>
        clearPersistedPendingExtractionChoiceMock(...args),
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
      acquireOffscreenLease: vi.fn(async () => vi.fn(async () => undefined)),
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
      getDemoCredentialStatus: vi.fn(() => []),
      isDemoModeEnabled: false,
    }));
    vi.doMock("../../src/background/storage-migrations.js", () => ({
      runStorageMigrations: vi.fn(async () => ({ appliedVersions: [] })),
    }));
    vi.doMock("../../src/background/sync-reminder.js", () => ({
      getSyncingBadgeState: vi.fn(() => ({ text: "SYNC", title: "Syncing" })),
      getSyncReminderBadgeState: vi.fn(() => ({ text: "", title: "" })),
      SYNC_REMINDER_ALARM: "sync-reminder",
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
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("immediately cancels the active run and resets sync status", async () => {
    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    expect(typeof listener).toBe("function");

    const startResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: {} },
      { url: "chrome-extension://test/dashboard.html" },
      startResponse,
    );
    await settleAsyncWork();

    const runId = createSyncRunMock.mock.calls[0]?.[0] as string;
    const runSignal = runSyncMock.mock.calls[0]?.[4] as AbortSignal;
    expect(runId).toBeTruthy();
    expect(runSignal.aborted).toBe(false);

    const cancelResponse = vi.fn();
    listener(
      { type: "CANCEL_SYNC_ALL" },
      { url: "chrome-extension://test/dashboard.html" },
      cancelResponse,
    );
    await settleAsyncWork();

    expect(runSignal.aborted).toBe(true);
    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      runId,
      "mintos",
      "cancelled",
    );
    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      runId,
      "debitum",
      "cancelled",
    );
    expect(updatePlatformProgressMock).not.toHaveBeenCalledWith(
      runId,
      "peerberry",
      "cancelled",
    );
    expect(updateSyncRunMock).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({
        state: "cancelled",
        message: "Sync cancelled by user",
      }),
    );
    expect(chromeApi.storage.session.remove).toHaveBeenCalledWith("p2p_active_sync");
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "SYNC_PROGRESS",
      payload: expect.objectContaining({
        type: "sync_cancelled",
        runId,
      }),
    });
    expect(chromeApi.action.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
    expect(cancelResponse).toHaveBeenCalledWith({ success: true });
  });

  it("waits for the active sync task to settle before reporting cancel-all success", async () => {
    let releaseSyncTask: () => void = () => {};
    runSyncMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSyncTask = resolve;
        }),
    );
    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    listener(
      { type: "START_SYNC", payload: {} },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await settleAsyncWork();

    const cancelResponse = vi.fn();
    listener(
      { type: "CANCEL_SYNC_ALL" },
      { url: "chrome-extension://test/dashboard.html" },
      cancelResponse,
    );
    await settleAsyncWork();

    expect(cancelResponse).not.toHaveBeenCalled();

    releaseSyncTask();
    await settleAsyncWork();

    expect(cancelResponse).toHaveBeenCalledWith({ success: true });
  });

  it("cancels a claimed start while active-run lookup is still pending", async () => {
    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    let resolveActiveLookup: (value: Record<string, unknown>) => void = () => {};
    const sessionGetMock = chromeApi.storage.session
      .get as unknown as ReturnType<typeof vi.fn>;
    sessionGetMock.mockImplementationOnce(
      (_key: string) =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveActiveLookup = resolve;
        }),
    );

    const startResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: {} },
      { url: "chrome-extension://test/dashboard.html" },
      startResponse,
    );
    await Promise.resolve();

    const cancelResponse = vi.fn();
    listener(
      { type: "CANCEL_SYNC_ALL" },
      { url: "chrome-extension://test/dashboard.html" },
      cancelResponse,
    );
    await settleAsyncWork();

    expect(cancelResponse).toHaveBeenCalledWith({ success: true });
    expect(createSyncRunMock).not.toHaveBeenCalled();
    expect(runSyncMock).not.toHaveBeenCalled();

    resolveActiveLookup({});
    await settleAsyncWork();

    expect(startResponse).toHaveBeenCalledWith({
      error: "Sync cancelled by user",
    });
    expect(createSyncRunMock).not.toHaveBeenCalled();
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("cleans up orphaned running sync runs when no active session key exists", async () => {
    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    expect(typeof listener).toBe("function");

    const cancelResponse = vi.fn();
    listener(
      { type: "CANCEL_SYNC_ALL" },
      { url: "chrome-extension://test/dashboard.html" },
      cancelResponse,
    );
    await settleAsyncWork();

    expect(cleanupStaleSyncRunsMock).toHaveBeenCalled();
    expect(clearPersistedPendingExtractionChoiceMock).toHaveBeenCalled();
    expect(cancelResponse).toHaveBeenCalledWith({ success: true });
  });

  it("cancels an active sync before locking the session", async () => {
    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    listener(
      { type: "START_SYNC", payload: {} },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await settleAsyncWork();

    const runId = createSyncRunMock.mock.calls[0]?.[0] as string;
    const runSignal = runSyncMock.mock.calls[0]?.[4] as AbortSignal;
    expect(runSignal.aborted).toBe(false);

    const lockResponse = vi.fn();
    listener(
      { type: "LOCK" },
      { url: "chrome-extension://test/dashboard.html" },
      lockResponse,
    );
    await settleAsyncWork();

    expect(runSignal.aborted).toBe(true);
    expect(updateSyncRunMock).toHaveBeenCalledWith(
      runId,
      expect.objectContaining({
        state: "cancelled",
        message: "Sync cancelled by user",
      }),
    );
    expect(lockSessionMock).toHaveBeenCalled();
    expect(lockResponse).toHaveBeenCalledWith({ success: true });
  });
});
