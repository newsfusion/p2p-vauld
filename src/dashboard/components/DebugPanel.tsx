import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Bug,
  Clock,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import type {
  DebugLogEntry,
  DebugPlatformSnapshot,
  DebugSignalResult,
  AiExtractionLog,
  StoredOverviewMetrics,
  PlatformId,
  PlatformSyncState,
  ExtractorPageType,
} from "../../shared/types/index.js";
import { upsertMetricsSnapshot } from "../../shared/db/index.js";
import { getPlatformCatalog } from "../../shared/platforms/index.js";
import { useDashboardStore } from "../store.js";
import {
  confidenceBg,
  confidenceColor,
  logLevelColor,
  logLevelDot,
} from "../utils/debug-colors.js";

function AiLogSection({ aiLog }: { aiLog: AiExtractionLog }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  return (
    <div className="border border-primary/20 rounded-md p-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">AI Extraction</span>
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
            aiLog.available
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {aiLog.available
            ? "Available"
            : `Unavailable: ${aiLog.reason ?? "unknown"}`}
        </span>
        {aiLog.durationMs !== undefined && (
          <span className="rounded bg-accent/30 px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {aiLog.durationMs}ms
          </span>
        )}
      </div>

      {aiLog.snippetCount !== undefined && (
        <div className="text-xs text-muted-foreground">
          {aiLog.snippetCount} snippets found
          {aiLog.estimatedTokens !== undefined &&
            ` · ~${aiLog.estimatedTokens} tokens`}
        </div>
      )}

      {aiLog.promptText && (
        <div>
          <button
            type="button"
            onClick={() => setShowPrompt(!showPrompt)}
            className="text-xs text-primary hover:underline"
          >
            {showPrompt ? "Hide prompt" : "Show prompt"}
          </button>
          {showPrompt && (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-background/80 border border-border/40 p-2 text-[11px] font-mono whitespace-pre-wrap">
              {aiLog.promptText}
            </pre>
          )}
        </div>
      )}

      {aiLog.rawResponse && (
        <div>
          <button
            type="button"
            onClick={() => setShowResponse(!showResponse)}
            className="text-xs text-primary hover:underline"
          >
            {showResponse ? "Hide response" : "Show response"}
          </button>
          {showResponse && (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-background/80 border border-border/40 p-2 text-[11px] font-mono whitespace-pre-wrap">
              {aiLog.rawResponse}
            </pre>
          )}
        </div>
      )}

      {aiLog.parsedValue !== undefined && (
        <div className="text-xs text-success">
          Parsed: {aiLog.parsedValue} {aiLog.parsedCurrency ?? ""}
        </div>
      )}

      {aiLog.error && (
        <div className="text-xs text-destructive">Error: {aiLog.error}</div>
      )}
    </div>
  );
}

