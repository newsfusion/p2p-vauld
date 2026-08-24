import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredSyncRun } from "../../src/shared/types/index.js";

const getLatestSyncRunMock = vi.fn();
const cleanupStaleSyncRunsMock = vi.fn();
const clearPersistedPendingExtractionChoiceMock = vi.fn();
const getPersistedPendingExtractionChoiceMock = vi.fn();
const clearPersistedPendingManualActionMock = vi.fn();
const getPersistedPendingManualActionMock = vi.fn();
const hasMasterPasswordMock = vi.fn();
const resetSessionTimeoutMock = vi.fn();
const clearSessionTimeoutMock = vi.fn();
const lockSessionMock = vi.fn();
const setupMasterPasswordMock = vi.fn();
const saveSettingsMock = vi.fn();
const getSettingsMock = vi.fn();

function installChromeMocks() {
  const sessionStorage = new Map<string, unknown>();

  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      getManifest: vi.fn(() => ({ version: "0.12.106" })),
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
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("background GET_SYNC_STATUS recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installChromeMocks();

    cleanupStaleSyncRunsMock.mockResolvedValue(undefined);
    clearPersistedPendingExtractionChoiceMock.mockResolvedValue(undefined);
    getPersistedPendingExtractionChoiceMock.mockResolvedValue(undefined);
    clearPersistedPendingManualActionMock.mockResolvedValue(undefined);
    getPersistedPendingManualActionMock.mockResolvedValue(undefined);
    hasMasterPasswordMock.mockResolvedValue(false);
    resetSessionTimeoutMock.mockResolvedValue(undefined);
    clearSessionTimeoutMock.mockResolvedValue(undefined);
    lockSessionMock.mockResolvedValue(undefined);
    setupMasterPasswordMock.mockResolvedValue(undefined);
    saveSettingsMock.mockResolvedValue(undefined);
    getSettingsMock.mockResolvedValue({
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
    });

    vi.doMock("../../src/shared/platforms/index.js", () => ({
      getPlatformCatalog: vi.fn(() => []),
    }));
    vi.doMock("../../src/background/sync-targets.js", () => ({
      resolveSyncTargets: vi.fn(() => []),
    }));
    vi.doMock("../../src/background/db-proxy.js", () => ({
      createSyncRun: vi.fn(),
      updateSyncRun: vi.fn(),
      updatePlatformProgress: vi.fn(),
      getLatestSyncRun: () => getLatestSyncRunMock(),
      getLastSuccessfulSyncAt: vi.fn(async () => null),
      getLatestMetrics: vi.fn(async () => []),
      getExportData: vi.fn(),
      createFinancialBackup: vi.fn(),
      listFinancialDataPlatformIds: vi.fn(async () => []),
      getPlatformBatchHistory: vi.fn(),
      saveCredentials: vi.fn(),
      getCredentials: vi.fn(),
      deleteCredentials: vi.fn(),
      getSettings: (...args: unknown[]) => getSettingsMock(...args),
      saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
      listCredentialPlatformIds: vi.fn(async () => []),
      listCredentialStatus: vi.fn(async () => []),
      pruneOldData: vi.fn(),
      cleanupStaleSyncRuns: (...args: unknown[]) => cleanupStaleSyncRunsMock(...args),
      revertPlatformBatch: vi.fn(),
      restoreFinancialBackup: vi.fn(),
    }));
    vi.doMock("../../src/background/sync.js", () => ({
      runSync: vi.fn(),
    }));
    vi.doMock("../../src/shared/crypto/index.js", () => ({
      encrypt: vi.fn(),
      credentialAad: vi.fn((platformId: string, field: string) => `${platformId}:${field}`),
    }));
    vi.doMock("../../src/background/keystore.js", () => ({
      getEncryptionKey: vi.fn(async () => ({ key: "test-key" })),
      hasInvisibleKey: vi.fn(async () => false),
      initInvisibleKey: vi.fn(),
      hasMasterPassword: (...args: unknown[]) => hasMasterPasswordMock(...args),
      lockSession: (...args: unknown[]) => lockSessionMock(...args),
      setupMasterPassword: (...args: unknown[]) =>
        setupMasterPasswordMock(...args),
      unlockWithMasterPassword: vi.fn(async () => false),
      resetSessionTimeout: (...args: unknown[]) =>
        resetSessionTimeoutMock(...args),
      clearSessionTimeout: (...args: unknown[]) =>
        clearSessionTimeoutMock(...args),
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
      getPersistedPendingManualAction: (...args: unknown[]) =>
        getPersistedPendingManualActionMock(...args),
      clearPersistedPendingManualAction: (...args: unknown[]) =>
        clearPersistedPendingManualActionMock(...args),
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

  it("recovers orphaned running sync runs without an active session key", async () => {
    const failedRun: StoredSyncRun = {
      runId: "run-orphan",
      state: "failed",
      startedAt: "2026-06-09T07:00:00.000Z",
      finishedAt: "2026-06-09T07:05:00.000Z",
      message: "Sync interrupted by extension restart",
      platformProgress: { mintos: "failed_timeout" },
    };

    getLatestSyncRunMock
      .mockResolvedValueOnce({
        runId: "run-orphan",
        state: "running",
        startedAt: "2026-06-09T07:00:00.000Z",
        platformProgress: { mintos: "running" },
      })
      .mockResolvedValueOnce(failedRun);

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    const statusResponse = vi.fn();
    listener(
      { type: "GET_SYNC_STATUS" },
      { url: "chrome-extension://test/dashboard.html" },
      statusResponse,
    );
    await settleAsyncWork();

    expect(cleanupStaleSyncRunsMock).toHaveBeenCalled();
    expect(clearPersistedPendingExtractionChoiceMock).toHaveBeenCalled();
    expect(statusResponse).toHaveBeenCalledWith({
      run: failedRun,
      pendingChoice: undefined,
      pendingManualAction: undefined,
      queuedPlatformIds: [],
    });
  });

  it("broadcasts sync_failed when a tracked active sync run is recovered as failed", async () => {
    const failedRun: StoredSyncRun = {
      runId: "run-active",
      state: "failed",
      startedAt: "2026-06-09T07:00:00.000Z",
      finishedAt: "2026-06-09T07:05:00.000Z",
      message: "Sync interrupted by service worker restart",
      platformProgress: { mintos: "failed_timeout" },
    };

    getLatestSyncRunMock
      .mockResolvedValueOnce({
        runId: "run-active",
        state: "running",
        startedAt: "2026-06-09T07:00:00.000Z",
        platformProgress: { mintos: "running" },
      })
      .mockResolvedValueOnce(failedRun);

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    await chromeApi.storage.session.set({ p2p_active_sync: "run-active" });

    await import("../../src/background/index.js");

    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    const statusResponse = vi.fn();
    listener(
      { type: "GET_SYNC_STATUS" },
      { url: "chrome-extension://test/dashboard.html" },
      statusResponse,
    );
    await settleAsyncWork();

    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "SYNC_PROGRESS",
      payload: expect.objectContaining({
        type: "platform_error",
        platformId: "mintos",
        runId: "run-active",
        state: "failed_timeout",
      }),
    });
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: "SYNC_PROGRESS",
      payload: expect.objectContaining({
        type: "platform_cancelled",
        platformId: "mintos",
        runId: "run-active",
      }),
    });
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "SYNC_PROGRESS",
      payload: expect.objectContaining({
        type: "sync_failed",
        platformId: "",
        runId: "run-active",
      }),
    });
    expect(chromeApi.runtime.sendMessage).not.toHaveBeenCalledWith({
      type: "SYNC_PROGRESS",
      payload: expect.objectContaining({
        type: "sync_cancelled",
        runId: "run-active",
      }),
    });
    expect(statusResponse).toHaveBeenCalledWith({
      run: failedRun,
      pendingChoice: undefined,
      pendingManualAction: undefined,
      queuedPlatformIds: [],
    });
  });

  it("keeps the active sync key until tracked stale recovery cleanup finishes", async () => {
    const reachedCleanup = deferred();
    const releaseCleanup = deferred();
    clearPersistedPendingExtractionChoiceMock.mockImplementationOnce(
      async () => {
        reachedCleanup.resolve();
        await releaseCleanup.promise;
      },
    );
    getLatestSyncRunMock.mockResolvedValue({
      runId: "run-active",
      state: "running",
      startedAt: "2026-06-09T07:00:00.000Z",
      platformProgress: { mintos: "running" },
    });

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    await chromeApi.storage.session.set({ p2p_active_sync: "run-active" });

    await import("../../src/background/index.js");

    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    const statusResponse = vi.fn();
    listener(
      { type: "GET_SYNC_STATUS" },
      { url: "chrome-extension://test/dashboard.html" },
      statusResponse,
    );

    await reachedCleanup.promise;
    await expect(chromeApi.storage.session.get("p2p_active_sync")).resolves.toEqual({
      p2p_active_sync: "run-active",
    });
    expect(statusResponse).not.toHaveBeenCalled();

    releaseCleanup.resolve();
    await settleAsyncWork();

    await expect(chromeApi.storage.session.get("p2p_active_sync")).resolves.toEqual({
      p2p_active_sync: undefined,
    });
    expect(statusResponse).toHaveBeenCalledWith({
      run: expect.objectContaining({
        runId: "run-active",
        state: "running",
      }),
      pendingChoice: undefined,
      pendingManualAction: undefined,
      queuedPlatformIds: [],
    });
  });

  it("returns a persisted manual action for a running sync run", async () => {
    const runningRun: StoredSyncRun = {
      runId: "run-manual",
      state: "running",
      startedAt: "2026-06-09T07:00:00.000Z",
      platformProgress: { mintos: "running" },
    };
    const pendingManualAction = {
      requestId: "manual-1",
      runId: "run-manual",
      platformId: "mintos",
      platformName: "Mintos",
      actionType: "2fa" as const,
      expiresAt: "2026-06-09T07:05:00.000Z",
      message: "Enter the 2FA code in the dashboard",
    };

    getLatestSyncRunMock.mockResolvedValue(runningRun);
    getPersistedPendingManualActionMock.mockResolvedValue(pendingManualAction);

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    const statusResponse = vi.fn();
    listener(
      { type: "GET_SYNC_STATUS" },
      { url: "chrome-extension://test/dashboard.html" },
      statusResponse,
    );
    await settleAsyncWork();

    expect(getPersistedPendingManualActionMock).toHaveBeenCalled();
    expect(statusResponse).toHaveBeenCalledWith({
      run: runningRun,
      pendingChoice: undefined,
      pendingManualAction,
      queuedPlatformIds: [],
    });
  });

  it("does not reset auto-lock activity for passive sync status polling", async () => {
    hasMasterPasswordMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({
      privacyModeEnabled: false,
      stealthModeEnabled: true,
      debugModeEnabled: false,
      parallelSyncEnabled: false,
      disabledPlatformIds: [],
      language: "en",
      syncReminderDays: 7,
      autoLockEnabled: true,
      sessionTimeoutMinutes: 15,
      historyRetentionDays: 0,
      geminiActivationBannerDismissed: false,
    });
    getLatestSyncRunMock.mockResolvedValue(undefined);

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    listener(
      { type: "GET_SYNC_STATUS" },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await settleAsyncWork();

    expect(resetSessionTimeoutMock).not.toHaveBeenCalled();
  });

  it("resets auto-lock activity for explicit export actions", async () => {
    hasMasterPasswordMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({
      privacyModeEnabled: false,
      stealthModeEnabled: true,
      debugModeEnabled: false,
      parallelSyncEnabled: false,
      disabledPlatformIds: [],
      language: "en",
      syncReminderDays: 7,
      autoLockEnabled: true,
      sessionTimeoutMinutes: 15,
      historyRetentionDays: 0,
      geminiActivationBannerDismissed: false,
    });

    await import("../../src/background/index.js");

    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    listener(
      { type: "GET_EXPORT_DATA" },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await settleAsyncWork();

    expect(resetSessionTimeoutMock).toHaveBeenCalledWith(15);
  });

  it("resets enabled auto-lock and clears a pending timeout on extension activity", async () => {
    hasMasterPasswordMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({
      autoLockEnabled: true,
      sessionTimeoutMinutes: 15,
    });
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    await chromeApi.storage.session.set({ p2p_auto_lock_pending: true });

    await import("../../src/background/index.js");
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    const sendResponse = vi.fn();

    listener(
      { type: "SESSION_ACTIVITY" },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );
    await settleAsyncWork();

    expect(resetSessionTimeoutMock).toHaveBeenCalledWith(15);
    await expect(
      chromeApi.storage.session.get("p2p_auto_lock_pending"),
    ).resolves.toEqual({ p2p_auto_lock_pending: undefined });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("still routes activity messages when resetting the timer fails", async () => {
    hasMasterPasswordMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({
      autoLockEnabled: true,
      sessionTimeoutMinutes: 15,
    });

    await import("../../src/background/index.js");
    resetSessionTimeoutMock.mockRejectedValueOnce(new Error("alarm unavailable"));
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    const sendResponse = vi.fn();

    listener(
      { type: "SESSION_ACTIVITY" },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );
    await settleAsyncWork();

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("does not reset activity before manual locking", async () => {
    hasMasterPasswordMock.mockResolvedValue(true);
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await import("../../src/background/index.js");
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    const sendResponse = vi.fn();

    listener(
      { type: "LOCK" },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );
    await settleAsyncWork();

    expect(resetSessionTimeoutMock).not.toHaveBeenCalled();
    expect(lockSessionMock).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("defers timeout locking while a sync is active", async () => {
    hasMasterPasswordMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({
      autoLockEnabled: true,
      sessionTimeoutMinutes: 15,
    });
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    await chromeApi.storage.session.set({ p2p_active_sync: "run-1" });

    await import("../../src/background/index.js");
    const alarmListener = (
      chromeApi.alarms.onAlarm.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    alarmListener({ name: "session-timeout" });
    await settleAsyncWork();

    expect(lockSessionMock).not.toHaveBeenCalled();
    await expect(
      chromeApi.storage.session.get("p2p_auto_lock_pending"),
    ).resolves.toEqual({ p2p_auto_lock_pending: true });
  });

  it("locks and broadcasts when the timeout expires without an active sync", async () => {
    hasMasterPasswordMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({
      autoLockEnabled: true,
      sessionTimeoutMinutes: 15,
    });
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await import("../../src/background/index.js");
    const alarmListener = (
      chromeApi.alarms.onAlarm.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    alarmListener({ name: "session-timeout" });
    await settleAsyncWork();

    expect(lockSessionMock).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "LOCK_STATUS_CHANGED",
      payload: {
        locked: true,
        hasMasterPassword: true,
        reason: "timeout",
      },
    });
  });

  it("fails closed when timeout settings cannot be read", async () => {
    hasMasterPasswordMock.mockResolvedValue(true);
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await import("../../src/background/index.js");
    getSettingsMock.mockRejectedValueOnce(new Error("settings unavailable"));
    const alarmListener = (
      chromeApi.alarms.onAlarm.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    alarmListener({ name: "session-timeout" });
    await settleAsyncWork();

    expect(lockSessionMock).toHaveBeenCalledTimes(1);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "LOCK_STATUS_CHANGED",
      payload: {
        locked: true,
        hasMasterPassword: true,
        reason: "timeout",
      },
    });
  });

  it("rejects master-password migration while a sync is active", async () => {
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    await chromeApi.storage.session.set({ p2p_active_sync: "run-1" });

    await import("../../src/background/index.js");
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      { type: "SETUP_MASTER_PASSWORD", payload: { password: "x" } },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );
    await settleAsyncWork();

    expect(setupMasterPasswordMock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: "Wait for the current sync to finish before setting a master password.",
    });
  });

  it("enables the fifteen-minute timer after setting a master password", async () => {
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await import("../../src/background/index.js");
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    const sendResponse = vi.fn();
    listener(
      { type: "SETUP_MASTER_PASSWORD", payload: { password: "x" } },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );
    await settleAsyncWork();

    expect(setupMasterPasswordMock).toHaveBeenCalledWith("x");
    expect(saveSettingsMock).toHaveBeenCalledWith({
      autoLockEnabled: true,
      sessionTimeoutMinutes: 15,
    });
    expect(resetSessionTimeoutMock).toHaveBeenCalledWith(15);
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "LOCK_STATUS_CHANGED",
      payload: {
        locked: false,
        hasMasterPassword: true,
        reason: "setup",
      },
    });
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it("blocks sync startup while master-password migration is claimed", async () => {
    const migration = deferred();
    setupMasterPasswordMock.mockReturnValueOnce(migration.promise);
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await import("../../src/background/index.js");
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    const setupResponse = vi.fn();
    const syncResponse = vi.fn();

    listener(
      { type: "SETUP_MASTER_PASSWORD", payload: { password: "x" } },
      { url: "chrome-extension://test/dashboard.html" },
      setupResponse,
    );
    await settleAsyncWork();
    expect(setupMasterPasswordMock).toHaveBeenCalledTimes(1);

    listener(
      { type: "START_SYNC", payload: {} },
      { url: "chrome-extension://test/dashboard.html" },
      syncResponse,
    );
    await settleAsyncWork();

    expect(syncResponse).toHaveBeenCalledWith({
      error: "Security setup is in progress. Please try again shortly.",
    });
    expect(setupResponse).not.toHaveBeenCalled();

    migration.resolve();
    await settleAsyncWork();
    expect(setupResponse).toHaveBeenCalledWith({ success: true });
  });

  it("reports success after master-password commit when follow-up work fails", async () => {
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;

    await import("../../src/background/index.js");
    vi.mocked(chromeApi.storage.local.set).mockRejectedValueOnce(
      new Error("onboarding flag unavailable"),
    );
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    const sendResponse = vi.fn();

    listener(
      { type: "SETUP_MASTER_PASSWORD", payload: { password: "x" } },
      { url: "chrome-extension://test/dashboard.html" },
      sendResponse,
    );
    await settleAsyncWork();

    expect(setupMasterPasswordMock).toHaveBeenCalledWith("x");
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });
});
