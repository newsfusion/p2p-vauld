/**
 * Page-level extraction quality — used by the sync engine to decide whether the
 * page we landed on is actually the account overview, and to compare pages when
 * the dashboard navigation ladder visits several of them.
 *
 * The problem this solves: a numeric value alone proves nothing. An investments
 * list is full of currency amounts that score ~2.4 purely from being currency
 * (+2 type match, +0.4 magnitude) without a single label keyword. Those pass a
 * null check but are not the portfolio value. Real evidence means the value sits
 * next to a label we recognise, was found by a platform CSS selector, or came
 * from a stored profile.
 *
 * Pure math + data — no DOM or Chrome API dependencies.
 */

import { HIGH_SCORE_THRESHOLD } from "./scoring.js";
import type { ExtractionCandidate } from "./types/index.js";

/** Warnings that mean the two signals contradict each other on this page. */
const CONTRADICTION_WARNINGS = [
  "duplicate_signal_candidate",
  "free_cash_exceeds_portfolio",
];

const CONTRADICTION_PENALTY = 0.75;

export interface SignalQualityInput {
  value: number | null;
  candidate?: ExtractionCandidate | undefined;
  allCandidates?: ExtractionCandidate[] | undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function winningCandidate(
  input: SignalQualityInput,
): ExtractionCandidate | undefined {
  return input.candidate ?? input.allCandidates?.[0];
}

/**
 * True when the extracted value rests on real evidence, not just "it is a number
 * and it looks like money". Requires both a recognisable provenance and a score
 * high enough to auto-select.
 */
export function isWellEvidenced(input: SignalQualityInput): boolean {
  if (input.value === null) return false;
  const candidate = winningCandidate(input);
  if (!candidate) return false;

  const hasProvenance =
    candidate.origin === "selector" ||
    candidate.source === "stored" ||
    candidate.source === "selector_supported" ||
    (candidate.keywordHits ?? 0) > 0;
  if (!hasProvenance) return false;

  return candidate.score >= HIGH_SCORE_THRESHOLD;
}

function topScore(input: SignalQualityInput): number {
  return winningCandidate(input)?.score ?? 0;
}

/**
 * Comparable quality of a page's extraction result. Portfolio value is weighted
 * above free cash — a page that proves the portfolio value is the overview, a
 * page that only proves free cash usually is not.
 */
export function pageQualityScore(input: {
  portfolio: SignalQualityInput;
  freeCash: SignalQualityInput;
  warnings?: string[];
}): number {
  let score = 0;
  if (isWellEvidenced(input.portfolio)) score += 2;
  if (isWellEvidenced(input.freeCash)) score += 1;

  score += clamp01(topScore(input.portfolio) / 6) * 0.5;
  score += clamp01(topScore(input.freeCash) / 6) * 0.5;

  const warnings = input.warnings ?? [];
  if (warnings.some((warning) => CONTRADICTION_WARNINGS.includes(warning))) {
    score -= CONTRADICTION_PENALTY;
  }

  return score;
}
