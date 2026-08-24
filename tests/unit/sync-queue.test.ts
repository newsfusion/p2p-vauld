import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlatformCatalogEntry,
  PlatformId,
  PlatformSyncState,
  StoredSyncRun,
  SyncEvent,
} from "../../src/shared/types/index.js";

const createSyncRunMock = vi.fn();
const updateSyncRunMock = vi.fn();
const updatePlatformProgressMock = vi.fn();
const getLatestSyncRunMock = vi.fn();
const runSyncMock = vi.fn();
const acquireOffscreenLeaseMock = vi.fn();
const getSettingsMock = vi.fn();

const platforms: PlatformCatalogEntry[] = [
  {
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
  },
  {
    id: "peerberry",
    name: "PeerBerry",
    enabled: true,
    strategy: "universal",
    domains: ["peerberry.test"],
    login: {
      entryUrl: "https://peerberry.test/login",
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
  },
];

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
      getManifest: vi.fn(() => ({ version: "0.12.117" })),
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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settleAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return;
    await settleAsyncWork();
  }
  throw new Error("Timed out waiting for condition");
}

describe("background sync queue", () => {
  let currentRun: StoredSyncRun | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installChromeMocks();
    currentRun = undefined;
    acquireOffscreenLeaseMock.mockResolvedValue(vi.fn(async () => undefined));

    createSyncRunMock.mockImplementation(async (runId: string, ids: PlatformId[]) => {
      currentRun = {
        runId,
        state: "queued",
        startedAt: "2026-06-17T10:00:00.000Z",
        platformProgress: Object.fromEntries(
          ids.map((id) => [id, "pending" satisfies PlatformSyncState]),
        ),
      };
    });
    updateSyncRunMock.mockImplementation(
      async (runId: string, update: Partial<StoredSyncRun>) => {
        if (currentRun?.runId !== runId) return;
        currentRun = { ...currentRun, ...update };
      },
    );
    updatePlatformProgressMock.mockImplementation(
      async (
        runId: string,
        platformId: PlatformId,
        state: PlatformSyncState,
      ) => {
        if (currentRun?.runId !== runId) return;
        currentRun = {
          ...currentRun,
          platformProgress: {
            ...currentRun.platformProgress,
            [platformId]: state,
          },
        };
      },
    );
    getLatestSyncRunMock.mockImplementation(async () => currentRun);
    getSettingsMock.mockImplementation(async () => ({
      privacyModeEnabled: false,
      stealthModeEnabled: false,
      debugModeEnabled: false,
      parallelSyncEnabled: false,
      disabledPlatformIds: [],
      language: "en",
      syncReminderDays: 7,
      sessionTimeoutMinutes: 0,
      historyRetentionDays: 0,
      geminiActivationBannerDismissed: false,
    }));

    vi.doMock("../../src/shared/platforms/index.js", () => ({
      getPlatformCatalog: vi.fn(() => platforms),
    }));
    vi.doMock("../../src/background/sync-targets.js", () => ({
      resolveSyncTargets: vi.fn(
        ({
          requestedPlatformIds,
        }: {
          requestedPlatformIds?: PlatformId[];
        }) =>
          requestedPlatformIds === undefined
            ? platforms
            : platforms.filter((platform) =>
                requestedPlatformIds.includes(platform.id),
              ),
      ),
    }));
    vi.doMock("../../src/background/db-proxy.js", () => ({
      createSyncRun: (...args: unknown[]) => createSyncRunMock(...args),
      updateSyncRun: (...args: unknown[]) => updateSyncRunMock(...args),
      updatePlatformProgress: (...args: unknown[]) =>
        updatePlatformProgressMock(...args),
      getLatestSyncRun: () => getLatestSyncRunMock(),
      getLastSuccessfulSyncAt: vi.fn(async () => null),
      getLatestMetrics: vi.fn(async () => []),
      getExportData: vi.fn(),
      createFinancialBackup: vi.fn(),
      listFinancialDataPlatformIds: vi.fn(async () => []),
      getPlatformBatchHistory: vi.fn(),
      getMetricsHistory: vi.fn(),
      updateMetricsSnapshot: vi.fn(),
      deleteMetricsSnapshot: vi.fn(),
      saveCredentials: vi.fn(),
      getCredentials: vi.fn(),
      deleteCredentials: vi.fn(),
      resetSelectorProfiles: vi.fn(),
      getSettings: () => getSettingsMock(),
      saveSettings: vi.fn(),
      listCredentialPlatformIds: vi.fn(async () =>
        platforms.map((platform) => platform.id),
      ),
      listCredentialStatus: vi.fn(async () => []),
      pruneOldData: vi.fn(),
      cleanupStaleSyncRuns: vi.fn(),
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
    vi.doMock("../../src/background/sync/extraction-choice-action.js", () => ({
      resolvePendingExtractionChoice: vi.fn(() => true),
      getPersistedPendingExtractionChoice: vi.fn(async () => undefined),
      clearPersistedPendingExtractionChoice: vi.fn(async () => undefined),
    }));
    vi.doMock("../../src/background/sync/manual-action.js", () => ({
      resolvePendingManualAction: vi.fn(async () => true),
      getPersistedPendingManualAction: vi.fn(async () => undefined),
      clearPersistedPendingManualAction: vi.fn(async () => undefined),
    }));
    vi.doMock("../../src/background/sync/manual-action-notify.js", () => ({
      focusTabForNotification: vi.fn(),
    }));
    vi.doMock("../../src/background/platform-modes.js", () => ({
      updateStoredPlatformModes: vi.fn(),
    }));
    vi.doMock("../../src/background/offscreen-manager.js", () => ({
      acquireOffscreenLease: (...args: unknown[]) =>
        acquireOffscreenLeaseMock(...args),
      closeManagedOffscreenDocumentIfIdle: vi.fn(),
      startOffscreenHeartbeat: vi.fn(),
      stopOffscreenHeartbeat: vi.fn(),
    }));
    vi.doMock("../../src/background/demo-clock.js", () => ({
      createDemoTimestampProvider: vi.fn(() => () => "2026-06-17T10:00:00.000Z"),
      reserveNextDemoSyncIndex: vi.fn(async () => 0),
    }));
    vi.doMock("../../src/shared/demo.js", () => ({
      getDemoCredentialStatus: vi.fn(() => []),
      isDemoModeEnabled: false,
    }));
    vi.doMock("../../src/background/demo-cohorts.js", () => ({
      getActiveDemoPlatformIds: vi.fn(async () => []),
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

  async function loadMessageListener() {
    await import("../../src/background/index.js");
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    expect(typeof listener).toBe("function");
    return {
      chromeApi,
      listener: listener as (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => void,
    };
  }

  async function loadActionClickListener() {
    await import("../../src/background/index.js");
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.action.onClicked.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    expect(typeof listener).toBe("function");
    return { chromeApi, listener: listener as () => void };
  }

  it("opens the dashboard from the toolbar when no dashboard tab exists", async () => {
    const { chromeApi, listener } = await loadActionClickListener();

    listener();
    await settleAsyncWork();

    expect(chromeApi.tabs.query).toHaveBeenCalledWith({
      url: "chrome-extension://test/dashboard.html*",
    });
    expect(chromeApi.tabs.create).toHaveBeenCalledWith({
      url: "chrome-extension://test/dashboard.html",
    });
  });

  it("focuses an existing dashboard from the toolbar without a duplicate", async () => {
    const { chromeApi, listener } = await loadActionClickListener();
    (
      chromeApi.tabs.query as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValueOnce([{ id: 42, windowId: 7 }]);

    listener();
    await settleAsyncWork();

    expect(chromeApi.tabs.update).toHaveBeenCalledWith(42, { active: true });
    expect(chromeApi.windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
  });

  it("rejects a second START_SYNC while the first start is still claiming", async () => {
    const holdLease = deferred();
    acquireOffscreenLeaseMock.mockImplementationOnce(async () => {
      await holdLease.promise;
      return vi.fn(async () => undefined);
    });
    runSyncMock.mockResolvedValue(undefined);

    const { listener } = await loadMessageListener();

    const firstResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      firstResponse,
    );
    await settleAsyncWork();

    expect(createSyncRunMock).not.toHaveBeenCalled();

    const secondResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["peerberry"] } },
      { url: "chrome-extension://test/dashboard.html" },
      secondResponse,
    );
    await settleAsyncWork();

    expect(secondResponse).toHaveBeenCalledWith({
      error: "A sync is starting. Please try again shortly.",
    });
    expect(createSyncRunMock).not.toHaveBeenCalled();

    holdLease.resolve();
    await waitFor(() => createSyncRunMock.mock.calls.length === 1);

    expect(firstResponse).toHaveBeenCalledWith({
      runId: expect.any(String),
    });
    expect(createSyncRunMock).toHaveBeenCalledTimes(1);
  });

  it("cancels a START_SYNC that has a controller before active run persistence", async () => {
    const holdLease = deferred();
    acquireOffscreenLeaseMock.mockImplementationOnce(async () => {
      await holdLease.promise;
      return vi.fn(async () => undefined);
    });
    runSyncMock.mockResolvedValue(undefined);

    const { listener } = await loadMessageListener();

    const startResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      startResponse,
    );
    await settleAsyncWork();

    const cancelResponse = vi.fn();
    listener(
      { type: "CANCEL_SYNC_ALL" },
      { url: "chrome-extension://test/dashboard.html" },
      cancelResponse,
    );
    await settleAsyncWork();

    expect(cancelResponse).toHaveBeenCalledWith({ success: true });
    expect(createSyncRunMock).not.toHaveBeenCalled();

    holdLease.resolve();
    await waitFor(() => startResponse.mock.calls.length === 1);

    expect(startResponse).toHaveBeenCalledWith({
      error: "Sync cancelled by user",
    });
    expect(createSyncRunMock).not.toHaveBeenCalled();
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("queues active START_SYNC targets and exposes queue status", async () => {
    const holdFirstRun = deferred();
    runSyncMock.mockImplementation(
      async (
        runId: string,
        batch: PlatformCatalogEntry[],
        _stealth: boolean,
        onEvent: (event: SyncEvent) => void,
      ) => {
        await updatePlatformProgressMock(runId, batch[0]!.id, "running");
        await holdFirstRun.promise;
        onEvent({ type: "sync_complete", platformId: "", runId });
      },
    );

    const { chromeApi, listener } = await loadMessageListener();

    const startResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      startResponse,
    );
    await waitFor(() => runSyncMock.mock.calls.length === 1);

    const runId = currentRun?.runId;
    expect(runId).toBeTruthy();

    const queueResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["peerberry"] } },
      { url: "chrome-extension://test/dashboard.html" },
      queueResponse,
    );
    await settleAsyncWork();

    expect(queueResponse).toHaveBeenCalledWith({
      runId,
      queued: true,
      queuedPlatformIds: ["peerberry"],
    });
    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      runId,
      "peerberry",
      "pending",
    );
    expect(chromeApi.runtime.sendMessage).toHaveBeenCalledWith({
      type: "SYNC_PROGRESS",
      payload: expect.objectContaining({
        type: "platform_queued",
        platformId: "peerberry",
        queuePosition: 1,
        runId,
      }),
    });

    const statusResponse = vi.fn();
    listener(
      { type: "GET_SYNC_STATUS" },
      { url: "chrome-extension://test/dashboard.html" },
      statusResponse,
    );
    await settleAsyncWork();

    expect(statusResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        queuedPlatformIds: ["peerberry"],
      }),
    );
  });

  it("starts the sync keepalive alarm at Chrome's packaged 30 second minimum", async () => {
    runSyncMock.mockResolvedValue(undefined);

    const { chromeApi, listener } = await loadMessageListener();
    const startResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      startResponse,
    );
    await waitFor(() => startResponse.mock.calls.length === 1);

    expect(chromeApi.alarms.create).toHaveBeenCalledWith(
      "p2p_sync_keepalive",
      { periodInMinutes: 0.5 },
    );
  });

  it("does not let a completed run finalizer reset queueing for a newly started run", async () => {
    const holdSecondRun = deferred();
    let secondRunId: string | undefined;
    runSyncMock.mockImplementation(
      async (
        runId: string,
        batch: PlatformCatalogEntry[],
        _stealth: boolean,
        onEvent: (event: SyncEvent) => void,
      ) => {
        const platformId = batch[0]!.id;
        if (platformId === "peerberry") {
          secondRunId = runId;
          await updatePlatformProgressMock(runId, platformId, "running");
          await holdSecondRun.promise;
        }
        await updatePlatformProgressMock(runId, platformId, "success");
        onEvent({ type: "sync_complete", platformId: "", runId });
      },
    );

    const { chromeApi, listener } = await loadMessageListener();
    const removeSessionKey = chromeApi.storage.session.remove as unknown as ReturnType<
      typeof vi.fn
    >;
    const originalRemove = removeSessionKey.getMockImplementation() as
      | ((key: string) => Promise<void>)
      | undefined;
    const secondResponse = vi.fn();
    let startedSecondRunDuringFirstCleanup = false;
    removeSessionKey.mockImplementation(async (key: string) => {
      await originalRemove?.(key);
      if (key === "p2p_active_sync" && !startedSecondRunDuringFirstCleanup) {
        startedSecondRunDuringFirstCleanup = true;
        listener(
          { type: "START_SYNC", payload: { platformIds: ["peerberry"] } },
          { url: "chrome-extension://test/dashboard.html" },
          secondResponse,
        );
        await settleAsyncWork();
      }
    });

    const firstResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      firstResponse,
    );

    await waitFor(() => runSyncMock.mock.calls.length === 2);
    await waitFor(() => secondResponse.mock.calls.length === 1);
    await settleAsyncWork();

    const queueResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      queueResponse,
    );
    await settleAsyncWork();

    expect(secondRunId).toBeTruthy();
    expect(queueResponse).toHaveBeenCalledWith({
      runId: secondRunId,
      queued: true,
      queuedPlatformIds: ["mintos"],
    });

    holdSecondRun.resolve();
    await settleAsyncWork();
  });

  it("does not enqueue targets when cancel-all fires during queue target resolution", async () => {
    runSyncMock.mockImplementation(
      async (
        runId: string,
        batch: PlatformCatalogEntry[],
        _stealth: boolean,
        onEvent: (event: SyncEvent) => void,
        signal?: AbortSignal,
      ) => {
        await updatePlatformProgressMock(runId, batch[0]!.id, "running");
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        onEvent({ type: "sync_cancelled", platformId: "", runId });
      },
    );

    const { listener } = await loadMessageListener();

    const startResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      startResponse,
    );
    await waitFor(() => runSyncMock.mock.calls.length === 1);

    const runId = currentRun?.runId;
    expect(runId).toBeTruthy();

    let resolveQueueSettings: (settings: Awaited<ReturnType<typeof getSettingsMock>>) => void =
      () => {};
    getSettingsMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveQueueSettings = resolve;
        }),
    );

    const queueResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["peerberry"] } },
      { url: "chrome-extension://test/dashboard.html" },
      queueResponse,
    );
    await waitFor(() => getSettingsMock.mock.calls.length === 2);

    const cancelResponse = vi.fn();
    listener(
      { type: "CANCEL_SYNC_ALL" },
      { url: "chrome-extension://test/dashboard.html" },
      cancelResponse,
    );
    await settleAsyncWork();

    expect(cancelResponse).toHaveBeenCalledWith({ success: true });
    expect(updatePlatformProgressMock).not.toHaveBeenCalledWith(
      runId,
      "peerberry",
      "pending",
    );

    resolveQueueSettings({
      privacyModeEnabled: false,
      stealthModeEnabled: false,
      debugModeEnabled: false,
      parallelSyncEnabled: false,
      disabledPlatformIds: [],
      language: "en",
      syncReminderDays: 7,
      sessionTimeoutMinutes: 0,
      historyRetentionDays: 0,
      geminiActivationBannerDismissed: false,
    });
    await waitFor(() => queueResponse.mock.calls.length === 1);

    expect(queueResponse).toHaveBeenCalledWith({
      error: "Sync cancelled by user",
    });
    expect(updatePlatformProgressMock).not.toHaveBeenCalledWith(
      runId,
      "peerberry",
      "pending",
    );
  });

  it("drains queued platforms and broadcasts only final sync_complete", async () => {
    const holdFirstRun = deferred();
    runSyncMock.mockImplementation(
      async (
        runId: string,
        batch: PlatformCatalogEntry[],
        _stealth: boolean,
        onEvent: (event: SyncEvent) => void,
      ) => {
        await updatePlatformProgressMock(runId, batch[0]!.id, "running");
        if (runSyncMock.mock.calls.length === 1) {
          await holdFirstRun.promise;
        }
        await updatePlatformProgressMock(runId, batch[0]!.id, "success");
        onEvent({ type: "sync_complete", platformId: "", runId });
      },
    );

    const { chromeApi, listener } = await loadMessageListener();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await waitFor(() => runSyncMock.mock.calls.length === 1);

    listener(
      { type: "START_SYNC", payload: { platformIds: ["peerberry"] } },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await settleAsyncWork();
    holdFirstRun.resolve();
    await waitFor(() => runSyncMock.mock.calls.length === 2);
    await settleAsyncWork();

    expect(
      (runSyncMock.mock.calls[1]?.[1] as PlatformCatalogEntry[]).map(
        (platform) => platform.id,
      ),
    ).toEqual(["peerberry"]);

    const syncCompleteMessages = (
      chromeApi.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.filter(
      ([message]) =>
        (message as { payload?: { type?: string } }).payload?.type ===
        "sync_complete",
    );
    expect(syncCompleteMessages).toHaveLength(1);
  });

  it("preserves forced extraction choice signals for initial and queued sync batches", async () => {
    const holdFirstRun = deferred();
    runSyncMock.mockImplementation(
      async (
        runId: string,
        batch: PlatformCatalogEntry[],
        _stealth: boolean,
        onEvent: (event: SyncEvent) => void,
      ) => {
        await updatePlatformProgressMock(runId, batch[0]!.id, "running");
        if (runSyncMock.mock.calls.length === 1) {
          await holdFirstRun.promise;
        }
        await updatePlatformProgressMock(runId, batch[0]!.id, "success");
        onEvent({ type: "sync_complete", platformId: "", runId });
      },
    );

    const { listener } = await loadMessageListener();
    listener(
      {
        type: "START_SYNC",
        payload: {
          platformIds: ["mintos"],
          forceExtractionChoiceForSignals: ["portfolio_value", "free_cash"],
        },
      },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await waitFor(() => runSyncMock.mock.calls.length === 1);

    const initialForcedGetter = runSyncMock.mock.calls[0]?.[7] as
      | ((platformId: PlatformId) => string[])
      | undefined;
    expect(initialForcedGetter?.("mintos")).toEqual([
      "portfolio_value",
      "free_cash",
    ]);

    listener(
      {
        type: "START_SYNC",
        payload: {
          platformIds: ["peerberry"],
          forceExtractionChoiceForSignals: ["portfolio_value", "free_cash"],
        },
      },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await settleAsyncWork();
    holdFirstRun.resolve();
    await waitFor(() => runSyncMock.mock.calls.length === 2);

    const queuedForcedGetter = runSyncMock.mock.calls[1]?.[7] as
      | ((platformId: PlatformId) => string[])
      | undefined;
    expect(
      (runSyncMock.mock.calls[1]?.[1] as PlatformCatalogEntry[]).map(
        (platform) => platform.id,
      ),
    ).toEqual(["peerberry"]);
    expect(queuedForcedGetter?.("peerberry")).toEqual([
      "portfolio_value",
      "free_cash",
    ]);
  });

  it("rejects queue requests while a failing run is being cleaned up", async () => {
    const failRun = deferred();
    const releaseFailedUpdate = deferred();
    updateSyncRunMock.mockImplementation(
      async (runId: string, update: Partial<StoredSyncRun>) => {
        if (update.state === "failed") {
          await releaseFailedUpdate.promise;
        }
        if (currentRun?.runId !== runId) return;
        currentRun = { ...currentRun, ...update };
      },
    );
    runSyncMock.mockImplementation(
      async (runId: string, batch: PlatformCatalogEntry[]) => {
        await updatePlatformProgressMock(runId, batch[0]!.id, "running");
        await failRun.promise;
        throw new Error("Unexpected sync failure");
      },
    );

    const { listener } = await loadMessageListener();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await waitFor(() => runSyncMock.mock.calls.length === 1);

    failRun.resolve();
    await waitFor(() =>
      updateSyncRunMock.mock.calls.some(
        ([, update]) => (update as Partial<StoredSyncRun>).state === "failed",
      ),
    );

    const queueResponse = vi.fn();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["peerberry"] } },
      { url: "chrome-extension://test/dashboard.html" },
      queueResponse,
    );
    await settleAsyncWork();

    expect(queueResponse).toHaveBeenCalledWith({
      error: "A sync is finishing. Please try again shortly.",
    });
    expect(updatePlatformProgressMock).not.toHaveBeenCalledWith(
      currentRun?.runId,
      "peerberry",
      "pending",
    );

    releaseFailedUpdate.resolve();
    await settleAsyncWork();
    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("marks queued platforms cancelled when the active run fails", async () => {
    const failRun = deferred();
    runSyncMock.mockImplementation(
      async (runId: string, batch: PlatformCatalogEntry[]) => {
        await updatePlatformProgressMock(runId, batch[0]!.id, "running");
        await failRun.promise;
        throw new Error("Unexpected sync failure");
      },
    );

    const { listener } = await loadMessageListener();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await waitFor(() => runSyncMock.mock.calls.length === 1);

    listener(
      { type: "START_SYNC", payload: { platformIds: ["peerberry"] } },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await settleAsyncWork();

    failRun.resolve();
    await waitFor(() =>
      updateSyncRunMock.mock.calls.some(
        ([, update]) => (update as Partial<StoredSyncRun>).state === "failed",
      ),
    );

    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      currentRun?.runId,
      "peerberry",
      "cancelled",
    );
    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("removes a queued platform without running it", async () => {
    const holdFirstRun = deferred();
    runSyncMock.mockImplementation(
      async (
        runId: string,
        batch: PlatformCatalogEntry[],
        _stealth: boolean,
        onEvent: (event: SyncEvent) => void,
      ) => {
        await updatePlatformProgressMock(runId, batch[0]!.id, "running");
        await holdFirstRun.promise;
        await updatePlatformProgressMock(runId, batch[0]!.id, "success");
        onEvent({ type: "sync_complete", platformId: "", runId });
      },
    );

    const { listener } = await loadMessageListener();
    listener(
      { type: "START_SYNC", payload: { platformIds: ["mintos"] } },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await waitFor(() => runSyncMock.mock.calls.length === 1);

    listener(
      { type: "START_SYNC", payload: { platformIds: ["peerberry"] } },
      { url: "chrome-extension://test/dashboard.html" },
      vi.fn(),
    );
    await settleAsyncWork();

    const cancelResponse = vi.fn();
    listener(
      { type: "CANCEL_SYNC_PLATFORM", payload: { platformId: "peerberry" } },
      { url: "chrome-extension://test/dashboard.html" },
      cancelResponse,
    );
    await settleAsyncWork();

    expect(cancelResponse).toHaveBeenCalledWith({ success: true });
    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      currentRun?.runId,
      "peerberry",
      "cancelled",
    );

    const statusResponse = vi.fn();
    listener(
      { type: "GET_SYNC_STATUS" },
      { url: "chrome-extension://test/dashboard.html" },
      statusResponse,
    );
    await settleAsyncWork();
    expect(statusResponse).toHaveBeenCalledWith(
      expect.objectContaining({ queuedPlatformIds: [] }),
    );

    holdFirstRun.resolve();
    await settleAsyncWork();
    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });
});
