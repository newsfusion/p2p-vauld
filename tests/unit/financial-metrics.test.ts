import { describe, expect, it } from "vitest";
import {
  buildDailyPortfolioSeries,
  calculateExposureTrendFromSnapshots,
  calculateNetAnnualReturnFromSnapshots,
  calculatePortfolioConcentration,
} from "../../src/shared/financial-metrics.js";
import type {
  StoredCashflow,
  StoredMetricsSnapshot,
  StoredOverviewMetrics,
} from "../../src/shared/types/index.js";

const latestMetrics: StoredOverviewMetrics = {
  platformId: "mintos",
  fetchedAt: "2026-05-18T12:00:00.000Z",
  platformValue: 10_000,
  freeCash: 500,
  currency: "EUR",
  confidence: 1,
};

function cashflow(
  date: string,
  amount: number,
  type: StoredCashflow["type"] = "interest_paid",
): StoredCashflow {
  return {
    platformId: "mintos",
    date,
    amount,
    currency: "EUR",
    type,
    taxCategory: "ausgezahlt",
  };
}

describe("calculateNetAnnualReturnFromSnapshots", () => {
  it("annualizes interest over the covered period", () => {
    const result = calculateNetAnnualReturnFromSnapshots({
      cashflows: [
        cashflow("2026-02-17", 120),
        cashflow("2026-05-01", 80, "interest_accrued"),
        cashflow("2026-01-01", 1_000, "deposit"),
        cashflow("2024-12-31", 999),
      ],
      latestMetrics,
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(result).toBeCloseTo((200 * (365 / 90) * 100) / 10_000, 5);
  });

  it("returns null when no relevant interest or platform value exists", () => {
    expect(
      calculateNetAnnualReturnFromSnapshots({
        cashflows: [cashflow("2026-01-01", 1_000, "deposit")],
        latestMetrics,
        now: new Date("2026-05-18T12:00:00.000Z"),
      }),
    ).toBeNull();

    expect(
      calculateNetAnnualReturnFromSnapshots({
        cashflows: [cashflow("2026-01-01", 100)],
        latestMetrics: { ...latestMetrics, platformValue: 0 },
        now: new Date("2026-05-18T12:00:00.000Z"),
      }),
    ).toBeNull();
  });

  it("ignores future-dated interest cashflows", () => {
    const result = calculateNetAnnualReturnFromSnapshots({
      cashflows: [
        cashflow("2026-02-17", 100),
        cashflow("2026-05-19", 1_000),
      ],
      latestMetrics,
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(result).toBeCloseTo((100 * (365 / 90) * 100) / 10_000, 5);
  });

  it("keeps a full-year interest window effectively unscaled", () => {
    const result = calculateNetAnnualReturnFromSnapshots({
      cashflows: [cashflow("2025-05-18", 200)],
      latestMetrics,
      now: new Date("2026-05-18T12:00:00.000Z"),
    });

    expect(result).toBe(2);
  });
});

function snapshot(
  platformId: StoredMetricsSnapshot["platformId"],
  date: string,
  platformValue: number,
): StoredMetricsSnapshot {
  return {
    platformId,
    date,
    platformValue,
    freeCash: 0,
    fetchedAt: `${date}T12:00:00.000Z`,
  };
}

describe("buildDailyPortfolioSeries", () => {
  it("sorts snapshots and carries each platform value forward across sync gaps", () => {
    const result = buildDailyPortfolioSeries([
      snapshot("mintos", "2026-03-03", 110),
      snapshot("peerberry", "2026-03-02", 50),
      snapshot("mintos", "2026-03-01", 100),
    ]);

    expect(result.map(({ date, totalValue }) => ({ date, totalValue }))).toEqual([
      { date: "2026-03-01", totalValue: 100 },
      { date: "2026-03-02", totalValue: 150 },
      { date: "2026-03-03", totalValue: 160 },
    ]);
    expect(result[2]?.entries).toMatchObject([
      { platformId: "mintos", totalValue: 110 },
      { platformId: "peerberry", totalValue: 50 },
    ]);
  });

  it("creates calendar-day points between sync dates", () => {
    const result = buildDailyPortfolioSeries([
      snapshot("mintos", "2026-03-01", 100),
      snapshot("mintos", "2026-03-03", 120),
    ]);

    expect(result.map(({ date, totalValue }) => ({ date, totalValue }))).toEqual([
      { date: "2026-03-01", totalValue: 100 },
      { date: "2026-03-02", totalValue: 100 },
      { date: "2026-03-03", totalValue: 120 },
    ]);
  });

  it("uses pre-window snapshots as seeds without emitting their dates", () => {
    const result = buildDailyPortfolioSeries(
      [
        snapshot("peerberry", "2026-03-04", 50),
        snapshot("mintos", "2026-03-05", 100),
        snapshot("mintos", "2026-03-07", 110),
      ],
      "2026-03-05",
    );

    expect(result.map(({ date, totalValue }) => ({ date, totalValue }))).toEqual([
      { date: "2026-03-05", totalValue: 150 },
      { date: "2026-03-06", totalValue: 150 },
      { date: "2026-03-07", totalValue: 160 },
    ]);
  });

  it("emits the cutoff day when the window contains only seeds", () => {
    const result = buildDailyPortfolioSeries(
      [snapshot("mintos", "2026-03-04", 100)],
      "2026-03-05",
    );

    expect(result).toMatchObject([
      {
        date: "2026-03-05",
        totalValue: 100,
        entries: [{ platformId: "mintos", totalValue: 100 }],
      },
    ]);
  });

  it("lets a snapshot on the cutoff replace the older seed", () => {
    const result = buildDailyPortfolioSeries(
      [
        snapshot("mintos", "2026-03-04", 100),
        snapshot("mintos", "2026-03-05", 120),
      ],
      "2026-03-05",
    );

    expect(result).toMatchObject([
      {
        date: "2026-03-05",
        totalValue: 120,
        entries: [{ platformId: "mintos", totalValue: 120 }],
      },
    ]);
  });

  it("does not backfill a platform that first appears inside the window", () => {
    const result = buildDailyPortfolioSeries(
      [
        snapshot("mintos", "2026-03-04", 100),
        snapshot("mintos", "2026-03-05", 110),
        snapshot("peerberry", "2026-03-07", 50),
      ],
      "2026-03-05",
    );

    expect(result[0]?.entries).toMatchObject([
      { platformId: "mintos", totalValue: 110 },
    ]);
    expect(result.map((point) => point.totalValue)).toEqual([110, 110, 160]);
  });
});

describe("calculateExposureTrendFromSnapshots", () => {
  it("uses carried-forward values when only one platform syncs on a later day", () => {
    const result = calculateExposureTrendFromSnapshots([
      snapshot("mintos", "2026-03-01", 60),
      snapshot("peerberry", "2026-03-01", 40),
      snapshot("mintos", "2026-03-02", 70),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]?.exposurePct).toBe(60);
    expect(result[1]?.exposurePct).toBeCloseTo(63.6, 1);
    expect(result[1]?.topPlatformId).toBe("mintos");
  });

  it("uses pre-window seeds for the first visible exposure point", () => {
    const result = calculateExposureTrendFromSnapshots(
      [
        snapshot("peerberry", "2026-03-04", 50),
        snapshot("mintos", "2026-03-05", 100),
        snapshot("peerberry", "2026-03-07", 55),
      ],
      undefined,
      "2026-03-05",
    );

    expect(
      result.map(({ date, exposurePct }) => ({ date, exposurePct })),
    ).toEqual([
      { date: "2026-03-05", exposurePct: 66.7 },
      { date: "2026-03-06", exposurePct: 66.7 },
      { date: "2026-03-07", exposurePct: 64.5 },
    ]);
  });
});

describe("calculatePortfolioConcentration", () => {
  it("returns neutral values for an empty portfolio", () => {
    const result = calculatePortfolioConcentration([]);

    expect(result).toMatchObject({
      topPlatformSharePct: 0,
      topPlatformValue: 0,
      excessConcentrationEur: 0,
      hhi: 0,
      effectivePlatformCount: 0,
      diversificationScore: 0,
      status: "healthy",
    });
    expect(result.topPlatform).toBeUndefined();
  });

  it("marks a single-platform portfolio as critical concentration", () => {
    const result = calculatePortfolioConcentration([
      { platformId: "mintos", name: "Mintos", totalValue: 10_000 },
    ]);

    expect(result).toMatchObject({
      topPlatformSharePct: 100,
      topPlatformValue: 10_000,
      excessConcentrationEur: 7_000,
      hhi: 10_000,
      effectivePlatformCount: 1,
      diversificationScore: 0,
      status: "critical",
      topPlatform: { platformId: "mintos", name: "Mintos" },
    });
  });

  it("scores an evenly diversified portfolio as healthy", () => {
    const result = calculatePortfolioConcentration([
      { platformId: "mintos", name: "Mintos", totalValue: 2_500 },
      { platformId: "peerberry", name: "PeerBerry", totalValue: 2_500 },
      { platformId: "estateguru", name: "EstateGuru", totalValue: 2_500 },
      { platformId: "debitum", name: "Debitum", totalValue: 2_500 },
    ]);

    expect(result).toMatchObject({
      topPlatformSharePct: 25,
      topPlatformValue: 2_500,
      excessConcentrationEur: 0,
      hhi: 2_500,
      effectivePlatformCount: 4,
      diversificationScore: 75,
      status: "healthy",
    });
  });

  it("uses watch, elevated and critical thresholds above 30, 40 and 60 percent", () => {
    expect(
      calculatePortfolioConcentration([
        { platformId: "mintos", name: "Mintos", totalValue: 61 },
        { platformId: "peerberry", name: "PeerBerry", totalValue: 39 },
      ]).status,
    ).toBe("critical");

    expect(
      calculatePortfolioConcentration([
        { platformId: "mintos", name: "Mintos", totalValue: 41 },
        { platformId: "peerberry", name: "PeerBerry", totalValue: 30 },
        { platformId: "debitum", name: "Debitum", totalValue: 29 },
      ]).status,
    ).toBe("elevated");

    expect(
      calculatePortfolioConcentration([
        { platformId: "mintos", name: "Mintos", totalValue: 31 },
        { platformId: "peerberry", name: "PeerBerry", totalValue: 23 },
        { platformId: "debitum", name: "Debitum", totalValue: 23 },
        { platformId: "estateguru", name: "EstateGuru", totalValue: 23 },
      ]).status,
    ).toBe("watch");
  });
});
