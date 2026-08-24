import type {
  ExtractionCandidate,
  FinancialSignalKey,
  SelectorProfile,
} from "./types/index.js";
import {
  computeConfidence,
  countAgreementEvidence,
  HIGH_SCORE_THRESHOLD,
} from "./scoring.js";

const CLOSE_SCORE_MARGIN = 1.0;
const VALUE_EPSILON = 0.005;
const AUTO_SELECT_CONFIDENCE_THRESHOLD = 0.7;
export const GEMINI_ONLY_SELECTOR = "ai-extracted";

export interface GeminiChoiceValue {
  value: number;
  currency: string;
}

export type ExtractionChoiceDecision =
  | {
      kind: "selected";
      source: "stored" | "gemini_supported" | "selector_supported" | "heuristic";
      value: number;
      confidence: number;
      candidate: ExtractionCandidate;
      allCandidates: ExtractionCandidate[];
      warnings?: string[];
    }
  | {
      kind: "gemini_only";
      source: "gemini_only";
      value: number;
      confidence: number;
      currency: string;
      allCandidates: ExtractionCandidate[];
      candidate?: undefined;
    }
  | {
      kind: "choice_required";
      source: "user";
      candidates: ExtractionCandidate[];
      allCandidates: ExtractionCandidate[];
    }
  | {
      kind: "missing";
      source: "none";
      allCandidates: ExtractionCandidate[];
    };

export function isChoiceSignal(
  signalKey: FinancialSignalKey,
): signalKey is "portfolio_value" | "free_cash" {
  return signalKey === "portfolio_value" || signalKey === "free_cash";
}

function normalizeFingerprintText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[€$£%]/g, " ")
    .replace(/\b(eur|usd|gbp|pln|czk|sek|nok)\b/g, " ")
    .replace(/[+-]?\d[\d\s.,-]*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

export function createCandidateFingerprint(
  signalKey: FinancialSignalKey,
  candidate: Pick<ExtractionCandidate, "selector" | "text" | "context">,
): string {
  const label = normalizeFingerprintText(
    `${candidate.context ?? ""} ${candidate.text ?? ""}`,
  );
  return [signalKey, candidate.selector, label].join("|");
}

function valuesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= VALUE_EPSILON;
}

function preferChoiceRepresentative(
  current: ExtractionCandidate,
  candidate: ExtractionCandidate,
): ExtractionCandidate {
  if (candidate.score !== current.score) {
    return candidate.score > current.score ? candidate : current;
  }

  if (candidate.geminiSupported !== current.geminiSupported) {
    return candidate.geminiSupported ? candidate : current;
  }

  if (current.selector === GEMINI_ONLY_SELECTOR) return current;
  if (candidate.selector === GEMINI_ONLY_SELECTOR) return candidate;

  return current;
}

function uniqueValueCandidates(
  candidates: ExtractionCandidate[],
): ExtractionCandidate[] {
  const unique: ExtractionCandidate[] = [];

  for (const candidate of candidates) {
    const existingIndex = unique.findIndex((existing) =>
      valuesEqual(existing.value, candidate.value),
    );
    if (existingIndex === -1) {
      unique.push(candidate);
      continue;
    }

    unique[existingIndex] = preferChoiceRepresentative(
      unique[existingIndex]!,
      candidate,
    );
  }

  return unique;
}

function choiceRequired(
  candidates: ExtractionCandidate[],
  allCandidates: ExtractionCandidate[],
): Extract<ExtractionChoiceDecision, { kind: "choice_required" }> {
  return {
    kind: "choice_required",
    source: "user",
    candidates: uniqueValueCandidates(candidates),
    allCandidates,
  };
}

function enrichCandidates(
  signalKey: FinancialSignalKey,
  candidates: ExtractionCandidate[],
  gemini?: GeminiChoiceValue,
): ExtractionCandidate[] {
  return candidates.map((candidate) => {
    const fingerprint =
      candidate.fingerprint ?? createCandidateFingerprint(signalKey, candidate);
    const geminiSupported =
      gemini !== undefined && valuesEqual(candidate.value, gemini.value);
    return {
      ...candidate,
      candidateId: candidate.candidateId ?? fingerprint,
      fingerprint,
      ...(geminiSupported ? { geminiSupported: true as const } : {}),
    };
  });
}

function findStoredCandidate(
  candidates: ExtractionCandidate[],
  storedProfile: SelectorProfile | undefined,
): ExtractionCandidate | undefined {
  if (!storedProfile) return undefined;

  if (storedProfile.fingerprint) {
    const fingerprintMatch = candidates.find(
      (candidate) => candidate.fingerprint === storedProfile.fingerprint,
    );
    if (fingerprintMatch) return fingerprintMatch;
    if (storedProfile.source === "auto") return undefined;
  }

  return candidates.find(
    (candidate) => candidate.selector === storedProfile.selector,
  );
}

function highScoringClosePair(candidates: ExtractionCandidate[]): boolean {
  const top = candidates[0];
  const second = candidates[1];
  if (!top || !second) return false;
  return (
    top.score >= HIGH_SCORE_THRESHOLD &&
    second.score >= HIGH_SCORE_THRESHOLD &&
    top.score - second.score <= CLOSE_SCORE_MARGIN
  );
}

