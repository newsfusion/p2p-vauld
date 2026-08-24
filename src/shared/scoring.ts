/**
 * Shared confidence scoring — used by both content script (extractor) and background (sync).
 * Pure math function with no DOM or Chrome API dependencies.
 */

import type { ExtractionCandidate } from "./types/index.js";

export const PRODUCTION_CONFIDENCE_THRESHOLD = 0.72;

/** A candidate scoring at or above this is strong enough to stand on its own. */
export const HIGH_SCORE_THRESHOLD = 3.0;

export type PlausibilityConfidenceInput =
  | "ok"
  | "unknown"
  | "suspicious"
  | "placeholder";

export interface ConfidenceInput {
  topScore: number;
  secondScore: number | null;
  candidateCount: number;
  agreementCount?: number;
  plausibility?: PlausibilityConfidenceInput;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function valuesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.005;
}

export function countAgreementEvidence(
  candidates: Array<
    Pick<ExtractionCandidate, "value" | "origin" | "geminiSupported">
  >,
  value: number,
): number {
  const origins = new Set<string>();
  for (const candidate of candidates) {
    if (!valuesEqual(candidate.value, value)) continue;
    origins.add(candidate.origin ?? "heuristic");
    if (candidate.geminiSupported) origins.add("gemini");
  }

  if (origins.has("selector")) {
    return Math.max(2, origins.size);
  }

  return Math.max(1, origins.size);
}

export function computeConfidence(input: ConfidenceInput): number {
  const agreementCount = input.agreementCount ?? 1;
  const absoluteEvidence = clamp(input.topScore / 6) * 0.5;
  const rawMargin =
    input.secondScore === null
      ? Math.min(Math.max(0, input.topScore), 2)
      : Math.max(0, input.topScore - input.secondScore);
  const marginEvidence = clamp(rawMargin / 4) * 0.25;
  const agreementBonus =
    agreementCount >= 3 ? 0.3 : agreementCount >= 2 ? 0.22 : 0;
  const ambiguityPenalty =
    input.candidateCount > 1 && input.secondScore !== null && input.topScore - input.secondScore < 1
      ? 0.12
      : 0;

  let confidence = 0.18 + absoluteEvidence + marginEvidence + agreementBonus - ambiguityPenalty;

  if (input.plausibility === "suspicious") confidence = Math.min(confidence, 0.68);
  if (input.plausibility === "placeholder") confidence = Math.min(confidence, 0.35);

  return Math.min(0.95, clamp(confidence));
}
