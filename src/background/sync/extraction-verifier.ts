import type {
  ExtractionCandidate,
  ExtractionChoiceSignalKey,
  StoredMetricsSnapshot,
} from "../../shared/types/index.js";
import { assessValue } from "../../shared/plausibility.js";
import type { ExtractSignalResult } from "./debug-logger.js";
import { abortableDelay, throwIfAborted } from "./cancellation.js";

export interface ExtractionPollResult {
  portfolio_value: ExtractSignalResult;
  free_cash: ExtractSignalResult;
}

export interface ConvergentExtractionResult {
  portfolio: ExtractSignalResult;
  freeCash: ExtractSignalResult;
  pollCount: number;
  converged: boolean;
  warnings: string[];
}

function sameValue(left: ExtractSignalResult, right: ExtractSignalResult): boolean {
  return (
    left.value !== null &&
    right.value !== null &&
    Math.abs(left.value - right.value) <= 0.005
  );
}

function normalizeCandidateText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function sameCandidateValue(
  left: ExtractionCandidate,
  right: ExtractionCandidate,
): boolean {
  return Math.abs(left.value - right.value) <= 0.005;
}

function sameDomIdentity(
  left: ExtractionCandidate,
  right: ExtractionCandidate,
): boolean {
  return (
    left.selector === right.selector &&
    normalizeCandidateText(left.text) === normalizeCandidateText(right.text) &&
    normalizeCandidateText(left.context) === normalizeCandidateText(right.context) &&
    (left.origin ?? "heuristic") === (right.origin ?? "heuristic") &&
    sameCandidateValue(left, right)
  );
}

function isUnsafeHeuristicCandidate(
  candidate: ExtractionCandidate | undefined,
): candidate is ExtractionCandidate {
  if (!candidate) return false;
  if (candidate.origin !== "heuristic") return false;
  return (
    candidate.source !== "stored" &&
    candidate.source !== "gemini_supported" &&
    candidate.source !== "selector_supported"
  );
}

/**
 * Free cash exceeding the portfolio value is almost always an extraction error
 * (a label swap or the wrong number picked). Semantics vary — some platforms do
 * not count uninvested cash inside "invested" — so this is a soft warning that
 * blocks early convergence rather than a hard failure.
 */
export function freeCashExceedsPortfolio(
  portfolio: ExtractSignalResult,
  freeCash: ExtractSignalResult,
): boolean {
  if (portfolio.value === null || freeCash.value === null) return false;
  if (portfolio.value <= 0.01) return false;
  return freeCash.value > portfolio.value * 1.001;
}

export function hasUnsafeDuplicateSignalCandidate(
  portfolio: ExtractSignalResult,
  freeCash: ExtractSignalResult,
): boolean {
  if (!sameValue(portfolio, freeCash)) return false;
  if (!isUnsafeHeuristicCandidate(portfolio.candidate)) return false;
  if (!isUnsafeHeuristicCandidate(freeCash.candidate)) return false;
  return sameDomIdentity(portfolio.candidate, freeCash.candidate);
}

function plausibilityWarnings(
  key: ExtractionChoiceSignalKey,
  result: ExtractSignalResult,
  history: StoredMetricsSnapshot[],
): string[] {
  const assessment = assessValue({ signalKey: key, value: result.value, history });
  return assessment.status === "ok" || assessment.status === "unknown"
    ? []
    : assessment.reasons;
}

export async function runConvergentExtraction({
  extract,
  history,
  intervalMs = 1_200,
  maxWaitMs = 15_000,
  signal,
}: {
  extract: () => Promise<ExtractionPollResult>;
  history: StoredMetricsSnapshot[];
  intervalMs?: number;
  maxWaitMs?: number;
  signal?: AbortSignal;
}): Promise<ConvergentExtractionResult> {
  const startedAt = Date.now();
  let previous: ExtractionPollResult | undefined;
  let latest: ExtractionPollResult | undefined;
  let pollCount = 0;
  let warnings: string[] = [];

  while (Date.now() - startedAt <= maxWaitMs) {
    if (signal) throwIfAborted(signal);
    latest = await extract();
    if (signal) throwIfAborted(signal);
    pollCount += 1;
    warnings = [
      ...plausibilityWarnings("portfolio_value", latest.portfolio_value, history),
      ...plausibilityWarnings("free_cash", latest.free_cash, history),
    ];
    if (
      hasUnsafeDuplicateSignalCandidate(
        latest.portfolio_value,
        latest.free_cash,
      )
    ) {
      warnings.push("duplicate_signal_candidate");
    }
    if (freeCashExceedsPortfolio(latest.portfolio_value, latest.free_cash)) {
      warnings.push("free_cash_exceeds_portfolio");
    }

    if (
      previous &&
      sameValue(previous.portfolio_value, latest.portfolio_value) &&
      sameValue(previous.free_cash, latest.free_cash) &&
      warnings.length === 0
    ) {
      return {
        portfolio: latest.portfolio_value,
        freeCash: latest.free_cash,
        pollCount,
        converged: true,
        warnings,
      };
    }

    previous = latest;
    await abortableDelay(intervalMs, signal);
  }

  if (signal) throwIfAborted(signal);
  const fallback = latest ?? (await extract());
  return {
    portfolio: fallback.portfolio_value,
    freeCash: fallback.free_cash,
    pollCount: Math.max(1, pollCount),
    converged: false,
    warnings,
  };
}
