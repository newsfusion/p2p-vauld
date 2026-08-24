import type { DebugLogEntry } from "../../shared/types/index.js";
import { PRODUCTION_CONFIDENCE_THRESHOLD } from "../../shared/scoring.js";

export function confidenceColor(confidence: number): string {
  if (confidence >= PRODUCTION_CONFIDENCE_THRESHOLD) return "text-success";
  if (confidence >= 0.4) return "text-warning";
  return "text-destructive";
}

export function confidenceBg(confidence: number): string {
  if (confidence >= PRODUCTION_CONFIDENCE_THRESHOLD) return "bg-success/10";
  if (confidence >= 0.4) return "bg-warning/10";
  return "bg-destructive/10";
}

export function logLevelColor(level: DebugLogEntry["level"]): string {
  if (level === "error") return "text-destructive";
  if (level === "warn") return "text-warning";
  return "text-success";
}

export function logLevelDot(level: DebugLogEntry["level"]): string {
  if (level === "error") return "bg-destructive";
  if (level === "warn") return "bg-warning";
  return "bg-success";
}
