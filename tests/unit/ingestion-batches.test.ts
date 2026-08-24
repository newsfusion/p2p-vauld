import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backfillLegacyBatchHistoryForMigration,
  db,
  getPlatformBatchHistory,
  ingestConnectorResult,
  revertPlatformBatch,
  revertReplacedIngestionBatch,
} from "../../src/shared/db/index.js";
import type {
  StoredDeltaLog,
  StoredIngestionBatch,
  StoredMetricsSnapshot,
  StoredOverviewMetrics,
} from "../../src/shared/types/index.js";

function runTransactionInline() {
  return vi
    .spyOn(db, "transaction")
    .mockImplementation((async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>;
      return callback();
    }) as never);
}

function mockDeleteByBatchId(table: { where: (...args: any[]) => any }) {
  const deleteMock = vi.fn(async () => undefined);
  vi.spyOn(table, "where").mockReturnValue({
    equals: () => ({
      delete: deleteMock,
    }),
  } as never);
  return deleteMock;
}

function mockBatchHistory(batches: StoredIngestionBatch[]) {
  const toArray = vi.fn().mockResolvedValue(batches);
  const limit = vi.fn(() => ({ toArray }));
  const reverse = vi.fn(() => ({ limit, toArray }));
  const between = vi.fn(() => ({ reverse }));
  return vi.spyOn(db.ingestionBatches, "where").mockReturnValue({
    between,
  } as never);
}

function mockLatestSnapshot(snapshot: StoredMetricsSnapshot | undefined) {
  return vi.spyOn(db.metricsHistory, "where").mockReturnValue({
    between: () => ({ last: async () => snapshot }),
  } as never);
}

