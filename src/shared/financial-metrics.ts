import type {
  PlatformId,
  StoredCashflow,
  StoredMetricsSnapshot,
  StoredOverviewMetrics,
} from "./types/index.js";

export type ConcentrationStatus =
  | "healthy"
  | "watch"
  | "elevated"
  | "critical";

export interface PortfolioConcentrationEntry {
  platformId: PlatformId | string;
  name: string;
  totalValue: number;
}

export interface PortfolioConcentrationMetrics {
  totalValue: number;
  topPlatform?: {
    platformId: PlatformId | string;
    name: string;
  };
  topPlatformSharePct: number;
  topPlatformValue: number;
  excessConcentrationEur: number;
  hhi: number;
  effectivePlatformCount: number;
  diversificationScore: number;
  status: ConcentrationStatus;
}

export interface ExposureTrendPoint {
  date: string;
  exposurePct: number;
  excessConcentrationEur: number;
  topPlatformId?: PlatformId | string;
}

export interface DailyPortfolioSeriesPoint {
  date: string;
  entries: PortfolioConcentrationEntry[];
  totalValue: number;
}

const DEFAULT_CONCENTRATION_LIMIT_PCT = 30;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function statusForTopShare(
  topSharePct: number,
  concentrationLimitPct: number,
): ConcentrationStatus {
  if (topSharePct > 60) return "critical";
  if (topSharePct > 40) return "elevated";
  if (topSharePct > concentrationLimitPct) return "watch";
  return "healthy";
}

export function calculatePortfolioConcentration(
  entries: PortfolioConcentrationEntry[],
  concentrationLimitPct = DEFAULT_CONCENTRATION_LIMIT_PCT,
): PortfolioConcentrationMetrics {
  const positiveEntries = entries.filter((entry) => entry.totalValue > 0);
  const totalValue = positiveEntries.reduce(
    (sum, entry) => sum + entry.totalValue,
    0,
  );

  if (totalValue <= 0) {
    return {
      totalValue: 0,
      topPlatformSharePct: 0,
      topPlatformValue: 0,
      excessConcentrationEur: 0,
      hhi: 0,
      effectivePlatformCount: 0,
      diversificationScore: 0,
      status: "healthy",
    };
  }

  const sorted = [...positiveEntries].sort(
    (a, b) => b.totalValue - a.totalValue,
  );
  const top = sorted[0]!;
  const topPlatformSharePct = (top.totalValue / totalValue) * 100;
  const hhi = positiveEntries.reduce((sum, entry) => {
    const sharePct = (entry.totalValue / totalValue) * 100;
    return sum + sharePct ** 2;
  }, 0);
  const allowedValue = totalValue * (concentrationLimitPct / 100);
  const excessConcentrationEur = positiveEntries.reduce(
    (sum, entry) => sum + Math.max(0, entry.totalValue - allowedValue),
    0,
  );

  return {
    totalValue: round(totalValue),
    topPlatform: {
      platformId: top.platformId,
      name: top.name,
    },
    topPlatformSharePct: round(topPlatformSharePct, 1),
    topPlatformValue: round(top.totalValue),
    excessConcentrationEur: round(excessConcentrationEur),
    hhi: round(hhi),
    effectivePlatformCount: round(10_000 / hhi, 1),
    diversificationScore: round(
      Math.max(0, Math.min(100, 100 - topPlatformSharePct)),
    ),
    status: statusForTopShare(topPlatformSharePct, concentrationLimitPct),
  };
}

function nextIsoDate(date: string): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export function buildDailyPortfolioSeries(
  snapshots: StoredMetricsSnapshot[],
  startDate?: string,
): DailyPortfolioSeriesPoint[] {
  if (snapshots.length === 0) return [];

  const sortedSnapshots = [...snapshots].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const firstVisibleDate = startDate ?? sortedSnapshots[0]!.date;
  const latestSnapshotDate = sortedSnapshots.at(-1)!.date;
  const lastDate =
    latestSnapshotDate < firstVisibleDate ? firstVisibleDate : latestSnapshotDate;

  const snapshotsByDate = new Map<string, StoredMetricsSnapshot[]>();
  const currentValues = new Map<PlatformId | string, number>();
  for (const snapshot of sortedSnapshots) {
    if (snapshot.date < firstVisibleDate) {
      currentValues.set(snapshot.platformId, snapshot.platformValue);
      continue;
    }
    const dailySnapshots = snapshotsByDate.get(snapshot.date) ?? [];
    dailySnapshots.push(snapshot);
    snapshotsByDate.set(snapshot.date, dailySnapshots);
  }

  const series: DailyPortfolioSeriesPoint[] = [];

  for (
    let date = firstVisibleDate;
    date <= lastDate;
    date = nextIsoDate(date)
  ) {
    for (const snapshot of snapshotsByDate.get(date) ?? []) {
      currentValues.set(snapshot.platformId, snapshot.platformValue);
    }

    const entries = [...currentValues.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([platformId, totalValue]) => ({
        platformId,
        name: String(platformId),
        totalValue,
      }));

    series.push({
      date,
      entries,
      totalValue: entries.reduce((sum, entry) => sum + entry.totalValue, 0),
    });
  }

  return series;
}

export function calculateExposureTrendFromSnapshots(
  snapshots: StoredMetricsSnapshot[],
  platformNameById: (platformId: PlatformId | string) => string = (id) =>
    String(id),
  startDate?: string,
): ExposureTrendPoint[] {
  return buildDailyPortfolioSeries(snapshots, startDate).map(
    ({ date, entries }) => {
      const concentration = calculatePortfolioConcentration(
        entries.map((entry) => ({
          ...entry,
          name: platformNameById(entry.platformId),
        })),
        DEFAULT_CONCENTRATION_LIMIT_PCT,
      );
      return {
        date,
        exposurePct: concentration.topPlatformSharePct,
        excessConcentrationEur: concentration.excessConcentrationEur,
        ...(concentration.topPlatform
          ? { topPlatformId: concentration.topPlatform.platformId }
          : {}),
      };
    },
  );
}

export function calculateNetAnnualReturnFromSnapshots({
  cashflows,
  latestMetrics,
  now = new Date(),
}: {
  cashflows: StoredCashflow[];
  latestMetrics: StoredOverviewMetrics | undefined;
  now?: Date;
}): number | null {
  if (!latestMetrics || latestMetrics.platformValue <= 0) return null;

  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 365);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const nowStr = now.toISOString().slice(0, 10);

  const relevantCashflows = cashflows.filter(
    (cashflow) =>
      cashflow.date >= cutoffStr &&
      cashflow.date <= nowStr &&
      (cashflow.type === "interest_paid" ||
        cashflow.type === "interest_accrued"),
  );

  const totalInterest = relevantCashflows.reduce(
    (sum, cashflow) => sum + cashflow.amount,
    0,
  );

  if (totalInterest === 0) return null;

  const earliestDate = relevantCashflows.reduce(
    (earliest, cashflow) =>
      cashflow.date < earliest ? cashflow.date : earliest,
    nowStr,
  );
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const daysCovered = Math.max(
    1,
    Math.ceil(
      (Date.parse(`${nowStr}T00:00:00.000Z`) -
        Date.parse(`${earliestDate}T00:00:00.000Z`)) /
        millisecondsPerDay,
    ),
  );

  return (
    (totalInterest * (365 / daysCovered) * 100) /
    latestMetrics.platformValue
  );
}
