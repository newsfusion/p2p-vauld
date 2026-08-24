import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backfillOverviewMetricsIntoHistory,
  db,
  deleteMetricsSnapshot,
  getLatestMetrics,
  updateMetricsSnapshot,
} from "../../src/shared/db/index.js";
import { PLATFORM_IDS } from "../../src/shared/types/index.js";
import type {
  StoredMetricsSnapshot,
  StoredOverviewMetrics,
} from "../../src/shared/types/index.js";

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

describe("metrics history as source of truth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getLatestMetrics", () => {
    it("derives overview metrics from the latest snapshot per platform", async () => {
      const whereSpy = mockLatestSnapshots({
        mintos: {
          platformId: "mintos",
          date: "2026-06-10",
          platformValue: 1000,
          freeCash: 25,
          netAnnualReturnPct: 9.5,
          fetchedAt: "2026-06-10T12:00:00.000Z",
          currency: "EUR",
          confidence: 0.9,
          warnings: ["suspect"],
        },
      });
      const orderBySpy = vi.spyOn(db.metricsHistory, "orderBy");

      const metrics = await getLatestMetrics();

      expect(orderBySpy).not.toHaveBeenCalled();
      expect(whereSpy).toHaveBeenCalledTimes(PLATFORM_IDS.length);
      expect(metrics).toEqual([
        {
          platformId: "mintos",
          fetchedAt: "2026-06-10T12:00:00.000Z",
          platformValue: 1000,
          freeCash: 25,
          netAnnualReturnPct: 9.5,
          currency: "EUR",
          confidence: 0.9,
          warnings: ["suspect"],
        },
      ]);
    });

    it("falls back to EUR/confidence 1 for legacy snapshots without currency", async () => {
      mockLatestSnapshots({
        peerberry: {
          platformId: "peerberry",
          date: "2026-06-01",
          platformValue: 500,
          freeCash: 10,
          fetchedAt: "2026-06-01T08:00:00.000Z",
        },
      });

      const [metric] = await getLatestMetrics();

      expect(metric).toEqual(
        expect.objectContaining({
          platformId: "peerberry",
          currency: "EUR",
          confidence: 1,
        }),
      );
      expect(metric).not.toHaveProperty("warnings");
    });
  });

  describe("updateMetricsSnapshot", () => {
    it("overwrites values, sets confidence and clears warnings", async () => {
      const existing: StoredMetricsSnapshot = {
        platformId: "mintos",
        date: "2026-06-10",
        platformValue: 1000,
        freeCash: 25,
        fetchedAt: "2026-06-10T12:00:00.000Z",
        currency: "EUR",
        confidence: 0.5,
        warnings: ["suspect"],
        batchId: 12,
      };
      vi.spyOn(db.metricsHistory, "get").mockResolvedValue(existing);
      const putSpy = vi
        .spyOn(db.metricsHistory, "put")
        .mockResolvedValue(["mintos", "2026-06-10"] as never);

      await updateMetricsSnapshot("mintos", "2026-06-10", {
        platformValue: 1100,
        freeCash: 30,
      });

      expect(putSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          platformId: "mintos",
          date: "2026-06-10",
          platformValue: 1100,
          freeCash: 30,
          confidence: 1,
          batchId: 12,
        }),
      );
      const stored = putSpy.mock.calls[0]?.[0] as StoredMetricsSnapshot;
      expect(stored).not.toHaveProperty("warnings");
    });

    it("throws when the snapshot does not exist", async () => {
      vi.spyOn(db.metricsHistory, "get").mockResolvedValue(undefined);

      await expect(
        updateMetricsSnapshot("mintos", "2026-06-10", {
          platformValue: 1,
          freeCash: 1,
        }),
      ).rejects.toThrow("History entry not found");
    });
  });

  describe("deleteMetricsSnapshot", () => {
    it("deletes by compound key", async () => {
      const deleteSpy = vi
        .spyOn(db.metricsHistory, "delete")
        .mockResolvedValue(undefined as never);

      await deleteMetricsSnapshot("mintos", "2026-06-10");

      expect(deleteSpy).toHaveBeenCalledWith(["mintos", "2026-06-10"]);
    });
  });

  describe("backfillOverviewMetricsIntoHistory", () => {
    function makeTables(
      overviews: StoredOverviewMetrics[],
      historyByKey: Record<string, StoredMetricsSnapshot>,
    ) {
      const puts: StoredMetricsSnapshot[] = [];
      return {
        puts,
        tables: {
          overviewMetrics: {
            toArray: async () => overviews,
          } as never,
          metricsHistory: {
            get: async (key: [string, string]) =>
              historyByKey[`${key[0]}|${key[1]}`],
            put: async (snapshot: StoredMetricsSnapshot) => {
              puts.push(snapshot);
            },
          } as never,
        },
      };
    }

    it("writes a snapshot for an overview-only platform", async () => {
      const { puts, tables } = makeTables(
        [
          {
            platformId: "mintos",
            fetchedAt: "2026-06-10T12:00:00.000Z",
            platformValue: 1000,
            freeCash: 25,
            currency: "EUR",
            confidence: 0.9,
          },
        ],
        {},
      );

      await backfillOverviewMetricsIntoHistory(tables);

      expect(puts).toEqual([
        expect.objectContaining({
          platformId: "mintos",
          date: "2026-06-10",
          platformValue: 1000,
          freeCash: 25,
          fetchedAt: "2026-06-10T12:00:00.000Z",
          currency: "EUR",
          confidence: 0.9,
        }),
      ]);
    });

    it("overwrites a stale same-day snapshot but keeps a fresher one", async () => {
      const { puts, tables } = makeTables(
        [
          {
            platformId: "mintos",
            fetchedAt: "2026-06-10T12:00:00.000Z",
            platformValue: 1000,
            freeCash: 25,
            currency: "EUR",
            confidence: 0.9,
          },
          {
            platformId: "peerberry",
            fetchedAt: "2026-06-10T06:00:00.000Z",
            platformValue: 500,
            freeCash: 10,
            currency: "EUR",
            confidence: 0.8,
          },
        ],
        {
          // stale snapshot → should be overwritten
          "mintos|2026-06-10": {
            platformId: "mintos",
            date: "2026-06-10",
            platformValue: 999,
            freeCash: 20,
            fetchedAt: "2026-06-10T09:00:00.000Z",
          },
          // fresher snapshot → should be kept
          "peerberry|2026-06-10": {
            platformId: "peerberry",
            date: "2026-06-10",
            platformValue: 500,
            freeCash: 10,
            fetchedAt: "2026-06-10T10:00:00.000Z",
          },
        },
      );

      await backfillOverviewMetricsIntoHistory(tables);

      expect(puts).toHaveLength(1);
      expect(puts[0]).toEqual(
        expect.objectContaining({
          platformId: "mintos",
          platformValue: 1000,
          fetchedAt: "2026-06-10T12:00:00.000Z",
        }),
      );
    });
  });
});
