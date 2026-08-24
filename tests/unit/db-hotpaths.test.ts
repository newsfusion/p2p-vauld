import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDefaultSettings,
  db,
  getCashflowSummary,
  getExtractionTelemetry,
  getMetricsHistoryAll,
  pruneOldData,
} from "../../src/shared/db/index.js";
import type {
  ExtractionTelemetryRecord,
  StoredCashflow,
  StoredMetricsSnapshot,
} from "../../src/shared/types/index.js";

describe("DB hotpath query helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads extraction telemetry through the platform and recordedAt compound index", async () => {
    const records: ExtractionTelemetryRecord[] = [
      {
        id: 2,
        platformId: "mintos",
        runId: "run-2",
        recordedAt: "2026-06-10T12:00:00.000Z",
        signalKey: "portfolio_value",
        stage: "final",
        outcome: "auto_selected",
        candidateCount: 1,
        elementsScanned: 10,
        warnings: [],
      },
    ];
    const toArray = vi.fn().mockResolvedValue(records);
    const limit = vi.fn(() => ({ toArray }));
    const reverse = vi.fn(() => ({ limit }));
    const between = vi.fn(() => ({ reverse }));
    const whereSpy = vi.spyOn(db.extractionTelemetry, "where").mockReturnValue({
      between,
    } as never);
    const platformWhereSpy = vi.spyOn(db.extractionTelemetry, "toArray");

    await expect(getExtractionTelemetry("mintos", 25)).resolves.toEqual(records);

    expect(whereSpy).toHaveBeenCalledWith("[platformId+recordedAt+id]");
    expect(between).toHaveBeenCalledWith(
      expect.arrayContaining(["mintos"]),
      expect.arrayContaining(["mintos"]),
      true,
      true,
    );
    expect(reverse).toHaveBeenCalled();
    expect(limit).toHaveBeenCalledWith(25);
    expect(platformWhereSpy).not.toHaveBeenCalled();
  });

  it("reads an inclusive metrics window and one predecessor per visible platform", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));
    const snapshots: StoredMetricsSnapshot[] = [
      {
        platformId: "mintos",
        date: "2026-06-10",
        platformValue: 1000,
        freeCash: 100,
        fetchedAt: "2026-06-10T12:00:00.000Z",
      },
      {
        platformId: "peerberry",
        date: "2026-06-11",
        platformValue: 500,
        freeCash: 50,
        fetchedAt: "2026-06-11T12:00:00.000Z",
      },
    ];
    const windowToArray = vi.fn().mockResolvedValue(snapshots);
    const aboveOrEqual = vi.fn(() => ({ toArray: windowToArray }));
    const seedByPlatform = new Map<
      StoredMetricsSnapshot["platformId"],
      StoredMetricsSnapshot
    >([
      [
        "mintos",
        {
          platformId: "mintos",
          date: "2026-06-09",
          platformValue: 900,
          freeCash: 90,
          fetchedAt: "2026-06-09T12:00:00.000Z",
        },
      ],
    ]);
    const last = vi.fn(async function (this: {
      platformId: StoredMetricsSnapshot["platformId"];
    }) {
      return seedByPlatform.get(this.platformId);
    });
    const between = vi.fn((lower: unknown[]) => ({
      last: last.bind({
        platformId: lower[0] as StoredMetricsSnapshot["platformId"],
      }),
    }));
    const whereSpy = vi.spyOn(db.metricsHistory, "where").mockImplementation(
      ((index: string) =>
        index === "date" ? { aboveOrEqual } : { between }) as never,
    );

    await expect(getMetricsHistoryAll(10, ["mintos"])).resolves.toEqual({
      cutoffDate: "2026-06-10",
      snapshots: [seedByPlatform.get("mintos"), snapshots[0]],
    });

    expect(whereSpy).toHaveBeenCalledWith("date");
    expect(whereSpy).toHaveBeenCalledWith("[platformId+date]");
    expect(aboveOrEqual).toHaveBeenCalledWith("2026-06-10");
    expect(between).toHaveBeenCalledWith(
      expect.arrayContaining(["mintos"]),
      ["mintos", "2026-06-10"],
      true,
      false,
    );
    expect(between).toHaveBeenCalledTimes(1);
  });

  it("discovers platforms for seed queries when no filter is provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));
    const windowToArray = vi.fn().mockResolvedValue([]);
    const aboveOrEqual = vi.fn(() => ({ toArray: windowToArray }));
    const last = vi.fn().mockResolvedValue(undefined);
    const between = vi.fn(() => ({ last }));
    vi.spyOn(db.metricsHistory, "where").mockImplementation(
      ((index: string) =>
        index === "date" ? { aboveOrEqual } : { between }) as never,
    );
    const uniqueKeys = vi.fn().mockResolvedValue(["mintos", "peerberry"]);
    const orderBySpy = vi.spyOn(db.metricsHistory, "orderBy").mockReturnValue({
      uniqueKeys,
    } as never);

    await expect(getMetricsHistoryAll(10)).resolves.toEqual({
      cutoffDate: "2026-06-10",
      snapshots: [],
    });

    expect(orderBySpy).toHaveBeenCalledWith("platformId");
    expect(uniqueKeys).toHaveBeenCalledOnce();
    expect(between).toHaveBeenCalledTimes(2);
  });

  it("reads all metrics history in chronological order when days is zero", async () => {
    const snapshots: StoredMetricsSnapshot[] = [
      {
        platformId: "mintos",
        date: "2026-06-11",
        platformValue: 1000,
        freeCash: 100,
        fetchedAt: "2026-06-11T12:00:00.000Z",
      },
      {
        platformId: "peerberry",
        date: "2026-06-10",
        platformValue: 500,
        freeCash: 50,
        fetchedAt: "2026-06-10T12:00:00.000Z",
      },
    ];
    const toArray = vi.fn().mockResolvedValue(snapshots);
    const orderBySpy = vi.spyOn(db.metricsHistory, "orderBy").mockReturnValue({
      toArray,
    } as never);
    const whereSpy = vi.spyOn(db.metricsHistory, "where");

    await expect(getMetricsHistoryAll(0)).resolves.toEqual({
      snapshots: [snapshots[1], snapshots[0]],
    });

    expect(orderBySpy).toHaveBeenCalledWith("date");
    expect(orderBySpy).toHaveBeenCalledTimes(1);
    expect(whereSpy).not.toHaveBeenCalled();
    expect(toArray).toHaveBeenCalledOnce();
  });

  it("returns no metrics history when the platform filter is empty", async () => {
    const orderBySpy = vi.spyOn(db.metricsHistory, "orderBy");
    const whereSpy = vi.spyOn(db.metricsHistory, "where");

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));

    await expect(getMetricsHistoryAll(10, [])).resolves.toEqual({
      cutoffDate: "2026-06-10",
      snapshots: [],
    });

    expect(orderBySpy).not.toHaveBeenCalled();
    expect(whereSpy).not.toHaveBeenCalled();
  });

  it("defaults metrics history retention to unlimited", () => {
    expect(createDefaultSettings().historyRetentionDays).toBe(0);
  });

  it("does not prune metrics history when retention is unlimited", async () => {
    vi.spyOn(db, "transaction").mockImplementation((async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>;
      await callback();
    }) as never);
    const metricsWhereSpy = vi.spyOn(db.metricsHistory, "where");
    const metricsOrderSpy = vi.spyOn(db.metricsHistory, "orderBy");
    const deltaDelete = vi.fn().mockResolvedValue(undefined);
    const telemetryDelete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(db.deltaLogs, "where").mockReturnValue({
      below: vi.fn(() => ({ delete: deltaDelete })),
    } as never);
    vi.spyOn(db.extractionTelemetry, "where").mockReturnValue({
      below: vi.fn(() => ({ delete: telemetryDelete })),
    } as never);

    await pruneOldData(0);

    expect(metricsWhereSpy).not.toHaveBeenCalled();
    expect(metricsOrderSpy).not.toHaveBeenCalled();
    expect(deltaDelete).toHaveBeenCalled();
    expect(telemetryDelete).toHaveBeenCalled();
  });

  it("prunes finite metrics history while preserving each platform latest snapshot", async () => {
    vi.spyOn(db, "transaction").mockImplementation((async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>;
      await callback();
    }) as never);
    const metricsDelete = vi.fn().mockResolvedValue(undefined);
    const filter = vi.fn((_predicate: (snapshot: StoredMetricsSnapshot) => boolean) => ({ delete: metricsDelete }));
    const below = vi.fn(() => ({ filter }));
    const first = vi.fn().mockResolvedValue({ platformId: "mintos", date: "2026-07-01" });
    const reverse = vi.fn(() => ({ first }));
    const last = vi.fn().mockResolvedValue({ platformId: "mintos", date: "2026-07-01" });
    const between = vi.fn(() => ({ reverse, last }));
    vi.spyOn(db.metricsHistory, "orderBy").mockReturnValue({
      uniqueKeys: vi.fn(async () => ["mintos"]),
    } as never);
    vi.spyOn(db.metricsHistory, "where").mockImplementation(((index: string) => {
      if (index === "[platformId+date]") return { between } as never;
      return { below } as never;
    }) as never);
    vi.spyOn(db.deltaLogs, "where").mockReturnValue({
      below: vi.fn(() => ({ delete: vi.fn().mockResolvedValue(undefined) })),
    } as never);
    vi.spyOn(db.extractionTelemetry, "where").mockReturnValue({
      below: vi.fn(() => ({ delete: vi.fn().mockResolvedValue(undefined) })),
    } as never);

    await pruneOldData(365);

    expect(between).toHaveBeenCalled();
    expect(below).toHaveBeenCalled();
    expect(filter).toHaveBeenCalled();
    const predicate = filter.mock.calls[0]?.[0] as
      | ((snapshot: StoredMetricsSnapshot) => boolean)
      | undefined;
    expect(predicate?.({
      platformId: "mintos",
      date: "2026-07-01",
      fetchedAt: "2026-07-01T00:00:00.000Z",
      platformValue: 1,
      freeCash: 0,
    })).toBe(false);
    expect(predicate?.({
      platformId: "mintos",
      date: "2025-01-01",
      fetchedAt: "2025-01-01T00:00:00.000Z",
      platformValue: 1,
      freeCash: 0,
    })).toBe(true);
  });

  it("summarizes cashflows from the latest available month window without full-table scans", async () => {
    const cashflows: StoredCashflow[] = [
      {
        platformId: "mintos",
        date: "2026-04-15",
        amount: 10,
        currency: "EUR",
        type: "interest_paid",
        taxCategory: "ausgezahlt",
      },
      {
        platformId: "mintos",
        date: "2026-06-01",
        amount: 50,
        currency: "EUR",
        type: "deposit",
        taxCategory: "neutral",
      },
    ];
    const first = vi.fn().mockResolvedValue({
      ...cashflows[1],
      date: "2026-06-01",
    });
    const reverse = vi.fn(() => ({ first }));
    const orderBySpy = vi.spyOn(db.cashflows, "orderBy").mockReturnValue({
      reverse,
    } as never);
    const toArray = vi.fn().mockResolvedValue(cashflows);
    const aboveOrEqual = vi.fn(() => ({ toArray }));
    const whereSpy = vi.spyOn(db.cashflows, "where").mockReturnValue({
      aboveOrEqual,
    } as never);
    const fullScanSpy = vi.spyOn(db.cashflows, "toArray");

    await expect(getCashflowSummary(3, ["mintos"])).resolves.toEqual([
      { period: "2026-04", interestEur: 10, netContributionEur: 0 },
      { period: "2026-06", interestEur: 0, netContributionEur: 50 },
    ]);

    expect(orderBySpy).toHaveBeenCalledWith("date");
    expect(whereSpy).toHaveBeenCalledWith("date");
    expect(aboveOrEqual).toHaveBeenCalledWith("2026-04-01");
    expect(fullScanSpy).not.toHaveBeenCalled();
  });
});