function createGeminiOnlyCandidate(
  signalKey: FinancialSignalKey,
  gemini: GeminiChoiceValue,
): ExtractionCandidate {
  return {
    candidateId: `${GEMINI_ONLY_SELECTOR}:${signalKey}:${gemini.value}`,
    selector: GEMINI_ONLY_SELECTOR,
    text: `${gemini.value}`,
    value: gemini.value,
    score: 10,
    valueType: signalKey === "net_annual_return" ? "percent" : "currency",
    context: `Gemini extracted (${gemini.currency})`,
    geminiSupported: true,
    origin: "gemini",
  };
}

function hasSelectorAndHeuristicAgreement(
  candidates: ExtractionCandidate[],
  value: number,
): boolean {
  let selector = false;
  let heuristic = false;
  for (const candidate of candidates) {
    if (!valuesEqual(candidate.value, value)) continue;
    selector ||= candidate.origin === "selector";
    heuristic ||= candidate.origin === "heuristic";
  }
  return selector && heuristic;
}

function nextCompetingScore(
  candidates: ExtractionCandidate[],
  value: number,
): number | null {
  return candidates.find((candidate) => !valuesEqual(candidate.value, value))
    ?.score ?? null;
}

export function resolveExtractionChoice({
  signalKey,
  candidates,
  storedProfile,
  gemini,
  safeMode = false,
  forceChoice = false,
}: {
  signalKey: FinancialSignalKey;
  candidates: ExtractionCandidate[];
  storedProfile?: SelectorProfile | undefined;
  gemini?: GeminiChoiceValue | undefined;
  safeMode?: boolean;
  forceChoice?: boolean;
}): ExtractionChoiceDecision {
  const allCandidates = enrichCandidates(
    signalKey,
    candidates,
    forceChoice ? undefined : gemini,
  );

  if (forceChoice && isChoiceSignal(signalKey)) {
    const choices = allCandidates;
    if (choices.length === 0) {
      return { kind: "missing", source: "none", allCandidates };
    }
    return {
      kind: "choice_required",
      source: "user",
      candidates: choices,
      allCandidates,
    };
  }

  const storedCandidate = findStoredCandidate(allCandidates, storedProfile);
  if (storedCandidate) {
    return {
      kind: "selected",
      source: "stored",
      value: storedCandidate.value,
      confidence: 0.95,
      candidate: { ...storedCandidate, source: "stored" },
      allCandidates,
    };
  }

  if (gemini) {
    const matches = allCandidates.filter((candidate) =>
      valuesEqual(candidate.value, gemini.value),
    );

    if (matches.length === 1) {
      const match = matches[0]!;
      return {
        kind: "selected",
        source: "gemini_supported",
        value: match.value,
        confidence: 0.95,
        candidate: { ...match, geminiSupported: true, source: "gemini_supported" },
        allCandidates,
      };
    }

    if (matches.length > 1) {
      const [topMatch, secondMatch] = matches;
      if (topMatch && secondMatch && topMatch.score >= secondMatch.score) {
        return {
          kind: "selected",
          source: "gemini_supported",
          value: topMatch.value,
          confidence: 0.95,
          candidate: {
            ...topMatch,
            geminiSupported: true,
            source: "gemini_supported",
          },
          allCandidates,
        };
      }

      return choiceRequired(
        matches.map((candidate) => ({
          ...candidate,
          geminiSupported: true,
        })),
        allCandidates,
      );
    }

    if (allCandidates.length === 0) {
      return {
        kind: "gemini_only",
        source: "gemini_only",
        value: gemini.value,
        confidence: 0.95,
        currency: gemini.currency,
        allCandidates,
      };
    }
  }

  const top = allCandidates[0];
  if (top) {
    const agreementCount = countAgreementEvidence(allCandidates, top.value);
    const selectorSupported = hasSelectorAndHeuristicAgreement(
      allCandidates,
      top.value,
    );
    const confidence = computeConfidence({
      topScore: top.score,
      secondScore: nextCompetingScore(allCandidates, top.value),
      candidateCount: allCandidates.length,
      agreementCount,
    });
    if (
      top.score >= HIGH_SCORE_THRESHOLD &&
      confidence >= AUTO_SELECT_CONFIDENCE_THRESHOLD &&
      (selectorSupported || agreementCount >= 2) &&
      !safeMode
    ) {
      const source =
        selectorSupported || top.origin === "selector"
          ? "selector_supported"
          : "heuristic";
      const warnings =
        gemini && !valuesEqual(top.value, gemini.value)
          ? ["gemini_disagreement"]
          : undefined;
      return {
        kind: "selected",
        source,
        value: top.value,
        confidence,
        candidate: {
          ...top,
          source,
        },
        allCandidates,
        ...(warnings ? { warnings } : {}),
      };
    }
  }

  if (gemini && isChoiceSignal(signalKey)) {
    return choiceRequired(
      [
        createGeminiOnlyCandidate(signalKey, gemini),
        ...allCandidates.slice(0, 4),
      ],
      allCandidates,
    );
  }

  if (highScoringClosePair(allCandidates)) {
    return choiceRequired(allCandidates.slice(0, 5), allCandidates);
  }

  if (!top) return { kind: "missing", source: "none", allCandidates };

  if (isChoiceSignal(signalKey)) {
    return choiceRequired(allCandidates.slice(0, 5), allCandidates);
  }

  return {
    kind: "selected",
    source: "heuristic",
    value: top.value,
    confidence: computeConfidence({
      topScore: top.score,
      secondScore: nextCompetingScore(allCandidates, top.value),
      candidateCount: allCandidates.length,
      agreementCount: countAgreementEvidence(allCandidates, top.value),
    }),
    candidate: { ...top, source: "heuristic" },
    allCandidates,
  };
}
