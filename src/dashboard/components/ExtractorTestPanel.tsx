import { useState } from "react";
import {
  FlaskConical,
  Play,
  RotateCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import type {
  PlatformId,
  FinancialSignalKey,
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
  dashboards,
  logins,
} from "../../../tests/fixtures/platform-html-bundle.js";
import {
  createStepTimer,
  describeLoginElement,
} from "../utils/extractor-helpers.js";

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
}

interface SelectorMatch {
  role: string;
  selectors: string[];
  matchedSelector: string | null;
  matchedElement: string | null;
}

interface TestResult {
  timestamp: string;
  durationMs: number;
  type: "extractor" | "login";
  platformId: PlatformId;
  logs: StepLog[];
  error?: string | undefined;
  signals?: SignalResult[];
  selectorMatches?: SelectorMatch[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type HtmlFixtureModule = string | { default?: string; html?: string };

function fixtureHtml(module: HtmlFixtureModule): string {
  if (typeof module === "string") return module;
  return module.html ?? module.default ?? "";
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ExtractorTestPanel() {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Record<
      string,
      {
        dashboard: Record<string, string>;
        login: Record<string, string>;
      }
    >
  >({});
  const actionButtonBaseClass =
    "inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
  const actionButtonGhostClass = `${actionButtonBaseClass} border-border/60 bg-background/70 text-muted-foreground hover:border-border hover:bg-accent/70 hover:text-foreground`;
  const actionButtonPrimaryClass = `${actionButtonBaseClass} border-primary/40 bg-primary text-primary-foreground shadow-sm hover:-translate-y-[1px] hover:bg-primary/90 hover:shadow-md`;

  const platforms = getPlatformCatalog().filter((p) => p.enabled);

  function getOverride(
    platformId: string,
    type: "dashboard" | "login",
    key: string,
    defaultValue: string[],
  ): string[] {
    const val = overrides[platformId]?.[type]?.[key];
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
    type: "dashboard" | "login",
    key: string,
    value: string,
  ) {
    setOverrides((prev) => ({
      ...prev,
      [platformId]: {
        ...prev[platformId],
        dashboard: prev[platformId]?.dashboard || {},
        login: prev[platformId]?.login || {},
        [type]: {
          ...(prev[platformId]?.[type] || {}),
          [key]: value,
        },
      },
    }));
  }

  async function openHtmlFixture(
    platformId: PlatformId,
    type: "dashboard" | "login",
  ) {
    setFixtureError(null);
    try {
      const fixtures = type === "dashboard" ? dashboards : logins;
      const htmlImportP = fixtures[platformId as keyof typeof fixtures];
      if (!htmlImportP) {
        setFixtureError(`No ${type} fixture found for ${platformId}`);
        return;
      }
      const htmlModule = await htmlImportP;
      const html = fixtureHtml(htmlModule);

      const blob = new Blob([html], { type: "text/html" });
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (err) {
      setFixtureError(`Failed to open HTML: ${err}`);
    }
  }

  // ─── Extractor Test ──────────────────────────────────────────────────────

  async function runExtractorTest(platformId: PlatformId) {
    const runKey = `${platformId}-extractor`;
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
      type: "extractor",
      platformId,
      logs,
    };

    try {
      const config = getPlatformCatalog().find((p) => p.id === platformId)!;
      addLog("Starting", `Extractor test for ${config.name}`);

      // 1. Load HTML fixture
      const htmlImportP = dashboards[platformId as keyof typeof dashboards];
      if (!htmlImportP) {
        throw new Error(`No dashboard fixture found for ${platformId}`);
      }
      const htmlModule = await htmlImportP;
      const html = fixtureHtml(htmlModule);
      addLog("Loaded HTML fixture", `${(html.length / 1024).toFixed(1)} KB`);

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
        `${cleanupStats.rawLength} → ${cleanupStats.cleanedLength} chars (${cleanupStats.reductionPct}% reduction, ${cleanupStats.elementsRemoved} elements removed)`,
      );

      // 4. Extract all 3 signals
      const signalKeys: FinancialSignalKey[] = [
        "portfolio_value",
        "free_cash",
        "net_annual_return",
      ];
      const selectorMap: Record<FinancialSignalKey, string[]> = {
        portfolio_value: getOverride(
          platformId,
          "dashboard",
          "portfolioValueSelectors",
          config.dashboard.portfolioValueSelectors,
        ),
        free_cash: getOverride(
          platformId,
          "dashboard",
          "freeCashSelectors",
          config.dashboard.freeCashSelectors,
        ),
        net_annual_return: getOverride(
          platformId,
          "dashboard",
          "netAnnualReturnSelectors",
          config.dashboard.netAnnualReturnSelectors,
        ),
      };

      const signals: SignalResult[] = [];

      for (const signalKey of signalKeys) {
        const selectors = selectorMap[signalKey];
        const { candidates, elementsScanned } = collectFinancialCandidates(
          signalKey,
          selectors,
          cleanedRoot,
        );
        const best = pickBestCandidate(candidates);

        signals.push({
          signalKey,
          value: best.value,
          confidence: best.confidence,
          candidateCount: candidates.length,
          topCandidateText: best.candidate?.text,
          topCandidateSelector: best.candidate?.selector,
        });

        const level: StepLog["level"] =
          best.value !== null &&
          best.confidence >= PRODUCTION_CONFIDENCE_THRESHOLD
            ? "success"
            : best.value !== null
              ? "warn"
              : "error";
        addLog(
          `${signalKey}`,
          best.value !== null
            ? `value=${best.value}, confidence=${(best.confidence * 100).toFixed(0)}%, candidates=${candidates.length}, scanned=${elementsScanned}`
            : `No match found (${candidates.length} candidates, ${elementsScanned} scanned)`,
          level,
        );

        addLog(
          `  Selectors`,
          selectors.slice(0, 5).join(", ") +
            (selectors.length > 5 ? ` (+${selectors.length - 5} more)` : selectors.length === 0 ? "(none — heuristic fallback)" : ""),
        );
      }

      result.signals = signals;
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

  // ─── Login Selector Test ─────────────────────────────────────────────────

  async function runLoginTest(platformId: PlatformId) {
    const runKey = `${platformId}-login`;
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
      type: "login",
      platformId,
      logs,
    };

    try {
      const config = getPlatformCatalog().find((p) => p.id === platformId)!;
      addLog("Starting", `Login selector test for ${config.name}`);

      // 1. Load login HTML fixture
      const htmlImportP = logins[platformId as keyof typeof logins];
      if (!htmlImportP) {
        throw new Error(`No login fixture found for ${platformId}`);
      }
      const htmlModule = await htmlImportP;
      const html = fixtureHtml(htmlModule);
      addLog("Loaded HTML fixture", `${(html.length / 1024).toFixed(1)} KB`);

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
      addLog(
        "Parsed HTML into DOM",
        `${doc.querySelectorAll("*").length} elements`,
      );

      // 3. Test each selector group
      const selectorGroups: { role: string; selectors: string[] }[] = [
        {
          role: "Username",
          selectors: getOverride(
            platformId,
            "login",
            "usernameSelectors",
            config.login.usernameSelectors,
          ),
        },
        {
          role: "Password",
          selectors: getOverride(
            platformId,
            "login",
            "passwordSelectors",
            config.login.passwordSelectors,
          ),
        },
        {
          role: "Submit",
          selectors: getOverride(
            platformId,
            "login",
            "submitSelectors",
            config.login.submitSelectors,
          ),
        },
        {
          role: "OTP",
          selectors: getOverride(
            platformId,
            "login",
            "otpSelectors",
            config.login.otpSelectors,
          ),
        },
      ];

      const selectorMatches: SelectorMatch[] = [];

      for (const { role, selectors } of selectorGroups) {
        let matchedSelector: string | null = null;
        let matchedElement: string | null = null;

        for (const sel of selectors) {
          try {
            const el = doc.querySelector(sel);
            if (el) {
              matchedSelector = sel;
              matchedElement = describeLoginElement(el);
              break;
            }
          } catch {
            // Invalid selector syntax
          }
        }

        selectorMatches.push({
          role,
          selectors,
          matchedSelector,
          matchedElement,
        });

        const isOptional = role === "OTP";
        if (matchedSelector) {
          addLog(
            `${role}`,
            `✓ ${matchedSelector} → ${matchedElement}`,
            "success",
          );
        } else {
          addLog(
            `${role}`,
            `✗ No match (tried ${selectors.length} selectors)`,
            isOptional ? "warn" : "error",
          );
        }

        // Log the selectors tried
        addLog(`  Selectors`, selectors.join(", "));
      }

      // 4. Test post-login indicators (text-based won't match on login page — that's expected)
      const indicators = config.login.postLoginIndicators;
      let indicatorMatches = 0;
      for (const indicator of indicators) {
        if (indicator.startsWith("text=")) continue; // Skip text patterns
        try {
          if (doc.querySelector(indicator)) indicatorMatches++;
        } catch {
          /* invalid selector */
        }
      }
      addLog(
        "Post-login indicators",
        `${indicatorMatches}/${indicators.length} matched (expected: 0 on login page)`,
      );

      result.selectorMatches = selectorMatches;
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
                {s.value !== null ? (
                  <>
                    <span className="text-foreground font-medium">
                      {s.signalKey === "net_annual_return"
                        ? `${s.value}%`
                        : `€${s.value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    </span>
                    <span className="ml-1">({confidencePct}%)</span>
                  </>
                ) : (
                  <span className="text-red-400">not found</span>
                )}
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

  function renderSelectorMatches(matches: SelectorMatch[]) {
    return (
      <div className="mt-2 space-y-1">
        {matches.map((m) => (
          <div
            key={m.role}
            className={`flex items-center gap-2 text-xs p-1.5 rounded ${
              m.matchedSelector
                ? "bg-emerald-500/5 border border-emerald-500/20"
                : m.role === "OTP"
                  ? "bg-muted/30 border border-border/30"
                  : "bg-red-500/5 border border-red-500/20"
            }`}
          >
            {m.matchedSelector ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
            ) : m.role === "OTP" ? (
              <AlertTriangle className="w-3 h-3 text-muted-foreground shrink-0" />
            ) : (
              <XCircle className="w-3 h-3 text-red-500 shrink-0" />
            )}
            <span className="font-semibold text-foreground w-16 shrink-0">
              {m.role}
            </span>
            {m.matchedSelector ? (
              <span className="text-muted-foreground truncate">
                <code className="text-emerald-600 dark:text-emerald-400">
                  {m.matchedSelector}
                </code>
                {m.matchedElement && (
                  <span className="ml-1 text-muted-foreground">
                    → {m.matchedElement}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {m.role === "OTP" ? "not found (optional)" : "no match"}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  function renderResult(res: TestResult) {
    return (
      <div
        className={`p-3 rounded text-xs border ${res.error ? "border-destructive bg-destructive/10" : "border-border/40 bg-background/50"}`}
      >
        <div className="font-semibold mb-1 text-muted-foreground flex justify-between">
          {res.type === "extractor" ? "Extractor" : "Login Selectors"} Result
        </div>
        {res.error && (
          <p className="text-destructive break-words mb-1">{res.error}</p>
        )}
        {res.signals && renderSignals(res.signals)}
        {res.selectorMatches && renderSelectorMatches(res.selectorMatches)}
        {renderLogs(res.logs)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FlaskConical className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-lg font-medium text-foreground">Extractor Test</h2>
        <span className="ml-auto rounded px-2 py-0.5 text-xs font-medium bg-accent/50 text-muted-foreground">
          Tests run against HTML fixtures
        </span>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">
        Test the heuristic extractor and login selectors from{" "}
        <code className="text-[11px]">platform-catalog.json</code> against saved
        HTML snapshots. No AI — pure DOM queries.
      </p>
      {fixtureError && <p className="error">{fixtureError}</p>}

      <div className="grid gap-4 md:grid-cols-1">
        {platforms.map((p) => {
          const extKey = `${p.id}-extractor`;
          const logKey = `${p.id}-login`;
          const extRes = results[extKey];
          const logRes = results[logKey];

          return (
            <div key={p.id} className="glass-card p-4 space-y-4">
              <h3 className="font-medium text-base border-b border-border/50 pb-2 mb-2">
                {p.name}
              </h3>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm text-foreground">
                      Dashboard Extractor
                    </h4>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openHtmlFixture(p.id, "dashboard")}
                        className={actionButtonGhostClass}
                      >
                        View HTML
                      </button>
                      <button
                        onClick={() => runExtractorTest(p.id)}
                        disabled={running[extKey]}
                        className={actionButtonPrimaryClass}
                      >
                        {running[extKey] ? (
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
                        overrides[p.id]?.dashboard?.[key] !== undefined
                          ? overrides[p.id]?.dashboard?.[key]
                          : defaultVal.join("\n");

                      return (
                        <div key={key}>
                          <label className="text-xs text-muted-foreground mb-1 block">
                            {key}
                          </label>
                          <textarea
                            className="w-full bg-background/50 border border-input rounded p-1.5 text-xs font-mono min-h-[60px]"
                            value={currentVal}
                            onChange={(e) =>
                              handleOverrideChange(
                                p.id,
                                "dashboard",
                                key,
                                e.target.value,
                              )
                            }
                          />
                        </div>
                      );
                    })}
                  </div>

                  {extRes && renderResult(extRes)}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm text-foreground">
                      Login Selectors
                    </h4>
                    <div className="flex gap-2">
                      <button
                        onClick={() => openHtmlFixture(p.id, "login")}
                        className={actionButtonGhostClass}
                      >
                        View HTML
                      </button>
                      <button
                        onClick={() => runLoginTest(p.id)}
                        disabled={running[logKey]}
                        className={actionButtonPrimaryClass}
                      >
                        {running[logKey] ? (
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
                      "usernameSelectors",
                      "passwordSelectors",
                      "submitSelectors",
                      "otpSelectors",
                    ].map((key) => {
                      const defaultVal = p.login[
                        key as keyof typeof p.login
                      ] as string[];
                      if (!Array.isArray(defaultVal)) return null;

                      const currentVal =
                        overrides[p.id]?.login?.[key] !== undefined
                          ? overrides[p.id]?.login?.[key]
                          : defaultVal.join("\n");

                      return (
                        <div key={key}>
                          <label className="text-xs text-muted-foreground mb-1 block">
                            {key}
                          </label>
                          <textarea
                            className="w-full bg-background/50 border border-input rounded p-1.5 text-xs font-mono min-h-[60px]"
                            value={currentVal}
                            onChange={(e) =>
                              handleOverrideChange(
                                p.id,
                                "login",
                                key,
                                e.target.value,
                              )
                            }
                          />
                        </div>
                      );
                    })}
                  </div>

                  {logRes && renderResult(logRes)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