describe("ingestion batch persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates revertible batch metadata and propagates batch ids during sync ingestion", async () => {
    const timestamp = "2026-05-21T12:00:00.000Z";
    const existingDailySnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-05-21",
      platformValue: 9990,
      freeCash: 490,
      netAnnualReturnPct: 9.9,
      fetchedAt: "2026-05-21T08:00:00.000Z",
    };

    runTransactionInline();
    mockLatestSnapshot(existingDailySnapshot);
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue(existingDailySnapshot as never);
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(77 as never);
    const deltaAddSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);
    const snapshotPutSpy = vi
      .spyOn(db.metricsHistory, "put")
      .mockResolvedValue(["mintos", "2026-05-21"] as never);
    const cashflowAddSpy = vi.spyOn(db.cashflows, "add").mockResolvedValue(1 as never);
    const positionAddSpy = vi.spyOn(db.positions, "add").mockResolvedValue(1 as never);
    const riskEventAddSpy = vi.spyOn(db.riskEvents, "add").mockResolvedValue(1 as never);
    const cashflowBulkAddSpy = vi.spyOn(db.cashflows, "bulkAdd").mockResolvedValue([] as never);
    const positionBulkAddSpy = vi.spyOn(db.positions, "bulkAdd").mockResolvedValue([] as never);
    const riskEventBulkAddSpy = vi.spyOn(db.riskEvents, "bulkAdd").mockResolvedValue([] as never);

    await ingestConnectorResult(
      {
        platformId: "mintos",
        fetchedAt: timestamp,
        warnings: [],
        cashflows: [
          {
            platformId: "mintos",
            date: "2026-05-21",
            amount: 25,
            currency: "EUR",
            type: "interest_paid",
            taxCategory: "ausgezahlt",
          },
        ],
        positions: [
          {
            platformId: "mintos",
            instrumentId: "loan-1",
            value: 200,
            currency: "EUR",
            date: "2026-05-21",
          },
        ],
        overviewMetrics: {
          platformValue: 10250,
          freeCash: 525,
          netAnnualReturnPct: 10.25,
          currency: "EUR",
          confidence: 0.95,
        },
        riskEvents: [
          {
            platformId: "mintos",
            status: "grace",
            amountEur: 14,
            since: "2026-05-20T00:00:00.000Z",
          },
        ],
      },
      { sourceKind: "sync", runId: "run-42" },
    );

    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        sourceKind: "sync",
        runId: "run-42",
        appliedAt: timestamp,
        revertible: true,
        legacyBackfilled: false,
        // beforeOverview is derived from the latest history snapshot
        beforeOverview: expect.objectContaining({
          platformId: "mintos",
          platformValue: 9990,
          freeCash: 490,
          netAnnualReturnPct: 9.9,
          fetchedAt: "2026-05-21T08:00:00.000Z",
        }),
        beforeDailySnapshot: existingDailySnapshot,
        cashflowCount: 1,
        positionCount: 1,
        riskEventCount: 1,
      }),
    );
    expect(deltaAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        field: "platformValue",
        batchId: 77,
      }),
    );
    expect(snapshotPutSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        date: "2026-05-21",
        platformValue: 10250,
        freeCash: 525,
        batchId: 77,
      }),
    );
    expect(cashflowBulkAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        platformId: "mintos",
        batchId: 77,
      }),
    ]);
    expect(positionBulkAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        platformId: "mintos",
        batchId: 77,
      }),
    ]);
    expect(riskEventBulkAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        platformId: "mintos",
        batchId: 77,
        recordedAt: timestamp,
      }),
    ]);
    expect(cashflowAddSpy).not.toHaveBeenCalled();
    expect(positionAddSpy).not.toHaveBeenCalled();
    expect(riskEventAddSpy).not.toHaveBeenCalled();
  });

  it("persists child records even when a connector result has no overview metrics", async () => {
    const timestamp = "2026-05-22T12:00:00.000Z";

    runTransactionInline();
    mockLatestSnapshot(undefined);
    const metricsHistoryGetSpy = vi.spyOn(db.metricsHistory, "get");
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(55 as never);
    const deltaAddSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);
    const snapshotPutSpy = vi
      .spyOn(db.metricsHistory, "put")
      .mockResolvedValue(["mintos", "2026-05-22"] as never);
    const cashflowAddSpy = vi.spyOn(db.cashflows, "add").mockResolvedValue(1 as never);
    const positionAddSpy = vi.spyOn(db.positions, "add").mockResolvedValue(1 as never);
    const riskEventAddSpy = vi.spyOn(db.riskEvents, "add").mockResolvedValue(1 as never);
    const cashflowBulkAddSpy = vi.spyOn(db.cashflows, "bulkAdd").mockResolvedValue([] as never);
    const positionBulkAddSpy = vi.spyOn(db.positions, "bulkAdd").mockResolvedValue([] as never);
    const riskEventBulkAddSpy = vi.spyOn(db.riskEvents, "bulkAdd").mockResolvedValue([] as never);

    await ingestConnectorResult({
      platformId: "mintos",
      fetchedAt: timestamp,
      warnings: ["overview unavailable"],
      cashflows: [
        {
          platformId: "mintos",
          date: "2026-05-22",
          amount: 18,
          currency: "EUR",
          type: "interest_paid",
          taxCategory: "ausgezahlt",
        },
      ],
      positions: [
        {
          platformId: "mintos",
          instrumentId: "loan-2",
          value: 180,
          currency: "EUR",
          date: "2026-05-22",
        },
      ],
      riskEvents: [
        {
          platformId: "mintos",
          status: "default",
          amountEur: 32,
          since: "2026-05-10T00:00:00.000Z",
        },
      ],
    });

    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        appliedAt: timestamp,
        cashflowCount: 1,
        positionCount: 1,
        riskEventCount: 1,
      }),
    );
    expect(metricsHistoryGetSpy).not.toHaveBeenCalled();
    expect(deltaAddSpy).not.toHaveBeenCalled();
    expect(snapshotPutSpy).not.toHaveBeenCalled();
    expect(cashflowBulkAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        platformId: "mintos",
        batchId: 55,
      }),
    ]);
    expect(positionBulkAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        platformId: "mintos",
        batchId: 55,
      }),
    ]);
    expect(riskEventBulkAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        platformId: "mintos",
        batchId: 55,
        recordedAt: timestamp,
      }),
    ]);
    expect(cashflowAddSpy).not.toHaveBeenCalled();
    expect(positionAddSpy).not.toHaveBeenCalled();
    expect(riskEventAddSpy).not.toHaveBeenCalled();
  });

  it("keeps only the newest same-day overview-only sync when values are unchanged", async () => {
    const previousTimestamp = "2026-06-08T08:45:00.000Z";
    const nextTimestamp = "2026-06-08T08:47:00.000Z";
    const existingOverview: StoredOverviewMetrics = {
      platformId: "mintos",
      platformValue: 807.83,
      freeCash: 32.76,
      currency: "EUR",
      confidence: 0.91,
      fetchedAt: previousTimestamp,
    };
    const existingDailySnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-06-08",
      platformValue: 807.83,
      freeCash: 32.76,
      fetchedAt: previousTimestamp,
      batchId: 42,
    };
    const existingBatch: StoredIngestionBatch = {
      id: 42,
      platformId: "mintos",
      sourceKind: "sync",
      runId: "run-old",
      appliedAt: previousTimestamp,
      revertible: true,
      legacyBackfilled: false,
      afterOverview: existingOverview,
      afterDailySnapshot: existingDailySnapshot,
      cashflowCount: 0,
      positionCount: 0,
      riskEventCount: 0,
    };

    runTransactionInline();
    mockLatestSnapshot(existingDailySnapshot);
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue(existingDailySnapshot as never);
    mockBatchHistory([existingBatch]);
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(77 as never);
    const batchUpdateSpy = vi
      .spyOn(db.ingestionBatches, "update")
      .mockResolvedValue(1 as never);
    const deltaAddSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);
    const snapshotPutSpy = vi
      .spyOn(db.metricsHistory, "put")
      .mockResolvedValue(["mintos", "2026-06-08"] as never);

    const outcome = await ingestConnectorResult(
      {
        platformId: "mintos",
        fetchedAt: nextTimestamp,
        warnings: [],
        cashflows: [],
        positions: [],
        overviewMetrics: {
          platformValue: 807.83,
          freeCash: 32.76,
          currency: "EUR",
          confidence: 0.97,
        },
        riskEvents: [],
      },
      { sourceKind: "sync", runId: "run-new" },
    );

    expect(outcome).toEqual({
      batchId: 42,
      createdBatch: false,
      replacedExistingBatch: true,
      replacementRollback: {
        batch: existingBatch,
        previousDailySnapshot: existingDailySnapshot,
      },
    });
    expect(batchAddSpy).not.toHaveBeenCalled();
    expect(deltaAddSpy).not.toHaveBeenCalled();
    expect(snapshotPutSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        date: "2026-06-08",
        platformValue: 807.83,
        freeCash: 32.76,
        fetchedAt: nextTimestamp,
        batchId: 42,
      }),
    );
    expect(batchUpdateSpy).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        appliedAt: nextTimestamp,
        runId: "run-new",
        afterOverview: expect.objectContaining({
          fetchedAt: nextTimestamp,
          confidence: 0.97,
        }),
        afterDailySnapshot: expect.objectContaining({
          fetchedAt: nextTimestamp,
          batchId: 42,
        }),
      }),
    );
  });

  it("restores replaced same-day batch metadata and snapshot", async () => {
    const previousSnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-06-08",
      platformValue: 807.83,
      freeCash: 32.76,
      fetchedAt: "2026-06-08T08:45:00.000Z",
      batchId: 42,
    };
    const originalBatch: StoredIngestionBatch = {
      id: 42,
      platformId: "mintos",
      sourceKind: "sync",
      runId: "run-old",
      appliedAt: "2026-06-08T08:45:00.000Z",
      revertible: true,
      legacyBackfilled: false,
      afterDailySnapshot: previousSnapshot,
      cashflowCount: 0,
      positionCount: 0,
      riskEventCount: 0,
    };
    const replacedBatch: StoredIngestionBatch = {
      ...originalBatch,
      runId: "run-new",
      appliedAt: "2026-06-08T09:00:00.000Z",
      afterDailySnapshot: {
        ...previousSnapshot,
        fetchedAt: "2026-06-08T09:00:00.000Z",
      },
    };

    runTransactionInline();
    mockBatchHistory([replacedBatch]);
    const metricsDeleteSpy = vi
      .spyOn(db.metricsHistory, "delete")
      .mockResolvedValue(undefined as never);
    const metricsPutSpy = vi
      .spyOn(db.metricsHistory, "put")
      .mockResolvedValue(["mintos", "2026-06-08"] as never);
    const batchPutSpy = vi
      .spyOn(db.ingestionBatches, "put")
      .mockResolvedValue(42 as never);

    await revertReplacedIngestionBatch("mintos", {
      batch: originalBatch,
      previousDailySnapshot: previousSnapshot,
    });

    expect(metricsDeleteSpy).toHaveBeenCalledWith(["mintos", "2026-06-08"]);
    expect(metricsPutSpy).toHaveBeenCalledWith(previousSnapshot);
    expect(batchPutSpy).toHaveBeenCalledWith(originalBatch);
  });

  it("creates a new same-day batch and delta rows when financial values change", async () => {
    const timestamp = "2026-06-08T09:10:00.000Z";
    const existingDailySnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-06-08",
      platformValue: 807.83,
      freeCash: 32.76,
      fetchedAt: "2026-06-08T08:45:00.000Z",
      batchId: 42,
    };

    runTransactionInline();
    mockLatestSnapshot(existingDailySnapshot);
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue(existingDailySnapshot as never);
    const batchWhereSpy = mockBatchHistory([]);
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(78 as never);
    const batchUpdateSpy = vi
      .spyOn(db.ingestionBatches, "update")
      .mockResolvedValue(1 as never);
    const deltaAddSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);
    vi.spyOn(db.metricsHistory, "put").mockResolvedValue(["mintos", "2026-06-08"] as never);

    await ingestConnectorResult({
      platformId: "mintos",
      fetchedAt: timestamp,
      warnings: [],
      cashflows: [],
      positions: [],
      overviewMetrics: {
        platformValue: 810,
        freeCash: 32.76,
        currency: "EUR",
        confidence: 0.96,
      },
      riskEvents: [],
    });

    expect(batchWhereSpy).not.toHaveBeenCalled();
    expect(batchUpdateSpy).not.toHaveBeenCalled();
    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        appliedAt: timestamp,
        beforeDailySnapshot: existingDailySnapshot,
      }),
    );
    expect(deltaAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "platformValue",
        oldValue: 807.83,
        newValue: 810,
        batchId: 78,
      }),
    );
  });

  it("keeps a separate daily point when unchanged values are synced on the next day", async () => {
    const timestamp = "2026-06-09T08:45:00.000Z";
    const previousDaySnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-06-08",
      platformValue: 807.83,
      freeCash: 32.76,
      fetchedAt: "2026-06-08T08:45:00.000Z",
    };

    runTransactionInline();
    mockLatestSnapshot(previousDaySnapshot);
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue(undefined);
    const batchWhereSpy = mockBatchHistory([]);
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(79 as never);
    const batchUpdateSpy = vi
      .spyOn(db.ingestionBatches, "update")
      .mockResolvedValue(1 as never);
    const deltaAddSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);
    vi.spyOn(db.metricsHistory, "put").mockResolvedValue(["mintos", "2026-06-09"] as never);

    await ingestConnectorResult({
      platformId: "mintos",
      fetchedAt: timestamp,
      warnings: [],
      cashflows: [],
      positions: [],
      overviewMetrics: {
        platformValue: 807.83,
        freeCash: 32.76,
        currency: "EUR",
        confidence: 0.96,
      },
      riskEvents: [],
    });

    expect(batchWhereSpy).not.toHaveBeenCalled();
    expect(batchUpdateSpy).not.toHaveBeenCalled();
    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        appliedAt: timestamp,
      }),
    );
    expect(deltaAddSpy).not.toHaveBeenCalled();
  });

  it("does not collapse unchanged same-day syncs when child records are present", async () => {
    const timestamp = "2026-06-08T09:15:00.000Z";
    const existingDailySnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-06-08",
      platformValue: 807.83,
      freeCash: 32.76,
      fetchedAt: "2026-06-08T08:45:00.000Z",
      batchId: 42,
    };

    runTransactionInline();
    mockLatestSnapshot(existingDailySnapshot);
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue(existingDailySnapshot as never);
    const batchWhereSpy = mockBatchHistory([]);
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(80 as never);
    const batchUpdateSpy = vi
      .spyOn(db.ingestionBatches, "update")
      .mockResolvedValue(1 as never);
    const deltaAddSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);
    vi.spyOn(db.metricsHistory, "put").mockResolvedValue(["mintos", "2026-06-08"] as never);
    const cashflowAddSpy = vi.spyOn(db.cashflows, "add").mockResolvedValue(1 as never);
    const cashflowBulkAddSpy = vi.spyOn(db.cashflows, "bulkAdd").mockResolvedValue([] as never);

    await ingestConnectorResult({
      platformId: "mintos",
      fetchedAt: timestamp,
      warnings: [],
      cashflows: [
        {
          platformId: "mintos",
          date: "2026-06-08",
          amount: 2,
          currency: "EUR",
          type: "interest_paid",
          taxCategory: "ausgezahlt",
        },
      ],
      positions: [],
      overviewMetrics: {
        platformValue: 807.83,
        freeCash: 32.76,
        currency: "EUR",
        confidence: 0.96,
      },
      riskEvents: [],
    });

    expect(batchWhereSpy).not.toHaveBeenCalled();
    expect(batchUpdateSpy).not.toHaveBeenCalled();
    expect(deltaAddSpy).not.toHaveBeenCalled();
    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        appliedAt: timestamp,
        cashflowCount: 1,
      }),
    );
    expect(cashflowBulkAddSpy).toHaveBeenCalledWith([
      expect.objectContaining({
        platformId: "mintos",
        batchId: 80,
      }),
    ]);
    expect(cashflowAddSpy).not.toHaveBeenCalled();
  });

  it("keeps normal batch history when the previous same-day batch has child records", async () => {
    const timestamp = "2026-06-08T09:20:00.000Z";
    const existingOverview: StoredOverviewMetrics = {
      platformId: "mintos",
      platformValue: 807.83,
      freeCash: 32.76,
      currency: "EUR",
      confidence: 0.91,
      fetchedAt: "2026-06-08T08:45:00.000Z",
    };
    const existingDailySnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-06-08",
      platformValue: 807.83,
      freeCash: 32.76,
      fetchedAt: "2026-06-08T08:45:00.000Z",
      batchId: 42,
    };
    const childBatch: StoredIngestionBatch = {
      id: 42,
      platformId: "mintos",
      sourceKind: "sync",
      appliedAt: "2026-06-08T08:45:00.000Z",
      revertible: true,
      legacyBackfilled: false,
      afterOverview: existingOverview,
      afterDailySnapshot: existingDailySnapshot,
      cashflowCount: 1,
      positionCount: 0,
      riskEventCount: 0,
    };

    runTransactionInline();
    mockLatestSnapshot(existingDailySnapshot);
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue(existingDailySnapshot as never);
    const batchWhereSpy = mockBatchHistory([childBatch]);
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(81 as never);
    const batchUpdateSpy = vi
      .spyOn(db.ingestionBatches, "update")
      .mockResolvedValue(1 as never);
    const deltaAddSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);
    vi.spyOn(db.metricsHistory, "put").mockResolvedValue(["mintos", "2026-06-08"] as never);

    await ingestConnectorResult({
      platformId: "mintos",
      fetchedAt: timestamp,
      warnings: [],
      cashflows: [],
      positions: [],
      overviewMetrics: {
        platformValue: 807.83,
        freeCash: 32.76,
        currency: "EUR",
        confidence: 0.96,
      },
      riskEvents: [],
    });

    expect(batchWhereSpy).toHaveBeenCalledWith("[platformId+appliedAt+id]");
    expect(batchUpdateSpy).not.toHaveBeenCalled();
    expect(deltaAddSpy).not.toHaveBeenCalled();
    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        appliedAt: timestamp,
        beforeDailySnapshot: existingDailySnapshot,
      }),
    );
  });

  it("backfills legacy delta rows into non-revertible batch history entries", async () => {
    const legacyLogs: StoredDeltaLog[] = [
      {
        id: 11,
        platformId: "mintos",
        timestamp: "2026-05-19T10:00:00.000Z",
        field: "platformValue",
        oldValue: 1000,
        newValue: 1200,
        delta: 200,
      },
      {
        id: 12,
        platformId: "mintos",
        timestamp: "2026-05-19T10:00:00.000Z",
        field: "freeCash",
        oldValue: 100,
        newValue: 150,
        delta: 50,
      },
    ];

    const groupedBatches: StoredIngestionBatch[] = [
      {
        id: 90,
        platformId: "mintos",
        sourceKind: "sync",
        appliedAt: "2026-05-19T10:00:00.000Z",
        revertible: false,
        legacyBackfilled: true,
        beforeOverview: {
          platformId: "mintos",
          platformValue: 1000,
          freeCash: 100,
          currency: "EUR",
          confidence: 0,
          fetchedAt: "2026-05-19T10:00:00.000Z",
        },
        afterOverview: {
          platformId: "mintos",
          platformValue: 1200,
          freeCash: 150,
          currency: "EUR",
          confidence: 0,
          fetchedAt: "2026-05-19T10:00:00.000Z",
        },
        cashflowCount: 0,
        positionCount: 0,
        riskEventCount: 0,
      },
    ];

    const ingestionWhereSpy = vi
      .spyOn(db.ingestionBatches, "where")
      .mockReturnValue({
        equals: () => ({
          toArray: vi.fn().mockResolvedValue(groupedBatches),
        }),
        between: () => ({
          reverse: () => ({
            limit: () => ({
              toArray: vi.fn().mockResolvedValue(groupedBatches),
            }),
            toArray: vi.fn().mockResolvedValue(groupedBatches),
          }),
        }),
      } as never);
    const deltaWhereSpy = vi
      .spyOn(db.deltaLogs, "where")
      .mockReturnValue({
        equals: () => ({
          toArray: vi.fn().mockResolvedValue(legacyLogs),
        }),
      } as never);
    const batchAddSpy = vi
      .spyOn(db.ingestionBatches, "add")
      .mockResolvedValue(90 as never);
    const deltaUpdateSpy = vi
      .spyOn(db.deltaLogs, "update")
      .mockResolvedValue(1 as never);
    runTransactionInline();

    await backfillLegacyBatchHistoryForMigration("mintos");
    const history = await getPlatformBatchHistory("mintos");

    expect(history).toHaveLength(1);
    expect(history[0]).toEqual(
      expect.objectContaining({
        id: 90,
        revertible: false,
        legacyBackfilled: true,
      }),
    );
    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        revertible: false,
        legacyBackfilled: true,
      }),
    );
    expect(deltaUpdateSpy).toHaveBeenCalledWith(11, { batchId: 90 });
    expect(deltaUpdateSpy).toHaveBeenCalledWith(12, { batchId: 90 });
    expect(ingestionWhereSpy).toHaveBeenCalledWith("[platformId+appliedAt+id]");
    expect(deltaWhereSpy).toHaveBeenCalledWith("platformId");
  });

  it("reads batch history without scanning legacy delta logs", async () => {
    const batch: StoredIngestionBatch = {
      id: 99,
      platformId: "mintos",
      sourceKind: "sync",
      appliedAt: "2026-05-22T12:00:00.000Z",
      revertible: true,
      legacyBackfilled: false,
      cashflowCount: 0,
      positionCount: 0,
      riskEventCount: 0,
    };
    mockBatchHistory([batch]);
    const deltaWhereSpy = vi.spyOn(db.deltaLogs, "where");

    const history = await getPlatformBatchHistory("mintos");

    expect(history).toEqual([batch]);
    expect(deltaWhereSpy).not.toHaveBeenCalled();
  });

  it("reverts the latest batch to the previous daily snapshot", async () => {
    const previousSnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-05-21",
      platformValue: 9990,
      freeCash: 490,
      netAnnualReturnPct: 9.9,
      fetchedAt: "2026-05-21T08:00:00.000Z",
    };
    const latestBatch: StoredIngestionBatch = {
      id: 77,
      platformId: "mintos",
      sourceKind: "sync",
      runId: "run-42",
      appliedAt: "2026-05-21T12:00:00.000Z",
      revertible: true,
      legacyBackfilled: false,
      afterOverview: {
        platformId: "mintos",
        platformValue: 10250,
        freeCash: 525,
        netAnnualReturnPct: 10.25,
        currency: "EUR",
        confidence: 0.95,
        fetchedAt: "2026-05-21T12:00:00.000Z",
      },
      beforeDailySnapshot: previousSnapshot,
      afterDailySnapshot: {
        platformId: "mintos",
        date: "2026-05-21",
        platformValue: 10250,
        freeCash: 525,
        netAnnualReturnPct: 10.25,
        fetchedAt: "2026-05-21T12:00:00.000Z",
        batchId: 77,
      },
      cashflowCount: 1,
      positionCount: 1,
      riskEventCount: 1,
    };

    mockBatchHistory([latestBatch]);
    runTransactionInline();
    const metricsDeleteSpy = vi.spyOn(db.metricsHistory, "delete").mockResolvedValue(undefined as never);
    const metricsPutSpy = vi.spyOn(db.metricsHistory, "put").mockResolvedValue(["mintos", "2026-05-21"] as never);
    const batchDeleteSpy = vi.spyOn(db.ingestionBatches, "delete").mockResolvedValue(undefined as never);
    const cashflowDeleteSpy = mockDeleteByBatchId(db.cashflows);
    const positionDeleteSpy = mockDeleteByBatchId(db.positions);
    const riskEventDeleteSpy = mockDeleteByBatchId(db.riskEvents);
    const deltaDeleteSpy = mockDeleteByBatchId(db.deltaLogs);

    await revertPlatformBatch("mintos", 77);

    expect(metricsDeleteSpy).toHaveBeenCalledWith(["mintos", "2026-05-21"]);
    expect(metricsPutSpy).toHaveBeenCalledWith(previousSnapshot);
    expect(cashflowDeleteSpy).toHaveBeenCalled();
    expect(positionDeleteSpy).toHaveBeenCalled();
    expect(riskEventDeleteSpy).toHaveBeenCalled();
    expect(deltaDeleteSpy).toHaveBeenCalled();
    expect(batchDeleteSpy).toHaveBeenCalledWith(77);
  });

  it("validates the latest batch inside the revert transaction", async () => {
    const events: string[] = [];
    const latestBatch: StoredIngestionBatch = {
      id: 77,
      platformId: "mintos",
      sourceKind: "sync",
      appliedAt: "2026-05-21T12:00:00.000Z",
      revertible: true,
      legacyBackfilled: false,
      cashflowCount: 0,
      positionCount: 0,
      riskEventCount: 0,
    };

    vi.spyOn(db.ingestionBatches, "where").mockImplementation((() => {
      events.push("read-batches");
      return {
        between: () => ({
          reverse: () => ({
            limit: () => ({
              toArray: vi.fn().mockResolvedValue([latestBatch]),
            }),
            toArray: vi.fn().mockResolvedValue([latestBatch]),
          }),
        }),
      };
    }) as never);
    vi.spyOn(db, "transaction").mockImplementation((async (...args: unknown[]) => {
      events.push("transaction-start");
      const callback = args.at(-1) as () => Promise<void>;
      return callback();
    }) as never);
    vi.spyOn(db.ingestionBatches, "delete").mockResolvedValue(undefined as never);
    mockDeleteByBatchId(db.cashflows);
    mockDeleteByBatchId(db.positions);
    mockDeleteByBatchId(db.riskEvents);
    mockDeleteByBatchId(db.deltaLogs);

    await revertPlatformBatch("mintos", 77);

    expect(events).toEqual(["transaction-start", "read-batches"]);
  });

  it("deletes the imported snapshot when reverting an initial import without previous state", async () => {
    const initialBatch: StoredIngestionBatch = {
      id: 88,
      platformId: "mintos",
      sourceKind: "sync",
      runId: "run-88",
      appliedAt: "2026-05-21T12:00:00.000Z",
      revertible: true,
      legacyBackfilled: false,
      afterOverview: {
        platformId: "mintos",
        platformValue: 10250,
        freeCash: 525,
        currency: "EUR",
        confidence: 0.95,
        fetchedAt: "2026-05-21T12:00:00.000Z",
      },
      afterDailySnapshot: {
        platformId: "mintos",
        date: "2026-05-21",
        platformValue: 10250,
        freeCash: 525,
        fetchedAt: "2026-05-21T12:00:00.000Z",
        batchId: 88,
      },
      cashflowCount: 0,
      positionCount: 0,
      riskEventCount: 0,
    };

    mockBatchHistory([initialBatch]);
    runTransactionInline();
    const metricsDeleteSpy = vi.spyOn(db.metricsHistory, "delete").mockResolvedValue(undefined as never);
    const metricsPutSpy = vi.spyOn(db.metricsHistory, "put").mockResolvedValue(["mintos", "2026-05-21"] as never);
    vi.spyOn(db.ingestionBatches, "delete").mockResolvedValue(undefined as never);
    mockDeleteByBatchId(db.cashflows);
    mockDeleteByBatchId(db.positions);
    mockDeleteByBatchId(db.riskEvents);
    mockDeleteByBatchId(db.deltaLogs);

    await revertPlatformBatch("mintos", 88);

    expect(metricsDeleteSpy).toHaveBeenCalledWith(["mintos", "2026-05-21"]);
    expect(metricsPutSpy).not.toHaveBeenCalled();
  });

  it("does not touch metrics history when reverting a batch that only added child records", async () => {
    const childOnlyBatch: StoredIngestionBatch = {
      id: 91,
      platformId: "mintos",
      sourceKind: "sync",
      runId: "run-91",
      appliedAt: "2026-05-22T12:00:00.000Z",
      revertible: true,
      legacyBackfilled: false,
      cashflowCount: 1,
      positionCount: 1,
      riskEventCount: 1,
    };

    mockBatchHistory([childOnlyBatch]);
    runTransactionInline();
    const metricsDeleteSpy = vi.spyOn(db.metricsHistory, "delete").mockResolvedValue(undefined as never);
    const metricsPutSpy = vi.spyOn(db.metricsHistory, "put").mockResolvedValue(["mintos", "2026-05-22"] as never);
    vi.spyOn(db.ingestionBatches, "delete").mockResolvedValue(undefined as never);
    mockDeleteByBatchId(db.cashflows);
    mockDeleteByBatchId(db.positions);
    mockDeleteByBatchId(db.riskEvents);
    mockDeleteByBatchId(db.deltaLogs);

    await revertPlatformBatch("mintos", 91);

    expect(metricsPutSpy).not.toHaveBeenCalled();
    expect(metricsDeleteSpy).not.toHaveBeenCalled();
  });

  it("rejects reverting a batch that is not the latest batch for the platform", async () => {
    mockBatchHistory([
      {
        id: 71,
        platformId: "mintos",
        sourceKind: "sync",
        appliedAt: "2026-05-21T12:00:00.000Z",
        revertible: true,
        legacyBackfilled: false,
        cashflowCount: 0,
        positionCount: 0,
        riskEventCount: 0,
      },
    ]);
    runTransactionInline();

    await expect(revertPlatformBatch("mintos", 70)).rejects.toThrow(
      "Only the latest import can be reverted",
    );
  });
});
