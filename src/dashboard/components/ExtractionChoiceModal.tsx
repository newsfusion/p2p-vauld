import { CheckCircle2, Sparkles, X } from "lucide-react";
import type {
  ExtractionCandidate,
  ExtractionChoiceRequest,
} from "../../shared/types/index.js";
import {
  computeConfidence,
  countAgreementEvidence,
} from "../../shared/scoring.js";
import { ModalShell } from "./ui/index.js";

interface ExtractionChoiceModalProps {
  request: ExtractionChoiceRequest;
  onChoose: (candidateId: string) => void;
  onCancel: () => void;
}

function titleForSignal(signalKey: ExtractionChoiceRequest["signalKey"]): string {
  return signalKey === "portfolio_value"
    ? "Select Portfolio Value"
    : "Select Free Cash";
}

function formatValue(candidate: ExtractionCandidate): string {
  const currency = candidate.valueType === "currency" ? "EUR" : undefined;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...(currency ? { style: "currency", currency } : {}),
  }).format(candidate.value);
}

function valuesEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.005;
}

function uniqueValueCandidates(
  candidates: ExtractionCandidate[],
): ExtractionCandidate[] {
  const unique: ExtractionCandidate[] = [];

  for (const candidate of candidates) {
    const existing = unique.find((other) => valuesEqual(other.value, candidate.value));
    if (!existing) unique.push(candidate);
  }

  return unique;
}

function competingScore(
  candidates: ExtractionCandidate[],
  candidate: ExtractionCandidate,
): number | null {
  const competitor = candidates
    .filter((other) => !valuesEqual(other.value, candidate.value))
    .sort((left, right) => right.score - left.score)[0];
  return competitor?.score ?? null;
}

function confidenceForCandidate(
  candidates: ExtractionCandidate[],
  candidate: ExtractionCandidate,
): number {
  return computeConfidence({
    topScore: candidate.score,
    secondScore: competingScore(candidates, candidate),
    candidateCount: candidates.length,
    agreementCount: countAgreementEvidence(candidates, candidate.value),
  });
}

function sortedCandidates(candidates: ExtractionCandidate[]): Array<{
  candidate: ExtractionCandidate;
  confidence: number;
  originalIndex: number;
}> {
  const uniqueCandidates = uniqueValueCandidates(candidates);

  return uniqueCandidates
    .map((candidate, originalIndex) => ({
      candidate,
      confidence: confidenceForCandidate(uniqueCandidates, candidate),
      originalIndex,
    }))
    .sort((left, right) => {
      const confidenceDelta = right.confidence - left.confidence;
      if (confidenceDelta !== 0) return confidenceDelta;

      const scoreDelta = right.candidate.score - left.candidate.score;
      if (scoreDelta !== 0) return scoreDelta;

      if (left.candidate.geminiSupported !== right.candidate.geminiSupported) {
        return left.candidate.geminiSupported ? -1 : 1;
      }

      return left.originalIndex - right.originalIndex;
    });
}

export function ExtractionChoiceModal({
  request,
  onChoose,
  onCancel,
}: ExtractionChoiceModalProps) {
  const candidates = sortedCandidates(request.candidates);
  const titleId = "extraction-choice-modal-title";

  return (
    <ModalShell
      titleId={titleId}
      panelClassName="flex max-h-full w-full max-w-xl flex-col rounded-lg border border-border bg-card p-5 shadow-xl"
    >
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              {request.platformName}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold text-foreground">
              {titleForSignal(request.signalKey)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="Cancel sync"
          >
            <X className="h-5 w-5" />
          </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
          {candidates.map(({ candidate, confidence }) => {
            const candidateId =
              candidate.candidateId ?? candidate.fingerprint ?? candidate.selector;
            const fullContext = [candidate.context || candidate.text, candidate.selector]
              .filter(Boolean)
              .join("\n");
            const confidencePct = (confidence * 100).toFixed(0);
            return (
              <div
                key={candidateId}
                title={fullContext}
                className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-2"
              >
                <p className="font-mono-nums min-w-0 flex-1 truncate text-lg font-semibold text-foreground">
                  {formatValue(candidate)}
                </p>
                {candidate.geminiSupported && (
                  <span
                    className="inline-flex shrink-0 items-center rounded-md bg-primary/10 p-1 text-primary"
                    title="Matches Gemini"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                  {confidencePct}%
                </span>
                <button
                  type="button"
                  onClick={() => onChoose(candidateId)}
                  className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:opacity-90"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Use this value
                </button>
              </div>
            );
          })}
      </div>

      <div className="mt-4 flex shrink-0 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            Cancel Sync
          </button>
      </div>
    </ModalShell>
  );
}