function SignalSection({ signal }: { signal: DebugSignalResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasWinner = signal.picked !== null;

  return (
    <div className="border border-border/40 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="font-mono text-xs font-medium">
          {signal.signalKey}
        </span>
        <span
          className={`ml-auto text-xs font-medium ${confidenceColor(signal.confidence)}`}
        >
          {hasWinner
            ? `${signal.picked!.value} (${(signal.confidence * 100).toFixed(0)}%)`
            : "No match"}
        </span>
        <span className="text-xs text-muted-foreground">
          {signal.candidates.length} candidates / {signal.elementsScanned}{" "}
          elements
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-3 py-2 space-y-3">
          {/* Selectors */}
          <div>
            <span className="text-xs font-medium text-muted-foreground">
              Selectors:{" "}
            </span>
            <span className="text-xs text-foreground">
              {signal.selectors.join(", ") || "(none — heuristic fallback)"}
            </span>
          </div>

          {/* Winner */}
          {signal.picked && (
            <div
              className={`rounded-md p-2 ${confidenceBg(signal.confidence)}`}
            >
              <div className="text-xs font-medium text-foreground mb-1">
                Winner
              </div>
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <span className="text-muted-foreground">Value:</span>
                <span className="font-mono">{signal.picked.value}</span>
                <span className="text-muted-foreground">Score:</span>
                <span className="font-mono">
                  {signal.picked.score.toFixed(2)}
                </span>
                <span className="text-muted-foreground">Selector:</span>
                <span className="font-mono truncate">
                  {signal.picked.selector}
                </span>
                <span className="text-muted-foreground">Text:</span>
                <span className="truncate">{signal.picked.text}</span>
                {signal.picked.context && (
                  <>
                    <span className="text-muted-foreground">Context:</span>
                    <span className="truncate">{signal.picked.context}</span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* All candidates table */}
          {signal.candidates.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/40 text-muted-foreground">
                    <th className="text-left py-1 pr-2">#</th>
                    <th className="text-left py-1 pr-2">Selector</th>
                    <th className="text-left py-1 pr-2">Text</th>
                    <th className="text-right py-1 pr-2">Value</th>
                    <th className="text-right py-1 pr-2">Score</th>
                    <th className="text-left py-1 pr-2">Type</th>
                    <th className="text-left py-1">Context</th>
                  </tr>
                </thead>
                <tbody>
                  {signal.candidates.map((c, i) => (
                    <tr
                      key={i}
                      className={[
                        "border-b border-border/20",
                        signal.picked &&
                        c.selector === signal.picked.selector &&
                        c.value === signal.picked.value
                          ? "bg-primary/5 font-medium"
                          : "",
                      ].join(" ")}
                    >
                      <td className="py-1 pr-2 text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="py-1 pr-2 font-mono truncate max-w-[120px]">
                        {c.selector}
                      </td>
                      <td className="py-1 pr-2 truncate max-w-[100px]">
                        {c.text}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {c.value}
                      </td>
                      <td className="py-1 pr-2 text-right font-mono">
                        {c.score.toFixed(2)}
                      </td>
                      <td className="py-1 pr-2">{c.valueType ?? "—"}</td>
                      <td className="py-1 truncate max-w-[200px]">
                        {c.context ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {signal.candidates.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No candidates found
            </p>
          )}

          {signal.aiLog && <AiLogSection aiLog={signal.aiLog} />}
        </div>
      )}
    </div>
  );
}

function LogTimeline({ logs }: { logs: DebugLogEntry[] }) {
  if (logs.length === 0) {
    return (
      <div className="rounded-lg border border-border/40 px-3 py-2 text-xs italic text-muted-foreground">
        No sync activity logged yet.
      </div>
    );
  }

  const orderedLogs = [...logs].sort((a, b) => {
    const aTime = Date.parse(a.timestamp);
    const bTime = Date.parse(b.timestamp);

    if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
    if (Number.isNaN(aTime)) return 1;
    if (Number.isNaN(bTime)) return -1;
    return bTime - aTime;
  });

  return (
    <div className="rounded-lg border border-border/40">
      <div className="border-b border-border/40 px-3 py-2">
        <h3 className="text-xs font-medium text-foreground">Activity Log</h3>
      </div>
      <div className="max-h-80 space-y-3 overflow-y-auto px-3 py-3">
        {orderedLogs.map((entry, index) => (
          <div
            key={`${entry.timestamp}-${entry.step}-${index}`}
            className="grid grid-cols-[auto_1fr] gap-3"
          >
            <div className="flex flex-col items-center">
              <span
                className={`mt-1 h-2.5 w-2.5 rounded-full ${logLevelDot(entry.level)}`}
              />
              {index < orderedLogs.length - 1 && (
                <span className="mt-1 h-full w-px bg-border/60" />
              )}
            </div>
            <div className="pb-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[11px] font-mono text-muted-foreground">
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </span>
                {entry.elapsedMs !== undefined && (
                  <span className="text-[10px] text-muted-foreground">
                    +{(entry.elapsedMs / 1000).toFixed(1)}s
                  </span>
                )}
                <span
                  className={`text-xs font-medium ${logLevelColor(entry.level)}`}
                >
                  {entry.step}
                </span>
                {entry.detail?.includes("Content script not reachable") && (
                  <span className="rounded bg-warning/20 px-1 py-0.5 text-[10px] font-medium text-warning">
                    CONNECTION
                  </span>
                )}
                {entry.detail?.includes("timeout") && (
                  <span className="rounded bg-destructive/20 px-1 py-0.5 text-[10px] font-medium text-destructive">
                    TIMEOUT
                  </span>
                )}
              </div>
              {entry.detail && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.detail}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HtmlViewer({
  rawHtml,
  label,
  pageType,
  platformId,
  platformName,
}: {
  rawHtml: string | undefined;
  label: string;
  pageType: ExtractorPageType;
  platformId: PlatformId;
  platformName: string;
}) {
  const [mode, setMode] = useState<"raw" | "rendered">("rendered");
  const setExtractorTransfer = useDashboardStore((s) => s.setExtractorTransfer);
  const setView = useDashboardStore((s) => s.setView);

  if (!rawHtml) {
    return null;
  }

  return (
    <div
      data-testid={`html-viewer-${pageType}`}
      className="rounded-lg border border-border/40 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-3 py-2">
        <div>
          <h3 className="text-xs font-medium text-foreground">{label}</h3>
          <p className="text-[11px] text-muted-foreground">
            {rawHtml.length.toLocaleString()} chars captured
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid={`send-to-extractor-${pageType}`}
            onClick={() => {
              setExtractorTransfer({
                platformId,
                platformName,
                pageType,
                html: rawHtml,
                timestamp: new Date().toISOString(),
              });
              setView(pageType === "login" ? "login-extractor" : "dashboard-extractor");
            }}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary transition hover:bg-primary/20"
          >
            Send to Extractor
          </button>
          <div className="flex rounded-md border border-border/40 bg-background/80 p-0.5">
          <button
            type="button"
            onClick={() => setMode("rendered")}
            className={[
              "rounded px-2 py-1 text-xs transition-colors",
              mode === "rendered"
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
            ].join(" ")}
          >
            Rendered
          </button>
          <button
            type="button"
            onClick={() => setMode("raw")}
            className={[
              "rounded px-2 py-1 text-xs transition-colors",
              mode === "raw"
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
            ].join(" ")}
          >
            Raw HTML
          </button>
          </div>
        </div>
      </div>

      <div className="bg-background/60 p-3">
        {mode === "raw" ? (
          <textarea
            readOnly
            value={rawHtml}
            className="min-h-80 w-full resize-y rounded-md border border-border/40 bg-background px-3 py-2 font-mono text-[11px] text-foreground outline-none"
          />
        ) : (
          <iframe
            title="Captured platform HTML"
            sandbox=""
            srcDoc={rawHtml}
            className="h-96 w-full rounded-md border border-border/40 bg-white"
          />
        )}
      </div>
    </div>
  );
}

function PlatformSection({ snapshot }: { snapshot: DebugPlatformSnapshot }) {
  const [expanded, setExpanded] = useState(true);
  const hasSignals = snapshot.signals.length > 0;
  const isFailed = Boolean(snapshot.error);
  const isCancelled = Boolean(snapshot.cancelled);
  const isRunning = !snapshot.loginSuccess && !isFailed && !isCancelled;

  const worstConfidence = hasSignals
    ? Math.min(...snapshot.signals.map((s) => (s.picked ? s.confidence : 0)))
    : null;

  const statusClass = isFailed
    ? "bg-destructive/10 text-destructive"
    : isCancelled
      ? "bg-muted text-muted-foreground"
      : snapshot.loginSuccess
        ? "bg-success/10 text-success"
        : "bg-warning/10 text-warning";
  const statusLabel = isFailed
    ? "Failed"
    : isCancelled
      ? "Cancelled"
      : snapshot.loginSuccess
        ? "Completed"
        : "Running";

  return (
    <div className="glass-card overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/20 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <span className="font-medium text-sm">{snapshot.platformName}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${statusClass}`}>
          {statusLabel}
        </span>
        {worstConfidence !== null ? (
          <span
            className={`ml-auto text-xs font-medium ${confidenceColor(worstConfidence)}`}
          >
            min conf: {(worstConfidence * 100).toFixed(0)}%
          </span>
        ) : (
          <span
            className={`ml-auto text-xs ${isRunning ? "text-warning" : "text-muted-foreground"}`}
          >
            {snapshot.logs.length} log{snapshot.logs.length !== 1 ? "s" : ""}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {new Date(snapshot.timestamp).toLocaleTimeString()}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-border/40 px-4 py-3 space-y-3">
          {snapshot.error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded px-2 py-1">
              {snapshot.error}
            </div>
          )}
          <LogTimeline logs={snapshot.logs} />
          {snapshot.signals.map((signal) => (
            <SignalSection key={signal.signalKey} signal={signal} />
          ))}
          {!hasSignals && (
            <p className="text-xs italic text-muted-foreground">
              No signal data yet.
            </p>
          )}
          <HtmlViewer
            rawHtml={snapshot.rawLoginHtml}
            label="Login Page HTML"
            pageType="login"
            platformId={snapshot.platformId}
            platformName={snapshot.platformName}
          />
          <HtmlViewer
            rawHtml={snapshot.rawHtml}
            label="Dashboard HTML"
            pageType="dashboard"
            platformId={snapshot.platformId}
            platformName={snapshot.platformName}
          />
        </div>
      )}
    </div>
  );
}

interface MetricDraft {
  platformValue: number;
  freeCash: number;
  netAnnualReturnPct: number;
}

interface MetricsOverrideProps {
  metrics: StoredOverviewMetrics[];
  configuredPlatformIds: PlatformId[];
  onSaved: () => void;
}

function createDrafts(
  metrics: StoredOverviewMetrics[],
  configuredPlatformIds: PlatformId[],
): Partial<Record<PlatformId, MetricDraft>> {
  const metricByPlatformId = new Map(
    metrics.map((metric) => [metric.platformId, metric]),
  );
  const drafts: Partial<Record<PlatformId, MetricDraft>> = {};

  for (const platformId of configuredPlatformIds) {
    const metric = metricByPlatformId.get(platformId);
    drafts[platformId] = {
      platformValue: metric?.platformValue ?? 0,
      freeCash: metric?.freeCash ?? 0,
      netAnnualReturnPct: metric?.netAnnualReturnPct ?? 0,
    };
  }

  return drafts;
}

function MetricsOverride({
  metrics,
  configuredPlatformIds,
  onSaved,
}: MetricsOverrideProps) {
  const platformNames = useMemo(
    () =>
      new Map(
        getPlatformCatalog().map((platform) => [platform.id, platform.name]),
      ),
    [],
  );
  const [drafts, setDrafts] = useState<
    Partial<Record<PlatformId, MetricDraft>>
  >(() => createDrafts(metrics, configuredPlatformIds));
  const [savingByPlatform, setSavingByPlatform] = useState<
    Partial<Record<PlatformId, boolean>>
  >({});
  const [savedByPlatform, setSavedByPlatform] = useState<
    Partial<Record<PlatformId, boolean>>
  >({});
  const [errorByPlatform, setErrorByPlatform] = useState<
    Partial<Record<PlatformId, string | null>>
  >({});

  function updateField(
    platformId: PlatformId,
    field: keyof MetricDraft,
    value: string,
  ) {
    const parsed = Number.parseFloat(value);
    const nextValue = Number.isFinite(parsed) ? parsed : 0;

    setDrafts((previous) => ({
      ...previous,
      [platformId]: {
        ...(previous[platformId] ?? {
          platformValue: 0,
          freeCash: 0,
          netAnnualReturnPct: 0,
        }),
        [field]: nextValue,
      },
    }));
  }

  async function handleSave(platformId: PlatformId) {
    const draft = drafts[platformId] ?? {
      platformValue: 0,
      freeCash: 0,
      netAnnualReturnPct: 0,
    };

    setSavingByPlatform((previous) => ({ ...previous, [platformId]: true }));
    setErrorByPlatform((previous) => ({ ...previous, [platformId]: null }));

    try {
      const fetchedAt = new Date().toISOString();
      await upsertMetricsSnapshot({
        platformId,
        date: fetchedAt.slice(0, 10),
        fetchedAt,
        platformValue: draft.platformValue,
        freeCash: draft.freeCash,
        netAnnualReturnPct: draft.netAnnualReturnPct,
        currency: "EUR",
        confidence: 1,
      });
      onSaved();
      setSavedByPlatform((previous) => ({ ...previous, [platformId]: true }));
      window.setTimeout(() => {
        setSavedByPlatform((previous) => ({
          ...previous,
          [platformId]: false,
        }));
      }, 1200);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save override.";
      setErrorByPlatform((previous) => ({
        ...previous,
        [platformId]: message,
      }));
    } finally {
      setSavingByPlatform((previous) => ({ ...previous, [platformId]: false }));
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border/50">
            <th className="px-4 py-1.5 text-left font-medium text-muted-foreground">
              Platform
            </th>
            <th className="px-4 py-1.5 text-right font-medium text-muted-foreground">
              Portfolio Value (EUR)
            </th>
            <th className="px-4 py-1.5 text-right font-medium text-muted-foreground">
              Free Cash (EUR)
            </th>
            <th className="px-4 py-1.5 text-right font-medium text-muted-foreground">
              Net Return (%)
            </th>
            <th className="px-4 py-1.5 text-right font-medium text-muted-foreground">
              Action
            </th>
          </tr>
        </thead>
        <tbody>
          {configuredPlatformIds.map((platformId) => {
            const draft = drafts[platformId] ?? {
              platformValue: 0,
              freeCash: 0,
              netAnnualReturnPct: 0,
            };
            const isSaving = savingByPlatform[platformId] ?? false;
            const isSaved = savedByPlatform[platformId] ?? false;
            const error = errorByPlatform[platformId];

            return (
              <tr
                key={platformId}
                className="border-b border-border/30 last:border-b-0"
              >
                <td className="px-4 py-1.5 text-foreground">
                  {platformNames.get(platformId) ?? platformId}
                </td>
                <td className="px-4 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.01"
                    value={draft.platformValue}
                    onChange={(event) =>
                      updateField(
                        platformId,
                        "platformValue",
                        event.target.value,
                      )
                    }
                    className="ml-auto block w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-xs text-foreground outline-none focus:border-primary"
                  />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.01"
                    value={draft.freeCash}
                    onChange={(event) =>
                      updateField(platformId, "freeCash", event.target.value)
                    }
                    className="ml-auto block w-28 rounded-md border border-border bg-background px-2 py-1 text-right text-xs text-foreground outline-none focus:border-primary"
                  />
                </td>
                <td className="px-4 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.01"
                    value={draft.netAnnualReturnPct}
                    onChange={(event) =>
                      updateField(
                        platformId,
                        "netAnnualReturnPct",
                        event.target.value,
                      )
                    }
                    className="ml-auto block w-24 rounded-md border border-border bg-background px-2 py-1 text-right text-xs text-foreground outline-none focus:border-primary"
                  />
                </td>
                <td className="px-4 py-1.5">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSave(platformId)}
                      disabled={isSaving}
                      className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Save className="h-3 w-3" />
                      {isSaving ? "Saving…" : "Save"}
                    </button>
                    {isSaved && <span className="text-success">Saved!</span>}
                    {!isSaved && error && (
                      <span className="text-destructive">{error}</span>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface DebugPanelProps {
  snapshots: DebugPlatformSnapshot[];
  onSyncAll: () => void;
  onSyncPlatform: (platformId: PlatformId) => void;
  isSyncing: boolean;
  syncStates: Partial<Record<PlatformId, PlatformSyncState>>;
  queuedPlatformIds?: PlatformId[];
  hasConfiguredPlatforms: boolean;
  metrics: StoredOverviewMetrics[];
  configuredPlatformIds: PlatformId[];
  onMetricsUpdated: () => void;
  onCleanupStaleSyncs: () => Promise<void>;
}

export function DebugPanel({
  snapshots,
  onSyncAll,
  onSyncPlatform,
  isSyncing,
  syncStates,
  queuedPlatformIds = [],
  hasConfiguredPlatforms,
  metrics,
  configuredPlatformIds,
  onMetricsUpdated,
  onCleanupStaleSyncs,
}: DebugPanelProps) {
  const hasSnapshots = snapshots.length > 0;
  const [isOverrideExpanded, setIsOverrideExpanded] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const platformNameById = useMemo(
    () =>
      new Map(
        getPlatformCatalog().map((platform) => [platform.id, platform.name]),
      ),
    [],
  );
  const orderedConfiguredPlatformIds = useMemo(
    () =>
      [...configuredPlatformIds].sort((left, right) =>
        (platformNameById.get(left) ?? left).localeCompare(
          platformNameById.get(right) ?? right,
        ),
      ),
    [configuredPlatformIds, platformNameById],
  );
  const queuedSet = new Set(queuedPlatformIds);
  const busyConfiguredPlatformIds = new Set<PlatformId>(queuedPlatformIds);
  for (const [platformId, state] of Object.entries(syncStates)) {
    if (state === "pending" || state === "running") {
      busyConfiguredPlatformIds.add(platformId as PlatformId);
    }
  }
  const hasAvailableSyncTarget = orderedConfiguredPlatformIds.some(
    (platformId) => !busyConfiguredPlatformIds.has(platformId),
  );

  async function handleCleanupClick() {
    if (isCleaning) return;

    setIsCleaning(true);
    try {
      await onCleanupStaleSyncs();
    } finally {
      setIsCleaning(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Bug className="h-5 w-5 text-primary" />
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
              Extraction Debug
            </h1>
          </div>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">
            Inspect sync activity, extraction candidates, confidence scores, and captured HTML.
          </p>
        </div>
        {hasSnapshots && (
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-muted-foreground">
            {snapshots.length} platform{snapshots.length !== 1 ? "s" : ""}
          </span>
        )}
        <button
          type="button"
          onClick={onSyncAll}
          disabled={!hasConfiguredPlatforms || (isSyncing && !hasAvailableSyncTarget)}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
          {isSyncing ? "Syncing…" : "Sync All"}
        </button>
        <button
          type="button"
          onClick={() => void handleCleanupClick()}
          disabled={isCleaning}
          title="Mark orphaned sync runs as failed"
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-foreground shadow-sm transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className={`h-4 w-4 ${isCleaning ? "animate-spin" : ""}`} />
          {isCleaning ? "Cleaning…" : "Cleanup Stale Syncs"}
        </button>
        {!isSyncing && !hasConfiguredPlatforms && (
          <span className="text-xs text-muted-foreground">
            Add credentials in Settings to enable sync.
          </span>
        )}
      </div>

      {orderedConfiguredPlatformIds.length > 0 && (
        <div className="glass-card px-6 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              Platform Sync
            </span>
            <span className="text-xs text-muted-foreground">
              Trigger individual sync runs
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {orderedConfiguredPlatformIds.map((platformId) => {
              const state = syncStates[platformId];
              const queueIndex = queuedPlatformIds.indexOf(platformId);
              const isPlatformQueued = queuedSet.has(platformId);
              const isPlatformSyncing =
                isSyncing && (state === "pending" || state === "running");
              const isPlatformBusy = isPlatformSyncing || isPlatformQueued;

              return (
                <button
                  key={platformId}
                  type="button"
                  data-testid={`debug-sync-${platformId}`}
                  onClick={() => onSyncPlatform(platformId)}
                  disabled={isPlatformBusy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isPlatformSyncing ? "animate-spin" : ""}`}
                  />
                  <span>{platformNameById.get(platformId) ?? platformId}</span>
                  {isPlatformQueued && (
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      In Queue #{queueIndex + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {orderedConfiguredPlatformIds.length > 0 && (
        <div className="glass-card overflow-hidden">
          <button
            type="button"
            onClick={() => setIsOverrideExpanded((previous) => !previous)}
            className="flex w-full items-center gap-2 border-b border-border px-6 py-4 text-left transition-colors hover:bg-muted"
          >
            {isOverrideExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
            <span className="text-sm font-medium text-foreground">
              Manual Value Override
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {orderedConfiguredPlatformIds.length} platform
              {orderedConfiguredPlatformIds.length !== 1 ? "s" : ""}
            </span>
          </button>
          {isOverrideExpanded && (
            <div className="px-0 py-2">
              <MetricsOverride
                key={`${configuredPlatformIds.join("|")}::${metrics
                  .map((metric) => `${metric.platformId}:${metric.fetchedAt}`)
                  .join("|")}`}
                metrics={metrics}
                configuredPlatformIds={configuredPlatformIds}
                onSaved={onMetricsUpdated}
              />
            </div>
          )}
        </div>
      )}

      {!hasSnapshots ? (
        <div className="glass-card py-16 text-center">
          <Bug className="mx-auto mb-4 h-12 w-12 rounded-full bg-accent p-3 text-muted-foreground" />
          <h2 className="mb-2 text-lg font-semibold text-foreground">
            Debug Mode
          </h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Run a sync to see the live activity log, extracted candidates, and
            captured HTML for each platform.
          </p>
        </div>
      ) : (
        snapshots.map((snapshot) => (
          <PlatformSection
            key={`${snapshot.platformId}-${snapshot.timestamp}`}
            snapshot={snapshot}
          />
        ))
      )}
    </div>
  );
}
