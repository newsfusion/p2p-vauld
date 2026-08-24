import { afterEach, describe, expect, it, vi } from "vitest";
import {
  db,
  detectAndStoreDelta,
  ingestConnectorResult,
} from "../../src/shared/db/index.js";
import type { StoredMetricsSnapshot } from "../../src/shared/types/index.js";

function mockLatestSnapshot(snapshot: StoredMetricsSnapshot | undefined) {
  return vi.spyOn(db.metricsHistory, "where").mockReturnValue({
    between: () => ({ last: async () => snapshot }),
  } as never);
}

describe("delta log persistence", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates initial delta rows on first import", async () => {
    const timestamp = "2026-05-21T10:00:00.000Z";
    const addSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);

    await detectAndStoreDelta(
      "mintos",
      {
        platformValue: 10250,
        freeCash: 525,
        netAnnualReturnPct: 10.5,
        currency: "EUR",
        confidence: 0.95,
      },
      timestamp,
    );

    expect(addSpy).toHaveBeenCalledTimes(3);
    expect(addSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        platformId: "mintos",
        timestamp,
        field: "platformValue",
        oldValue: 10250,
        newValue: 10250,
        delta: 0,
      }),
    );
    expect(addSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        field: "freeCash",
        oldValue: 525,
        newValue: 525,
        delta: 0,
      }),
    );
    expect(addSpy).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        field: "netAnnualReturnPct",
        oldValue: 10.5,
        newValue: 10.5,
        delta: 0,
      }),
    );
  });

  it("skips delta rows when import values are unchanged", async () => {
    const previous: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-05-20",
      platformValue: 10250,
      freeCash: 525,
      netAnnualReturnPct: 10.5,
      currency: "EUR",
      confidence: 0.95,
      fetchedAt: "2026-05-20T10:00:00.000Z",
    };

    const addSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);

    await detectAndStoreDelta(
      "mintos",
      {
        platformValue: 10250,
        freeCash: 525,
        netAnnualReturnPct: 10.5,
        currency: "EUR",
        confidence: 0.95,
      },
      "2026-05-21T10:00:00.000Z",
      undefined,
      previous,
    );

    expect(addSpy).not.toHaveBeenCalled();
  });

  it("writes standard non-zero delta rows during later imports", async () => {
    const timestamp = "2026-05-21T12:00:00.000Z";
    const previousSnapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-05-20",
      platformValue: 10000,
      freeCash: 500,
      netAnnualReturnPct: 10,
      currency: "EUR",
      confidence: 0.9,
      fetchedAt: "2026-05-20T12:00:00.000Z",
    };

    const deltaAddSpy = vi.spyOn(db.deltaLogs, "add").mockResolvedValue(1 as never);
    const batchAddSpy = vi.spyOn(db.ingestionBatches, "add").mockResolvedValue(99 as never);
    const snapshotPutSpy = vi.spyOn(db.metricsHistory, "put").mockResolvedValue([
      "mintos",
      "2026-05-21",
    ] as never);

    vi.spyOn(db, "transaction").mockImplementation((async (...args: unknown[]) => {
      const callback = args.at(-1) as () => Promise<void>;
      return callback();
    }) as never);
    mockLatestSnapshot(previousSnapshot);
    vi.spyOn(db.metricsHistory, "get").mockResolvedValue(undefined);

    await ingestConnectorResult({
      platformId: "mintos",
      fetchedAt: timestamp,
      warnings: [],
      cashflows: [],
      positions: [],
      overviewMetrics: {
        platformValue: 10250,
        freeCash: 525,
        netAnnualReturnPct: 10.25,
        currency: "EUR",
        confidence: 0.95,
      },
      riskEvents: [],
    });

    expect(batchAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        revertible: true,
        legacyBackfilled: false,
      }),
    );

    expect(deltaAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "platformValue",
        oldValue: 10000,
        newValue: 10250,
        delta: 250,
      }),
    );
    expect(deltaAddSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        field: "freeCash",
        oldValue: 500,
        newValue: 525,
        delta: 25,
      }),
    );
    expect(snapshotPutSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        date: "2026-05-21",
        platformValue: 10250,
        freeCash: 525,
        fetchedAt: timestamp,
        batchId: 99,
      }),
    );
  });
});
