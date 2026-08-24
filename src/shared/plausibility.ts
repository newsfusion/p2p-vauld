import type {
  ExtractionChoiceSignalKey,
  StoredMetricsSnapshot,
} from "./types/index.js";

export type PlausibilityStatus = "ok" | "unknown" | "suspicious" | "placeholder";

export interface PlausibilityResult {
  status: PlausibilityStatus;
  reasons: string[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function hasNonZeroHistory(
  signalKey: ExtractionChoiceSignalKey,
  history: StoredMetricsSnapshot[],
): boolean {
  return history.some((snapshot) => {
    const value =
      signalKey === "portfolio_value" ? snapshot.platformValue : snapshot.freeCash;
    return Math.abs(value) > 0.01;
  });
}

export function assessValue({
  signalKey,
  value,
  history,
}: {
  signalKey: ExtractionChoiceSignalKey;
  value: number | null;
  history: StoredMetricsSnapshot[];
}): PlausibilityResult {
  if (value === null) return { status: "unknown", reasons: ["missing_value"] };
  if (history.length === 0) return { status: "unknown", reasons: ["no_history"] };

  if (Math.abs(value) < 0.01 && hasNonZeroHistory(signalKey, history)) {
    return { status: "placeholder", reasons: ["placeholder_zero"] };
  }

  if (signalKey === "portfolio_value") {
    const recentMedian = median(
      history
        .slice(0, 5)
        .map((snapshot) => snapshot.platformValue)
        .filter((entry) => Math.abs(entry) > 0.01),
    );
    if (recentMedian !== null) {
      const deltaPct = Math.abs(value - recentMedian) / Math.max(Math.abs(recentMedian), 1);
      if (deltaPct > 0.4) {
        return {
          status: "suspicious",
          reasons: ["portfolio_delta_gt_40pct"],
        };
      }
    }
  }

  return { status: "ok", reasons: [] };
}

export function assessOverviewInvariants({
  portfolioValue,
  freeCash,
  history,
}: {
  portfolioValue: number | null;
  freeCash: number | null;
  history: StoredMetricsSnapshot[];
}): PlausibilityResult {
  if (portfolioValue === null || freeCash === null) {
    return { status: "unknown", reasons: ["missing_value"] };
  }

  if (freeCash > portfolioValue * 1.02 + 1) {
    const comparableHistory = history.filter(
      (snapshot) =>
        Number.isFinite(snapshot.platformValue) &&
        Number.isFinite(snapshot.freeCash),
    );
    const invariantEstablished =
      comparableHistory.length >= 2 &&
      comparableHistory.every(
        (snapshot) => snapshot.freeCash <= snapshot.platformValue * 1.02 + 1,
      );

    if (!invariantEstablished) {
      return {
        status: "unknown",
        reasons: ["invariant_not_established"],
      };
    }

    return {
      status: "suspicious",
      reasons: ["free_cash_exceeds_portfolio_value"],
    };
  }

  return { status: "ok", reasons: [] };
}
