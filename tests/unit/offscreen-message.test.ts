import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function installChromeMock() {
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      onMessage: { addListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe("offscreen DB proxy message handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installChromeMock();
    vi.doMock("../../src/shared/db/index.js", () => ({
      createSyncRun: vi.fn(),
      updateSyncRun: vi.fn(),
      updatePlatformProgress: vi.fn(),
      getLatestSyncRun: vi.fn(),
      getLastSuccessfulSyncAt: vi.fn(),
      getLatestMetrics: vi.fn(),
      getExportData: vi.fn(),
      createFinancialBackup: vi.fn(),
      listFinancialDataPlatformIds: vi.fn(),
      restoreFinancialBackup: vi.fn(),
      getPlatformBatchHistory: vi.fn(),
      ingestConnectorResult: vi.fn(),
      saveCredentials: vi.fn(),
      getCredentials: vi.fn(),
      deleteCredentials: vi.fn(),
      listCredentialPlatformIds: vi.fn(),
      listCredentialStatus: vi.fn(),
      learnSelector: vi.fn(),
      getSelectorProfiles: vi.fn(),
      resetSelectorProfiles: vi.fn(),
      markSelectorFailure: vi.fn(),
      learnLoginSelectors: vi.fn(),
      getLoginSelectorProfiles: vi.fn(),
      markLoginSelectorFailures: vi.fn(),
      getMetricsHistory: vi.fn(),
      updateMetricsSnapshot: vi.fn(),
      deleteMetricsSnapshot: vi.fn(),
      logExtractionTelemetry: vi.fn(),
      getExtractionTelemetry: vi.fn(),
      getSettings: vi.fn(),
      saveSettings: vi.fn(),
      pruneOldData: vi.fn(),
      revertPlatformBatch: vi.fn(),
      revertReplacedIngestionBatch: vi.fn(),
      calculateNetAnnualReturn: vi.fn(),
      cleanupStaleSyncRuns: vi.fn(),
    }));
    vi.doMock("../../src/offscreen/keystore-storage.js", () => ({
      getStoredInvisibleKey: vi.fn(async () => "offscreen-key-b64"),
      setStoredInvisibleKey: vi.fn(async () => undefined),
      deleteStoredInvisibleKey: vi.fn(async () => undefined),
      hasStoredInvisibleKey: vi.fn(async () => true),
    }));
    vi.doMock("../../src/background/sender-validation.js", () => ({
      assertInternalSender: vi.fn(),
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

  it("returns a structured error for malformed DB payloads", async () => {
    await import("../../src/offscreen/index.js");
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];

    const sendResponse = vi.fn();
    const keepOpen = listener(
      { type: "DB_GET_METRICS_HISTORY", payload: { platformId: "not-real" } },
      { url: "chrome-extension://test/offscreen.html" },
      sendResponse,
    );

    expect(keepOpen).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: false,
      error: expect.stringContaining("platformId"),
    });
  });

  it("handles invisible-key storage inside the offscreen document", async () => {
    await import("../../src/offscreen/index.js");
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const listener = (
      chromeApi.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0];
    const sendResponse = vi.fn();

    expect(listener(
      { type: "DB_GET_INVISIBLE_KEY" },
      { url: "chrome-extension://test/offscreen.html" },
      sendResponse,
    )).toBe(true);

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({
        ok: true,
        data: "offscreen-key-b64",
      });
    });
  });
});
