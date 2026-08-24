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
  ExtractorTransfer,
  PlatformId,
} from "../../shared/types/index.js";
import { getErrorMessage } from "../../shared/error-utils.js";
import { getPlatformCatalog } from "../../shared/platforms/index.js";
import { logins } from "../../../tests/fixtures/platform-html-bundle.js";
import { useDashboardStore } from "../store.js";
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

interface SelectorMatch {
  role: string;
  selectors: string[];
  matchedSelector: string | null;
  matchedElement: string | null;
}

interface TestResult {
  timestamp: string;
  durationMs: number;
  platformId: PlatformId;
  logs: StepLog[];
  error?: string | undefined;
  selectorMatches?: SelectorMatch[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── Component ───────────────────────────────────────────────────────────────

export function LoginExtractorTab() {
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [fixtureError, setFixtureError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Record<string, Record<string, string>>
  >({});
  const loginTransfer = useDashboardStore(
    (s) =>
      (s.extractorTransfer?.pageType === "login" ? s.extractorTransfer : null) ??
      s.extractorTransfers.login ??
      null,
  );
  const clearExtractorTransfer = useDashboardStore((s) => s.clearExtractorTransfer);
  const actionButtonBaseClass =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
  const actionButtonGhostClass = `${actionButtonBaseClass} border-border bg-card text-muted-foreground hover:bg-accent hover:text-primary`;
  const actionButtonPrimaryClass = `${actionButtonBaseClass} border-primary bg-primary text-primary-foreground shadow-sm hover:opacity-90`;

  const platforms = getPlatformCatalog().filter((p) => p.enabled);
  const transferredConfig = loginTransfer
    ? platforms.find((platform) => platform.id === loginTransfer.platformId)
    : undefined;
  const transferRunKey = loginTransfer
    ? `transfer:login:${loginTransfer.platformId}`
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

  function openHtmlContent(html: string) {
    const blob = new Blob([html], { type: "text/html" });
    window.open(URL.createObjectURL(blob), "_blank");
  }

  function fixtureHtml(module: string | { default?: string; html?: string }): string {
    if (typeof module === "string") return module;
    return module.html ?? module.default ?? "";
  }

  async function loadLoginHtml(platformId: PlatformId): Promise<string> {
    const htmlImportP = logins[platformId as keyof typeof logins];
    if (!htmlImportP) {
      throw new Error(`No login fixture found for ${platformId}`);
    }
    const htmlModule = await htmlImportP;
    return fixtureHtml(htmlModule);
  }

  async function openHtmlFixture(platformId: PlatformId) {
    setFixtureError(null);
    try {
      const html = await loadLoginHtml(platformId);
      openHtmlContent(html);
    } catch (err) {
      setFixtureError(
        `Failed to open HTML: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async function runLoginTest(
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
      addLog("Starting", `Login selector test for ${config.name}`);

      const html =
        options?.html !== undefined
          ? options.html
          : await loadLoginHtml(platformId);
      addLog(
        options?.html !== undefined
          ? "Using transferred HTML"
          : "Loaded HTML fixture",
        `${(html.length / 1024).toFixed(1)} KB`,
      );

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

      const selectorGroups: { role: string; selectors: string[] }[] = [
        {
          role: "Username",
          selectors: getOverride(
            platformId,
            "usernameSelectors",
            config.login.usernameSelectors,
          ),
        },
        {
          role: "Password",
          selectors: getOverride(
            platformId,
            "passwordSelectors",
            config.login.passwordSelectors,
          ),
        },
        {
          role: "Submit",
          selectors: getOverride(
            platformId,
            "submitSelectors",
            config.login.submitSelectors,
          ),
        },
        {
          role: "OTP",
          selectors: getOverride(
            platformId,
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
            `matched: ${matchedSelector} -> ${matchedElement}`,
            "success",
          );
        } else {
          addLog(
            `${role}`,
            `No match (tried ${selectors.length} selectors)`,
            isOptional ? "warn" : "error",
          );
        }

        addLog(`  Selectors`, selectors.join(", "));
      }

      const indicators = config.login.postLoginIndicators;
      let indicatorMatches = 0;
      for (const indicator of indicators) {
        if (indicator.startsWith("text=")) continue;
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
                    {"→"} {m.matchedElement}
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
        <div className="font-semibold mb-1 text-muted-foreground">
          Login Selectors Result
        </div>
        {res.error && (
          <p className="text-destructive break-words mb-1">{res.error}</p>
        )}
        {res.selectorMatches && renderSelectorMatches(res.selectorMatches)}
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
              {transfer.platformName} login page captured from Debug.
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
              data-testid="clear-login-transfer"
              onClick={() => clearExtractorTransfer("login")}
              className={actionButtonGhostClass}
            >
              Clear
            </button>
            <button
              type="button"
              data-testid="transferred-login-test"
              onClick={() =>
                void runLoginTest(transfer.platformId, {
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
            "usernameSelectors",
            "passwordSelectors",
            "submitSelectors",
            "otpSelectors",
          ].map((key) => {
            const defaultVal = transferredConfig.login[
              key as keyof typeof transferredConfig.login
            ] as string[];
            if (!Array.isArray(defaultVal)) return null;

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
              Login Extractor
            </h1>
          </div>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">
            Test login selectors from <code className="text-sm">platform-catalog.json</code>{" "}
            against saved HTML snapshots.
          </p>
        </div>
        <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-muted-foreground">
          HTML fixtures
        </span>
      </div>

      {loginTransfer &&
        (transferredConfig ? (
          renderTransferCard(loginTransfer, transferRunKey)
        ) : (
          <div className="glass-card space-y-3 border border-destructive/30 p-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Transferred HTML is invalid
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Platform <code>{loginTransfer.platformId}</code> is no longer
                available in the catalog.
              </p>
            </div>
            <button
              type="button"
              data-testid="clear-login-transfer"
              onClick={() => clearExtractorTransfer("login")}
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
                    onClick={() => runLoginTest(p.id)}
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
