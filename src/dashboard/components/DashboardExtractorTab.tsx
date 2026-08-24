import { useState } from "react";
import {
  FlaskConical,
  Play,
  RotateCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Bot,
} from "lucide-react";
import type {
  ExtractorTransfer,
  PlatformId,
  FinancialSignalKey,
  GeminiStatus,
} from "../../shared/types/index.js";
import { getPlatformCatalog } from "../../shared/platforms/index.js";
import { getErrorMessage } from "../../shared/error-utils.js";
import { cleanHtml } from "../../content/html-cleanup.js";
import {
  collectFinancialCandidates,
  pickBestCandidate,
} from "../../content/extractor.js";
import { PRODUCTION_CONFIDENCE_THRESHOLD } from "../../shared/scoring.js";
import {
  getVisibleTextTree,
  textTreeToString,
  countTextNodes,
} from "../../content/text-tree.js";
import {
  AI_AVAILABILITY_TIMEOUT_MS,
  AI_NSHOT_EXAMPLES,
  AI_PROMPT_TIMEOUT_MS,
  AI_RESPONSE_SCHEMA,
  AI_SESSION_TIMEOUT_MS,
  AI_SIGNAL_KEYWORDS,
  AI_SYSTEM_PROMPT,
} from "../../shared/ai/constants.js";
import { checkAiAvailability, createAiSession } from "../../content/ai-shared.js";
import {
  buildStrictExtractionPrompt,
  buildStrictResponseSchema,
  isStrictExtractionSignalKey,
  parseStrictExtractionResponse,
  prepareTreeForAI,
} from "../../shared/ai/extraction.js";
import { dashboards } from "../../../tests/fixtures/platform-html-bundle.js";
import { useDashboardStore } from "../store.js";
import { createStepTimer } from "../utils/extractor-helpers.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StepLog {
  step: string;
  detail?: string | undefined;
  elapsedMs: number;
  level: "info" | "warn" | "error" | "success";
}

interface SignalResult {
  signalKey: FinancialSignalKey;
  value: number | null;
  confidence: number;
  candidateCount: number;
  topCandidateText?: string | undefined;
  topCandidateSelector?: string | undefined;
  aiValue?: number | null;
  aiCurrency?: string;
  aiError?: string;
}

