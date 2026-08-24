import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFinancialBackup,
  db,
  getExportData,
  listFinancialDataPlatformIds,
  restoreFinancialBackup,
} from "../../src/shared/db/index.js";
import type {
  FinancialBackupV1,
  StoredMetricsSnapshot,
} from "../../src/shared/types/index.js";

function runTransactionInline() {
  return vi
    .spyOn(db, "transaction")
    .mockImplementation((async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<unknown>;
      return callback();
    }) as never);
}

function backupFixture(): FinancialBackupV1 {
  return {
    format: "p2p-portfolio-tracker-financial-backup",
    version: 1,
    appVersion: "0.12.75",
    exportedAt: "2026-06-08T10:00:00.000Z",
    payload: {
      overviewMetrics: [
        {
          platformId: "mintos",
          fetchedAt: "2026-06-01T12:00:00.000Z",
          platformValue: 1000,
          freeCash: 25,
          currency: "EUR",
          confidence: 0.9,
        },
      ],
      metricsHistory: [
        {
          platformId: "mintos",
          date: "2026-06-01",
          platformValue: 1000,
          freeCash: 25,
          fetchedAt: "2026-06-01T12:00:00.000Z",
        },
      ],
      cashflows: [
        {
          platformId: "mintos",
          date: "2026-06-01",
          amount: 12.5,
          currency: "EUR",
          type: "interest_paid",
          taxCategory: "ausgezahlt",
        },
      ],
      positions: [],
      riskEvents: [],
      deltaLogs: [
        {
          platformId: "mintos",
          timestamp: "2026-06-01T12:00:00.000Z",
          field: "platformValue",
          oldValue: 1000,
          newValue: 1000,
          delta: 0,
        },
      ],
    },
  };
}

function mockPlatformIdIndex(
  table: { orderBy: (index: string) => unknown },
  keys: string[],
) {
  return vi.spyOn(table, "orderBy").mockReturnValue({
    uniqueKeys: vi.fn().mockResolvedValue(keys),
  } as never);
}

function mockLatestSnapshots(
  snapshotsByPlatform: Partial<Record<string, StoredMetricsSnapshot>>,
) {
  return vi.spyOn(db.metricsHistory, "where").mockImplementation(((
    _index: string,
  ) => ({
    between: (lower: [string, unknown]) => ({
      last: async () => snapshotsByPlatform[lower[0]],
    }),
  })) as never);
}

