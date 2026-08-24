import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionTelemetryRecord } from "../../src/shared/types/index.js";

function mockChrome(response: unknown) {
  const sendMessage = vi.fn().mockResolvedValue(response);

  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage,
    },
  };

  return { sendMessage };
}

describe("background db proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("../../src/background/offscreen-manager.js", () => ({
      withOffscreenLease: vi.fn(async (_kind: string, operation: () => Promise<unknown>) =>
        operation(),
      ),
    }));
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("creates the offscreen document and forwards DB requests", async () => {
    const mocks = mockChrome({ ok: true, data: 17 });
    const dbProxy = await import("../../src/background/db-proxy.js");
    const offscreenManager = await import("../../src/background/offscreen-manager.js");

    const id = await dbProxy.createSyncRun("run-1", ["mintos"]);

    expect(id).toBe(17);
    expect(offscreenManager.withOffscreenLease).toHaveBeenCalledWith(
      "db",
      expect.any(Function),
    );
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_CREATE_SYNC_RUN",
      payload: { runId: "run-1", platformIds: ["mintos"] },
    });
  });

  it("throws when offscreen returns an error response", async () => {
    mockChrome({ ok: false, error: "db failed" });
    const dbProxy = await import("../../src/background/db-proxy.js");

    await expect(dbProxy.getSettings()).rejects.toThrow("db failed");
  });

  it("forwards invisible-key storage through the offscreen proxy", async () => {
    const mocks = mockChrome({ ok: true, data: "key-b64" });
    const dbProxy = await import("../../src/background/db-proxy.js");

    await expect(dbProxy.getStoredInvisibleKey()).resolves.toBe("key-b64");
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      type: "DB_GET_INVISIBLE_KEY",
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.setStoredInvisibleKey("replacement-b64");
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      type: "DB_SET_INVISIBLE_KEY",
      payload: { keyBase64: "replacement-b64" },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.deleteStoredInvisibleKey();
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      type: "DB_DELETE_INVISIBLE_KEY",
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: true });
    await expect(dbProxy.hasStoredInvisibleKey()).resolves.toBe(true);
    expect(mocks.sendMessage).toHaveBeenLastCalledWith({
      type: "DB_HAS_INVISIBLE_KEY",
    });
  });

  it("forwards selector profile reads and writes through the offscreen DB proxy", async () => {
    const mocks = mockChrome({ ok: true, data: undefined });
    const dbProxy = await import("../../src/background/db-proxy.js");

    await dbProxy.learnSelector({
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: ".balance",
      fingerprint: "portfolio_value|.balance|account balance",
      confidence: 1,
      learnedAt: "2026-05-18T10:00:00.000Z",
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_LEARN_SELECTOR",
      payload: {
        profile: {
          platformId: "mintos",
          signalKey: "portfolio_value",
          selector: ".balance",
          fingerprint: "portfolio_value|.balance|account balance",
          confidence: 1,
          learnedAt: "2026-05-18T10:00:00.000Z",
        },
      },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: [] });
    await dbProxy.getSelectorProfiles("mintos");

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_GET_SELECTOR_PROFILES",
      payload: { platformId: "mintos" },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.resetSelectorProfiles("mintos");

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_RESET_SELECTOR_PROFILES",
      payload: { platformId: "mintos" },
    });
  });

  it("forwards login selector profile reads, writes, and failure markers", async () => {
    const mocks = mockChrome({ ok: true, data: undefined });
    const dbProxy = await import("../../src/background/db-proxy.js");

    await dbProxy.learnLoginSelectors("mintos", [
      {
        platformId: "mintos",
        fieldRole: "username",
        selector: 'input[autocomplete="username"]',
        fingerprint: "input|username|email",
        confidence: 1,
        source: "ai",
        learnedAt: "2026-06-08T10:00:00.000Z",
        failureCount: 0,
      },
    ]);

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_LEARN_LOGIN_SELECTORS",
      payload: {
        platformId: "mintos",
        profiles: [
          {
            platformId: "mintos",
            fieldRole: "username",
            selector: 'input[autocomplete="username"]',
            fingerprint: "input|username|email",
            confidence: 1,
            source: "ai",
            learnedAt: "2026-06-08T10:00:00.000Z",
            failureCount: 0,
          },
        ],
      },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: [] });
    await dbProxy.getLoginSelectorProfiles("mintos");

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_GET_LOGIN_SELECTOR_PROFILES",
      payload: { platformId: "mintos" },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.markLoginSelectorFailures("mintos", ["username", "password"]);

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_MARK_LOGIN_SELECTOR_FAILURES",
      payload: { platformId: "mintos", fieldRoles: ["username", "password"] },
    });
  });

  it("forwards platform batch history reads and reverts through the offscreen DB proxy", async () => {
    const mocks = mockChrome({ ok: true, data: [] });
    const dbProxy = await import("../../src/background/db-proxy.js");

    await dbProxy.getPlatformBatchHistory("mintos");

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_GET_PLATFORM_BATCH_HISTORY",
      payload: { platformId: "mintos" },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.revertPlatformBatch("mintos", 77);

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_REVERT_PLATFORM_BATCH",
      payload: { platformId: "mintos", batchId: 77 },
    });
  });

  it("forwards metrics history, extraction telemetry, and selector failure markers", async () => {
    const telemetry: ExtractionTelemetryRecord = {
      platformId: "mintos",
      runId: "run-telemetry",
      recordedAt: "2026-06-10T10:00:00.000Z",
      signalKey: "portfolio_value" as const,
      stage: "final" as const,
      outcome: "choice_required" as const,
      value: 1000,
      confidence: 0.62,
      topScore: 4.2,
      secondScore: 3.9,
      candidateCount: 4,
      elementsScanned: 120,
      durationMs: 900,
      pollCount: 2,
      warnings: ["ambiguous_candidates"],
    };
    const mocks = mockChrome({ ok: true, data: [] });
    const dbProxy = await import("../../src/background/db-proxy.js");

    await dbProxy.getMetricsHistory("mintos", 5);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_GET_METRICS_HISTORY",
      payload: { platformId: "mintos", limit: 5 },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.updateMetricsSnapshot("mintos", "2026-06-10", {
      platformValue: 1234.5,
      freeCash: 67.8,
    });
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_UPDATE_METRICS_SNAPSHOT",
      payload: {
        platformId: "mintos",
        date: "2026-06-10",
        platformValue: 1234.5,
        freeCash: 67.8,
      },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.deleteMetricsSnapshot("mintos", "2026-06-10");
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_DELETE_METRICS_SNAPSHOT",
      payload: { platformId: "mintos", date: "2026-06-10" },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.logExtractionTelemetry(telemetry);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_LOG_EXTRACTION_TELEMETRY",
      payload: { record: telemetry },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: [telemetry] });
    await dbProxy.getExtractionTelemetry("mintos", 20);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_GET_EXTRACTION_TELEMETRY",
      payload: { platformId: "mintos", limit: 20 },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.markSelectorFailure("mintos", "portfolio_value");
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_MARK_SELECTOR_FAILURE",
      payload: { platformId: "mintos", signalKey: "portfolio_value" },
    });
  });

  it("forwards financial export and restore requests through the offscreen DB proxy", async () => {
    const backup = {
      format: "p2p-portfolio-tracker-financial-backup" as const,
      version: 1 as const,
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
    };
    const mocks = mockChrome({ ok: true, data: backup.payload });
    const dbProxy = await import("../../src/background/db-proxy.js");

    await dbProxy.getExportData();

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_GET_EXPORT_DATA",
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: backup });
    await dbProxy.createFinancialBackup("0.12.75");

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_CREATE_FINANCIAL_BACKUP",
      payload: { appVersion: "0.12.75" },
    });

    mocks.sendMessage.mockResolvedValueOnce({ ok: true, data: undefined });
    await dbProxy.restoreFinancialBackup(backup, "2026-06-08T11:00:00.000Z");

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: "DB_RESTORE_FINANCIAL_BACKUP",
      payload: {
        backup,
        restoredAt: "2026-06-08T11:00:00.000Z",
      },
    });
  });
});
