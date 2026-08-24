import type {
  PlatformId,
  SyncEvent,
  DebugLogEntry,
  FinancialSignalKey,
  ExtractionCandidate,
  DebugSignalResult,
} from "../../shared/types/index.js";

// ─── Platform Logger ──────────────────────────────────────────────────────────

export interface PlatformLogger {
  (
    step: string,
    detail?: string,
    level?: DebugLogEntry["level"],
    elapsedMs?: number,
  ): void;
}

export function createPlatformLogger(
  platformId: PlatformId,
  runId: string,
  debugMode: boolean,
  onEvent: (event: SyncEvent) => void,
): PlatformLogger {
  return (step, detail, level = "info", elapsedMs) => {
    if (!debugMode) return;
    const entry: DebugLogEntry = {
      timestamp: new Date().toISOString(),
      step,
      ...(detail ? { detail } : {}),
      level,
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
    };
    onEvent({
      type: "platform_progress",
      platformId,
      runId,
      debugLogs: [entry],
    });
  };
}

// ─── Extraction log helpers ───────────────────────────────────────────────────

export interface ExtractSignalResult {
  value: number | null;
  confidence: number;
  candidate?: ExtractionCandidate;
  allCandidates: ExtractionCandidate[];
  elementsScanned: number;
  warnings?: string[];
}

export function buildExtractionLogDetail(result: ExtractSignalResult): {
  detail: string;
  level: DebugLogEntry["level"];
} {
  const base = `${result.allCandidates.length} candidates, ${result.elementsScanned} elements scanned`;

  if (!result.candidate) {
    return { detail: base, level: "warn" };
  }

  const tagContext = result.candidate.selector
    ? ` from <${result.candidate.selector.replace(/\./g, ' class="').replace(/#/g, '" id="')}${result.candidate.selector.includes(".") || result.candidate.selector.includes("#") ? '"' : ""}>`
    : "";

  return {
    detail: `${base}, confidence ${(result.confidence * 100).toFixed(0)}%, picked ${result.candidate.value}${tagContext}`,
    level: "info",
  };
}

export function buildDebugSignal(
  key: FinancialSignalKey,
  selectors: string[],
  result: ExtractSignalResult,
): DebugSignalResult {
  return {
    signalKey: key,
    selectors,
    candidates: result.allCandidates,
    picked: result.candidate ?? null,
    confidence: result.confidence,
    elementsScanned: result.elementsScanned,
  };
}