interface TestResult {
  timestamp: string;
  durationMs: number;
  platformId: PlatformId;
  logs: StepLog[];
  error?: string | undefined;
  signals?: SignalResult[];
  textTree?: string;
  aiPrompts?: Record<string, string>;
  aiResponses?: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function parseLegacyAiResponse(rawResponse: string): {
  value: number;
  currency: string;
} | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { error: "invalid_json" };
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("value" in parsed) ||
    typeof (parsed as Record<string, unknown>).value !== "number"
  ) {
    return { error: "missing_value_field" };
  }

  const value = (parsed as { value: number }).value;
  if (!Number.isFinite(value)) {
    return { error: "invalid_value" };
  }

  return {
    value,
    currency:
      typeof (parsed as { currency?: string }).currency === "string"
        ? (parsed as { currency?: string }).currency!
        : "EUR",
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DashboardExtractorTab() {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Record<string, Record<string, string>>
  >({});
  const dashboardTransfer = useDashboardStore(
    (s) =>
      (s.extractorTransfer?.pageType === "dashboard"
        ? s.extractorTransfer
        : null) ??
      s.extractorTransfers.dashboard ??
      null,
  );
  const clearExtractorTransfer = useDashboardStore((s) => s.clearExtractorTransfer);

  const actionButtonBaseClass =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
  const actionButtonGhostClass = `${actionButtonBaseClass} border-border bg-card text-muted-foreground hover:bg-accent hover:text-primary`;
  const actionButtonPrimaryClass = `${actionButtonBaseClass} border-primary bg-primary text-primary-foreground shadow-sm hover:opacity-90`;

  const platforms = getPlatformCatalog().filter((p) => p.enabled);
  const transferredConfig = dashboardTransfer
    ? platforms.find((platform) => platform.id === dashboardTransfer.platformId)
    : undefined;
  const transferRunKey = dashboardTransfer
    ? `transfer:dashboard:${dashboardTransfer.platformId}`
    : "";

  function getOverride(
    platformId: string,
    key: string,
    defaultValue: string[],
  ): string[] {
    const val = overrides[platformId]?.[key];
    if (val !== undefined) {
      return val
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return defaultValue;
  }

  function handleOverrideChange(
    platformId: string,
    key: string,
    value: string,
  ) {
    setOverrides((prev) => ({
      ...prev,
      [platformId]: {
        ...(prev[platformId] || {}),
        [key]: value,
      },
    }));
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function openHtmlContent(html: string) {
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  function fixtureHtml(module: string | { default?: string; html?: string }): string {
    if (typeof module === "string") return module;
    return module.html ?? module.default ?? "";
  }

  async function loadDashboardHtml(platformId: PlatformId): Promise<string> {
    const htmlImportP = dashboards[platformId as keyof typeof dashboards];
    if (!htmlImportP) {
      throw new Error(`No dashboard fixture found for ${platformId}`);
    }
    const htmlModule = await htmlImportP;
    return fixtureHtml(htmlModule);
  }

  async function openHtmlFixture(platformId: PlatformId) {
    setFixtureError(null);
    try {
      const html = await loadDashboardHtml(platformId);
      openHtmlContent(html);
    } catch (err) {
      setFixtureError(
        `Failed to open HTML: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function runDashboardTest(
    platformId: PlatformId,
    options?: {
      html?: string;
      runKey?: string;
    },
  ) {
    const runKey = options?.runKey ?? platformId;
    setRunning((prev) => ({ ...prev, [runKey]: true }));

    const timer = createStepTimer();
    const logs: StepLog[] = [];
    const addLog = (
      step: string,
      detail?: string,
      level: StepLog["level"] = "info",
    ) => {
      logs.push({ step, detail, elapsedMs: timer.lap(), level });
    };

    const result: TestResult = {
      timestamp: new Date().toISOString(),
      durationMs: 0,
      platformId,
      logs,
    };

    try {
      const config = getPlatformCatalog().find((p) => p.id === platformId)!;
      addLog("Starting", `Dashboard extractor test for ${config.name}`);

      // 1. Load HTML source
      const html =
        options?.html !== undefined
          ? options.html
          : await loadDashboardHtml(platformId);
      addLog(
        options?.html !== undefined
          ? "Using transferred HTML"
          : "Loaded HTML fixture",
        `${(html.length / 1024).toFixed(1)} KB`,
      );

      // 2. Parse into off-screen iframe
      const iframe = document.createElement("iframe");
      iframe.style.position = "absolute";
      iframe.style.left = "-9999px";
      iframe.style.width = "1px";
      iframe.style.height = "1px";
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      if (!doc) throw new Error("Could not create iframe document");

      doc.open();
      doc.write(html);
      doc.close();
      const elementCount = doc.querySelectorAll("*").length;
      addLog("Parsed HTML into DOM", `${elementCount} elements`);

      // 3. HTML cleanup
      const { root: cleanedRoot, stats: cleanupStats } = cleanHtml(doc);
      addLog(
        "HTML cleanup",
        `${cleanupStats.rawLength} -> ${cleanupStats.cleanedLength} chars (${cleanupStats.reductionPct}% reduction, ${cleanupStats.elementsRemoved} elements removed)`,
      );

      // 4. Generate text tree (skipVisibilityCheck since iframe is hidden)
      const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
      // Same serializer as the live path, so the panel predicts live behaviour:
      // pruning to the shared budget happens here, not in a separate helper.
      const {
        json: textTreeStr,
        truncated: aiPromptWasTruncated,
        textNodeCount: nodeCount,
      } = textTreeToString(tree);
      const aiPromptTextTree = prepareTreeForAI(textTreeStr);
      addLog(
        "Text tree generated",
        `${nodeCount} text nodes, ${textTreeStr.length} chars (${aiPromptTextTree.length} chars prepared)`,
      );
      if (aiPromptWasTruncated) {
        addLog(
          "Text tree pruned to prompt budget",
          `${countTextNodes(tree)} -> ${nodeCount} text nodes`,
          "warn",
        );
      }
      result.textTree = textTreeStr;

      // 5. Extract signals — AI first, CSS fallback
      const signalKeys: FinancialSignalKey[] = [
        "portfolio_value",
        "free_cash",
        "net_annual_return",
      ];
      const selectorMap: Record<FinancialSignalKey, string[]> = {
        portfolio_value: getOverride(
          platformId,
          "portfolioValueSelectors",
          config.dashboard.portfolioValueSelectors,
        ),
        free_cash: getOverride(
          platformId,
          "freeCashSelectors",
          config.dashboard.freeCashSelectors,
        ),
        net_annual_return: getOverride(
          platformId,
          "netAnnualReturnSelectors",
          config.dashboard.netAnnualReturnSelectors,
        ),
      };

      const signals: SignalResult[] = [];
      const aiPrompts: Record<string, string> = {};
      const aiResponses: Record<string, string> = {};
      let aiStatus: GeminiStatus = "unavailable";
      let aiAvailabilityError: string | undefined;

      try {
        const availability = await withTimeout(
          checkAiAvailability(),
          AI_AVAILABILITY_TIMEOUT_MS,
          `AI availability check timed out after ${AI_AVAILABILITY_TIMEOUT_MS}ms`,
        );
        aiStatus = availability.status;
      } catch (err) {
        aiAvailabilityError =
          getErrorMessage(err);
      }

      for (const signalKey of signalKeys) {
        const signal: SignalResult = {
          signalKey,
          value: null,
          confidence: 0,
          candidateCount: 0,
        };

        // Step A: AI extraction first (primary)
        const keywords = AI_SIGNAL_KEYWORDS[signalKey];
        const prompt = isStrictExtractionSignalKey(signalKey)
          ? buildStrictExtractionPrompt({
              signalKey,
              preparedTree: aiPromptTextTree,
              keywords,
            })
          : `Text tree: ${aiPromptTextTree}\n\nExtract: ${signalKey}\nKeywords: ${keywords.join(", ")}`;
        aiPrompts[signalKey] = prompt;

        try {
          if (!aiPromptTextTree || aiPromptTextTree === "null" || aiPromptTextTree === "[]") {
            signal.aiError = "empty_text_tree";
            addLog(`AI: ${signalKey}`, "Empty text tree provided, skipping AI", "warn");
          } else if (aiStatus === "available") {
            addLog(`AI: ${signalKey}`, "Querying Gemini Nano...");
            const session = await withTimeout(
              createAiSession(AI_SYSTEM_PROMPT, AI_NSHOT_EXAMPLES),
              AI_SESSION_TIMEOUT_MS,
              `AI session setup timed out after ${AI_SESSION_TIMEOUT_MS}ms`,
            );
            let rawResponse: string;
            const responseSchema = isStrictExtractionSignalKey(signalKey)
              ? buildStrictResponseSchema(signalKey)
              : AI_RESPONSE_SCHEMA;
            try {
              try {
                rawResponse = await withTimeout(
                  session.prompt(prompt, {
                    responseConstraint: responseSchema,
                  }),
                  AI_PROMPT_TIMEOUT_MS,
                  `AI response timed out after ${AI_PROMPT_TIMEOUT_MS}ms`,
                );
              } catch (constraintErr) {
                if (
                  constraintErr instanceof Error &&
                  constraintErr.message.includes("timed out")
                ) {
                  throw constraintErr;
                }
                rawResponse = await withTimeout(
                  session.prompt(prompt),
                  AI_PROMPT_TIMEOUT_MS,
                  `AI response timed out after ${AI_PROMPT_TIMEOUT_MS}ms`,
                );
              }
            } finally {
              session.destroy();
            }
            aiResponses[signalKey] = rawResponse;

            const parsed = isStrictExtractionSignalKey(signalKey)
              ? parseStrictExtractionResponse(rawResponse, signalKey)
              : parseLegacyAiResponse(rawResponse);

            if ("error" in parsed) {
              signal.aiError = parsed.error;
              addLog(
                `AI: ${signalKey}`,
                `Parse failed (${parsed.error}): ${rawResponse.slice(0, 180)}`,
                "warn",
              );
            } else {
              signal.aiValue = parsed.value;
              signal.aiCurrency = parsed.currency;
              addLog(
                `AI: ${signalKey}`,
                `value=${parsed.value}, currency=${parsed.currency}`,
                "success",
              );
            }
          } else {
            signal.aiError = aiAvailabilityError
              ? `AI unavailable (${aiAvailabilityError})`
              : `AI not available (${aiStatus})`;
            addLog(
              `AI: ${signalKey}`,
              aiAvailabilityError
                ? `Unavailable (${aiAvailabilityError})`
                : `Not available (${aiStatus})`,
              "warn",
            );
          }
        } catch (err) {
          const msg = getErrorMessage(err);
          signal.aiError = msg;
          addLog(`AI: ${signalKey}`, msg, "warn");
        }

        // Step B: CSS extraction (always run for comparison)
        const selectors = selectorMap[signalKey];
        const { candidates, elementsScanned } = collectFinancialCandidates(
          signalKey,
          selectors,
          cleanedRoot,
        );
        const best = pickBestCandidate(candidates);

        signal.candidateCount = candidates.length;
        signal.topCandidateText = best.candidate?.text;
        signal.topCandidateSelector = best.candidate?.selector;

        // Effective value: prefer AI, fall back to CSS
        if (signal.aiValue !== undefined && signal.aiValue !== null) {
          signal.value = signal.aiValue;
          signal.confidence = 1.0;
        } else {
          signal.value = best.value;
          signal.confidence = best.confidence;
        }

        const cssLevel: StepLog["level"] =
          best.value !== null &&
          best.confidence >= PRODUCTION_CONFIDENCE_THRESHOLD
            ? "success"
            : best.value !== null
              ? "warn"
              : "error";
        addLog(
          `CSS: ${signalKey}`,
          best.value !== null
            ? `value=${best.value}, confidence=${(best.confidence * 100).toFixed(0)}%, candidates=${candidates.length}, scanned=${elementsScanned}`
            : `No match found (${candidates.length} candidates, ${elementsScanned} scanned)`,
          cssLevel,
        );

        signals.push(signal);
      }

      result.signals = signals;
      result.aiPrompts = aiPrompts;
      result.aiResponses = aiResponses;
      document.body.removeChild(iframe);
      addLog("Complete", undefined, "success");
    } catch (err) {
      const msg = getErrorMessage(err);
      result.error = msg;
      logs.push({
        step: "ERROR",
        detail: msg,
        elapsedMs: timer.lap(),
        level: "error",
      });
    } finally {
      result.durationMs = timer.total();
      setResults((prev) => ({ ...prev, [runKey]: result }));
      setRunning((prev) => ({ ...prev, [runKey]: false }));
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────────────────

  const levelDot: Record<StepLog["level"], string> = {
    info: "bg-blue-400",
    warn: "bg-yellow-400",
    error: "bg-red-400",
    success: "bg-emerald-400",
  };

  function renderLogs(logs: StepLog[]) {
    return (
      <div className="mt-2 space-y-0.5">
        {logs.map((log, i) => (
          <div
            key={i}
            className="flex items-start gap-1.5 text-[11px] font-mono"
          >
            <span
              className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${levelDot[log.level]}`}
            />
            <span className="text-foreground font-semibold">{log.step}</span>
            {log.detail && (
              <span className="text-muted-foreground break-all">
                {log.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderSignals(signals: SignalResult[]) {
    return (
      <div className="grid grid-cols-3 gap-2 mt-2">
        {signals.map((s) => {
          const confidencePct = (s.confidence * 100).toFixed(0);
          const isGood =
            s.value !== null &&
            s.confidence >= PRODUCTION_CONFIDENCE_THRESHOLD;
          const isWarn =
            s.value !== null &&
            s.confidence < PRODUCTION_CONFIDENCE_THRESHOLD;
          return (
            <div
              key={s.signalKey}
              className={`p-2 rounded border text-xs ${
                isGood
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : isWarn
                    ? "border-yellow-500/30 bg-yellow-500/5"
                    : "border-red-500/30 bg-red-500/5"
              }`}
            >
              <div className="font-semibold text-foreground flex items-center gap-1">
                {isGood ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                ) : isWarn ? (
                  <AlertTriangle className="w-3 h-3 text-yellow-500" />
                ) : (
                  <XCircle className="w-3 h-3 text-red-500" />
                )}
                {s.signalKey.replace(/_/g, " ")}
              </div>
              <div className="mt-1 text-muted-foreground">
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground/70">CSS: </span>
                  {s.value !== null ? (
                    <>
                      <span className="text-foreground font-medium">
                        {s.signalKey === "net_annual_return"
                          ? `${s.value}%`
                          : `\u20AC${s.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      </span>
                      <span className="ml-1">({confidencePct}%)</span>
                    </>
                  ) : (
                    <span className="text-red-400">not found</span>
                  )}
                </div>
                <div>
                  <span className="text-[10px] uppercase text-muted-foreground/70">
                    <Bot className="w-2.5 h-2.5 inline mr-0.5" />
                    AI:{" "}
                  </span>
                  {s.aiValue !== undefined && s.aiValue !== null ? (
                    <span className="text-foreground font-medium">
                      {s.signalKey === "net_annual_return"
                        ? `${s.aiValue}%`
                        : `\u20AC${s.aiValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                      {s.aiCurrency && s.aiCurrency !== "EUR" && (
                        <span className="ml-1 text-muted-foreground">
                          ({s.aiCurrency})
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">
                      {s.aiError ?? "not run"}
                    </span>
                  )}
                </div>
              </div>
              {s.topCandidateText && (
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  &quot;{s.topCandidateText}&quot;
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  function renderCollapsible(
    collapsibleKey: string,
    title: string,
    content: string | undefined,
  ) {
    if (!content) return null;
    const isExpanded = expanded[collapsibleKey] ?? false;
    return (
      <div key={collapsibleKey} className="mt-2 border border-border/30 rounded">
        <button
          type="button"
          className="flex items-center gap-1 w-full p-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => toggleExpanded(collapsibleKey)}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          {title}
          <span className="ml-auto text-[10px] text-muted-foreground/60">
            {content.length.toLocaleString()} chars
          </span>
        </button>
        {isExpanded && (
          <pre className="p-2 text-[10px] font-mono text-muted-foreground bg-muted/30 overflow-auto max-h-60 border-t border-border/30">
            {content.length > 5000
              ? content.slice(0, 5000) + "\n... (truncated)"
              : content}
          </pre>
        )}
      </div>
    );
  }

  function renderResult(res: TestResult) {
    return (
      <div
        className={`p-3 rounded text-xs border ${res.error ? "border-destructive bg-destructive/10" : "border-border/40 bg-background/50"}`}
      >
        <div className="font-semibold mb-1 text-muted-foreground flex justify-between">
          Dashboard Extractor Result
          <span className="text-[10px] font-normal">
            {res.durationMs}ms
          </span>
        </div>
        {res.error && (
          <p className="text-destructive break-words mb-1">{res.error}</p>
        )}
        {res.signals && renderSignals(res.signals)}
        {renderCollapsible(
          `${res.platformId}-textTree`,
          "Text Tree",
          res.textTree,
        )}
        {res.aiPrompts &&
          Object.entries(res.aiPrompts).map(([key, prompt]) =>
            renderCollapsible(
              `${res.platformId}-aiPrompt-${key}`,
              `AI Prompt: ${key}`,
              prompt,
            ),
          )}
        {res.aiResponses &&
          Object.entries(res.aiResponses).map(([key, response]) =>
            renderCollapsible(
              `${res.platformId}-aiResponse-${key}`,
              `AI Response: ${key}`,
              response,
            ),
          )}
        {renderLogs(res.logs)}
      </div>
    );
  }

  function renderTransferCard(
    transfer: ExtractorTransfer,
    runKey: string,
  ) {
    if (!transferredConfig) return null;
    const res = results[runKey];

    return (
      <div className="glass-card space-y-4 border border-primary/20 p-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              Transferred HTML
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {transfer.platformName} dashboard page captured from Debug.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => openHtmlContent(transfer.html)}
              className={actionButtonGhostClass}
            >
              View HTML
            </button>
            <button
              type="button"
              data-testid="clear-dashboard-transfer"
              onClick={() => clearExtractorTransfer("dashboard")}
              className={actionButtonGhostClass}
            >
              Clear
            </button>
            <button
              type="button"
              data-testid="transferred-dashboard-test"
              onClick={() =>
                void runDashboardTest(transfer.platformId, {
                  html: transfer.html,
                  runKey,
                })
              }
              disabled={running[runKey]}
              className={actionButtonPrimaryClass}
            >
              {running[runKey] ? (
                <RotateCw className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              Test
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            HTML Preview
          </div>
          <pre className="max-h-32 overflow-auto rounded-lg border border-border/40 bg-background/70 p-3 text-[11px] text-muted-foreground whitespace-pre-wrap">
            {transfer.html}
          </pre>
        </div>

        <div className="grid gap-2">
          {[
            "portfolioValueSelectors",
            "freeCashSelectors",
            "netAnnualReturnSelectors",
          ].map((key) => {
            const defaultVal = transferredConfig.dashboard[
              key as keyof typeof transferredConfig.dashboard
            ] as string[];
            const currentVal =
              overrides[transfer.platformId]?.[key] !== undefined
                ? overrides[transfer.platformId]?.[key]
                : defaultVal.join("\n");

            return (
              <div key={key}>
                <label className="text-xs text-muted-foreground mb-1 block">
                  {key}
                </label>
                <textarea
                  className="min-h-[60px] w-full rounded-lg border border-input bg-card p-2 text-xs font-mono"
                  value={currentVal}
                  onChange={(e) =>
                    handleOverrideChange(
                      transfer.platformId,
                      key,
                      e.target.value,
                    )
                  }
                />
              </div>
            );
          })}
        </div>

        {res && renderResult(res)}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
              Dashboard Extractor
            </h1>
            <Bot className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">
            Test CSS selector extraction and AI-powered extraction against saved HTML snapshots.
          </p>
        </div>
        <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-muted-foreground">
          CSS + AI fixtures
        </span>
      </div>

      {dashboardTransfer &&
        (transferredConfig ? (
          renderTransferCard(dashboardTransfer, transferRunKey)
        ) : (
          <div className="glass-card space-y-3 border border-destructive/30 p-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Transferred HTML is invalid
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Platform <code>{dashboardTransfer.platformId}</code> is no longer
                available in the catalog.
              </p>
            </div>
            <button
              type="button"
              data-testid="clear-dashboard-transfer"
              onClick={() => clearExtractorTransfer("dashboard")}
              className={actionButtonGhostClass}
            >
              Clear
            </button>
          </div>
        ))}

      {fixtureError && (
        <p role="alert" className="text-sm text-destructive break-words">
          {fixtureError}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-1">
        {platforms.map((p) => {
          const res = results[p.id];

          return (
            <div key={p.id} className="glass-card space-y-4 p-6">
              <div className="flex items-center justify-between border-b border-border pb-4">
                <h3 className="text-lg font-semibold text-foreground">{p.name}</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => openHtmlFixture(p.id)}
                    className={actionButtonGhostClass}
                  >
                    View HTML
                  </button>
                  <button
                    onClick={() => runDashboardTest(p.id)}
                    disabled={running[p.id]}
                    className={actionButtonPrimaryClass}
                  >
                    {running[p.id] ? (
                      <RotateCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Test
                  </button>
                </div>
              </div>

              <div className="grid gap-2">
                {[
                  "portfolioValueSelectors",
                  "freeCashSelectors",
                  "netAnnualReturnSelectors",
                ].map((key) => {
                  const defaultVal = p.dashboard[
                    key as keyof typeof p.dashboard
                  ] as string[];
                  const currentVal =
                    overrides[p.id]?.[key] !== undefined
                      ? overrides[p.id]?.[key]
                      : defaultVal.join("\n");

                  return (
                    <div key={key}>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {key}
                      </label>
                      <textarea
                        className="min-h-[60px] w-full rounded-lg border border-input bg-card p-2 text-xs font-mono"
                        value={currentVal}
                        onChange={(e) =>
                          handleOverrideChange(p.id, key, e.target.value)
                        }
                      />
                    </div>
                  );
                })}
              </div>

              {res && renderResult(res)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