describe("financial export and restore DB helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports only portable financial data and strips database ids", async () => {
    const latestSnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-06-01",
      platformValue: 1000,
      freeCash: 25,
      fetchedAt: "2026-06-01T12:00:00.000Z",
      currency: "EUR",
      confidence: 0.9,
      batchId: 77,
    };
    mockLatestSnapshots({ mintos: latestSnapshot });
    vi.spyOn(db.metricsHistory, "toArray").mockResolvedValue([latestSnapshot]);
    vi.spyOn(db.cashflows, "toArray").mockResolvedValue([
      {
        id: 1,
        batchId: 77,
        platformId: "mintos",
        date: "2026-06-01",
        amount: 12.5,
        currency: "EUR",
        type: "interest_paid",
        taxCategory: "ausgezahlt",
      },
    ]);
    vi.spyOn(db.positions, "toArray").mockResolvedValue([]);
    vi.spyOn(db.riskEvents, "toArray").mockResolvedValue([]);
    vi.spyOn(db.deltaLogs, "toArray").mockResolvedValue([
      {
        id: 4,
        batchId: 77,
        platformId: "mintos",
        timestamp: "2026-06-01T12:00:00.000Z",
        field: "platformValue",
        oldValue: 1000,
        newValue: 1000,
        delta: 0,
      },
    ]);

    const data = await getExportData();
    const backup = await createFinancialBackup("0.12.75", "2026-06-08T10:00:00.000Z");

    expect(data.overviewMetrics[0]).toEqual(
      expect.objectContaining({
        platformId: "mintos",
        fetchedAt: "2026-06-01T12:00:00.000Z",
        platformValue: 1000,
        freeCash: 25,
        currency: "EUR",
        confidence: 0.9,
      }),
    );
    expect(data.metricsHistory[0]).not.toHaveProperty("batchId");
    expect(data.cashflows[0]).not.toHaveProperty("id");
    expect(data.cashflows[0]).not.toHaveProperty("batchId");
    expect(data.deltaLogs[0]).not.toHaveProperty("id");
    expect(data.deltaLogs[0]).not.toHaveProperty("batchId");
    expect(backup.payload).toEqual(data);
  });

  it("restores by replacing financial tables only and preserving sensitive tables", async () => {
    runTransactionInline();
    const clearTables = [
      db.metricsHistory,
      db.cashflows,
      db.positions,
      db.riskEvents,
      db.deltaLogs,
      db.ingestionBatches,
    ];
    const clearSpies = clearTables.map((table) =>
      vi.spyOn(table, "clear").mockResolvedValue(undefined as never),
    );
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(88 as never);
    const historyPutSpy = vi
      .spyOn(db.metricsHistory, "bulkPut")
      .mockResolvedValue(undefined as never);
    // overview merge finds the restored same-day row (same fetchedAt) → no overwrite
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue({
      platformId: "mintos",
      date: "2026-06-01",
      platformValue: 1000,
      freeCash: 25,
      fetchedAt: "2026-06-01T12:00:00.000Z",
      batchId: 88,
    });
    const historySinglePutSpy = vi
      .spyOn(db.metricsHistory, "put")
      .mockResolvedValue(["mintos", "2026-06-01"] as never);
    const cashflowAddSpy = vi
      .spyOn(db.cashflows, "bulkAdd")
      .mockResolvedValue(undefined as never);
    const deltaAddSpy = vi
      .spyOn(db.deltaLogs, "bulkAdd")
      .mockResolvedValue(undefined as never);
    const credentialsClearSpy = vi.spyOn(db.credentials, "clear");
    const settingsClearSpy = vi.spyOn(db.settings, "clear");
    const selectorsClearSpy = vi.spyOn(db.selectorProfiles, "clear");
    const syncRunsClearSpy = vi.spyOn(db.syncRuns, "clear");

    await restoreFinancialBackup(backupFixture(), "2026-06-08T11:00:00.000Z");

    for (const clearSpy of clearSpies) {
      expect(clearSpy).toHaveBeenCalledTimes(1);
    }
    expect(credentialsClearSpy).not.toHaveBeenCalled();
    expect(settingsClearSpy).not.toHaveBeenCalled();
    expect(selectorsClearSpy).not.toHaveBeenCalled();
    expect(syncRunsClearSpy).not.toHaveBeenCalled();
    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        sourceKind: "restore",
        appliedAt: "2026-06-08T11:00:00.000Z",
        revertible: false,
        legacyBackfilled: false,
      }),
    );
    expect(historyPutSpy).toHaveBeenCalledWith([
      expect.objectContaining({ platformId: "mintos", batchId: 88 }),
    ]);
    expect(historySinglePutSpy).not.toHaveBeenCalled();
    expect(cashflowAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({ platformId: "mintos", batchId: 88 }),
    ]);
    expect(deltaAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({ platformId: "mintos", batchId: 88 }),
    ]);
  });

  it("merges a fresher backup overview row into metrics history on restore", async () => {
    runTransactionInline();
    for (const table of [
      db.metricsHistory,
      db.cashflows,
      db.positions,
      db.riskEvents,
      db.deltaLogs,
      db.ingestionBatches,
    ]) {
      vi.spyOn(table, "clear").mockResolvedValue(undefined as never);
    }
    vi.spyOn(db.ingestionBatches, "add").mockResolvedValue(88 as never);
    vi.spyOn(db.metricsHistory, "bulkPut").mockResolvedValue(undefined as never);
    vi.spyOn(db.cashflows, "bulkAdd").mockResolvedValue(undefined as never);
    vi.spyOn(db.deltaLogs, "bulkAdd").mockResolvedValue(undefined as never);
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue(undefined);
    const historySinglePutSpy = vi
      .spyOn(db.metricsHistory, "put")
      .mockResolvedValue(["mintos", "2026-06-02"] as never);

    const backup = backupFixture();
    backup.payload.overviewMetrics = [
      {
        platformId: "mintos",
        fetchedAt: "2026-06-02T09:00:00.000Z",
        platformValue: 1100,
        freeCash: 30,
        currency: "EUR",
        confidence: 0.95,
      },
    ];

    await restoreFinancialBackup(backup, "2026-06-08T11:00:00.000Z");

    expect(historySinglePutSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        date: "2026-06-02",
        platformValue: 1100,
        freeCash: 30,
        fetchedAt: "2026-06-02T09:00:00.000Z",
        currency: "EUR",
        confidence: 0.95,
        batchId: 88,
      }),
    );
  });

  it("lists platform ids from every financial table using index-only lookups", async () => {
    const metricsOrderSpy = mockPlatformIdIndex(db.metricsHistory, ["peerberry"]);
    const cashflowsOrderSpy = mockPlatformIdIndex(db.cashflows, ["robocash"]);
    const positionsOrderSpy = mockPlatformIdIndex(db.positions, []);
    const riskEventsOrderSpy = mockPlatformIdIndex(db.riskEvents, []);
    const deltaLogsOrderSpy = mockPlatformIdIndex(db.deltaLogs, []);
    const metricsToArraySpy = vi.spyOn(db.metricsHistory, "toArray");
    const cashflowsToArraySpy = vi.spyOn(db.cashflows, "toArray");
    const positionsToArraySpy = vi.spyOn(db.positions, "toArray");
    const riskEventsToArraySpy = vi.spyOn(db.riskEvents, "toArray");
    const deltaLogsToArraySpy = vi.spyOn(db.deltaLogs, "toArray");

    await expect(listFinancialDataPlatformIds()).resolves.toEqual([
      "peerberry",
      "robocash",
    ]);
    expect(metricsOrderSpy).toHaveBeenCalledWith("platformId");
    expect(cashflowsOrderSpy).toHaveBeenCalledWith("platformId");
    expect(positionsOrderSpy).toHaveBeenCalledWith("platformId");
    expect(riskEventsOrderSpy).toHaveBeenCalledWith("platformId");
    expect(deltaLogsOrderSpy).toHaveBeenCalledWith("platformId");
    expect(metricsToArraySpy).not.toHaveBeenCalled();
    expect(cashflowsToArraySpy).not.toHaveBeenCalled();
    expect(positionsToArraySpy).not.toHaveBeenCalled();
    expect(riskEventsToArraySpy).not.toHaveBeenCalled();
    expect(deltaLogsToArraySpy).not.toHaveBeenCalled();
  });
});
