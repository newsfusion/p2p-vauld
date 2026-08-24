import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AiExtractionLog,
  IngestConnectorResultOutcome,
  LoginSelectorProfile,
  PlatformCatalogEntry,
  SelectorProfile,
  NavigationProfile,
  StoredCredentials,
  StoredMetricsSnapshot,
  StoredSyncRun,
  SyncEvent,
} from "../../src/shared/types/index.js";
import type { ExtractSignalResult } from "../../src/background/sync/debug-logger.js";

const demoModeState = vi.hoisted(() => ({ enabled: false }));
const syncRunState = vi.hoisted(() => ({ runId: "run-1" }));
const ingestConnectorResultMock = vi.fn<
  () => Promise<IngestConnectorResultOutcome | undefined>
>(async () => undefined);
const revertPlatformBatchMock = vi.fn(async () => undefined);
const updatePlatformProgressMock = vi.fn(async (runId: string) => {
  syncRunState.runId = runId;
});
const getLatestSyncRunMock = vi.fn(async (): Promise<StoredSyncRun> => ({
  runId: syncRunState.runId,
  state: "running" as const,
  startedAt: "2026-06-17T10:00:00.000Z",
  platformProgress: {
    mintos: "running" as const,
    debitum: "running" as const,
  },
}));
const getSettingsMock = vi.fn(async () => ({
  debugModeEnabled: true,
  parallelSyncEnabled: false,
}));
const calculateNetAnnualReturnMock = vi.fn(async () => null);
const getSelectorProfilesMock = vi.fn(
  async (): Promise<SelectorProfile[]> => [],
);
const getMetricsHistoryMock = vi.fn(
  async (): Promise<StoredMetricsSnapshot[]> => [],
);
const logExtractionTelemetryMock = vi.fn(async () => undefined);
const getLoginSelectorProfilesMock = vi.fn(
  async (): Promise<LoginSelectorProfile[]> => [],
);
const learnSelectorMock = vi.fn(async () => undefined);
const learnLoginSelectorsMock = vi.fn(async () => undefined);
const markSelectorFailureMock = vi.fn(async () => undefined);
const markLoginSelectorFailuresMock = vi.fn(async () => undefined);
const getNavigationProfileMock = vi.fn(
  async (): Promise<NavigationProfile | undefined> => undefined,
);
const learnNavigationProfileMock = vi.fn(async () => undefined);
const markNavigationFailureMock = vi.fn(async () => undefined);
const getCredentialsMock = vi.fn(async (): Promise<StoredCredentials> => ({
  platformId: "mintos",
  encryptedUsername: { iv: "iv", ciphertext: "user" },
  encryptedPassword: { iv: "iv", ciphertext: "pass" },
  createdAt: "2026-05-25T10:00:00.000Z",
  updatedAt: "2026-05-25T10:00:00.000Z",
}));
const saveCredentialsMock = vi.fn<
  (credentials: StoredCredentials) => Promise<void>
>(async () => undefined);
const getEncryptionKeyMock = vi.fn(async () => ({ key: "test-key" }));
const decryptMock = vi
  .fn<(key: unknown, payload: unknown) => Promise<string>>()
  .mockResolvedValueOnce("user@example.com")
  .mockResolvedValueOnce("super-secret");
const openTabMock = vi.fn(async () => ({ id: 11 }));
const waitForTabLoadMock = vi.fn(async () => undefined);
const navigateTabToUrlMock = vi.fn(async () => true);
const hideTabWindowMock = vi.fn(async () => undefined);
const closeTabMock = vi.fn(async () => undefined);
const sendToTabWithTimeoutMock = vi.fn();
const waitForManualActionMock = vi.fn(async () => true);
const waitForExtractionChoiceMock = vi.fn(
  async (..._args: unknown[]): Promise<string> => {
  throw new Error("choice required");
  },
);
const capturePageHtmlMock = vi
  .fn()
  .mockResolvedValueOnce("<html><body>Login HTML</body></html>")
  .mockResolvedValueOnce("<html><body>Dashboard HTML</body></html>");
const extractSignalFromTabMock = vi.fn(
  async (..._args: unknown[]): Promise<ExtractSignalResult> => ({
  value: null,
  confidence: 0,
  allCandidates: [],
  elementsScanned: 0,
}));
interface FetchedTextTree {
  textTree: string;
  truncated: boolean;
  nodeCount?: number | undefined;
}
/** Mirrors what the content script now returns: tree plus pruning diagnostics. */
function fetchedTree(textTree: string, truncated = false): FetchedTextTree {
  return { textTree, truncated };
}
const getTextTreeFromTabMock = vi.fn<() => Promise<FetchedTextTree | null>>(
  async () => null,
);
type AiTextTreeExtractionResult =
  | { ok: true; value: number; currency: string; aiLog: AiExtractionLog }
  | { ok: false; aiLog: AiExtractionLog };
const aiExtractSignalFromTextTreeMock = vi.fn<
  () => Promise<AiTextTreeExtractionResult>
>(async () => ({
  ok: false,
  aiLog: { available: false, reason: "unavailable" },
}));
const signalSelectorsMock = vi.fn(() => []);
const runConvergentExtractionMock = vi.fn(
  async ({
    extract,
  }: {
    extract: () => Promise<{
      portfolio_value: ExtractSignalResult;
      free_cash: ExtractSignalResult;
    }>;
  }) => {
    const result = await extract();
    return {
      portfolio: result.portfolio_value,
      freeCash: result.free_cash,
      pollCount: 1,
      converged: true,
      warnings: [] as string[],
    };
  },
);
const hasUnsafeDuplicateSignalCandidateMock = vi.fn(
  (portfolio: ExtractSignalResult, freeCash: ExtractSignalResult) =>
    portfolio.value !== null &&
    freeCash.value !== null &&
    Math.abs(portfolio.value - freeCash.value) <= 0.005 &&
    portfolio.candidate?.origin === "heuristic" &&
    freeCash.candidate?.origin === "heuristic" &&
    portfolio.candidate.selector === freeCash.candidate.selector &&
    portfolio.candidate.text === freeCash.candidate.text &&
    portfolio.candidate.context === freeCash.candidate.context,
);
const runPlatformsMock = vi.fn(
  async (
    platforms: PlatformCatalogEntry[],
    runner: (platform: PlatformCatalogEntry, signal?: AbortSignal) => Promise<unknown>,
  ) => {
    for (const platform of platforms) {
      await runner(platform, undefined);
    }
  },
);
const callMock = <T>(mock: unknown, args: unknown[]): T =>
  (mock as (...args: unknown[]) => T)(...args);

vi.mock("../../src/background/db-proxy.js", () => ({
  ingestConnectorResult: (...args: unknown[]) =>
    callMock(ingestConnectorResultMock, args),
  revertPlatformBatch: (...args: unknown[]) =>
    callMock(revertPlatformBatchMock, args),
  updatePlatformProgress: (...args: unknown[]) =>
    callMock(updatePlatformProgressMock, args),
  getLatestSyncRun: () => getLatestSyncRunMock(),
  getSettings: () => getSettingsMock(),
  calculateNetAnnualReturn: () => calculateNetAnnualReturnMock(),
  getSelectorProfiles: () => getSelectorProfilesMock(),
  getMetricsHistory: (...args: unknown[]) =>
    callMock(getMetricsHistoryMock, args),
  logExtractionTelemetry: (...args: unknown[]) =>
    callMock(logExtractionTelemetryMock, args),
  getLoginSelectorProfiles: () => getLoginSelectorProfilesMock(),
  learnSelector: (...args: unknown[]) => callMock(learnSelectorMock, args),
  learnLoginSelectors: (...args: unknown[]) =>
    callMock(learnLoginSelectorsMock, args),
  markSelectorFailure: (...args: unknown[]) =>
    callMock(markSelectorFailureMock, args),
  markLoginSelectorFailures: (...args: unknown[]) =>
    callMock(markLoginSelectorFailuresMock, args),
  getNavigationProfile: (...args: unknown[]) =>
    callMock(getNavigationProfileMock, args),
  learnNavigationProfile: (...args: unknown[]) =>
    callMock(learnNavigationProfileMock, args),
  markNavigationFailure: (...args: unknown[]) =>
    callMock(markNavigationFailureMock, args),
  getCredentials: (...args: unknown[]) => callMock(getCredentialsMock, args),
  saveCredentials: (...args: unknown[]) => callMock(saveCredentialsMock, args),
}));

vi.mock("../../src/background/keystore.js", () => ({
  getEncryptionKey: () => getEncryptionKeyMock(),
}));

vi.mock("../../src/shared/crypto/index.js", () => ({
  decrypt: (...args: unknown[]) => callMock(decryptMock, args),
  credentialAad: (platformId: string, field: string) => `${platformId}:${field}`,
}));

vi.mock("../../src/background/sync/tab-session.js", () => ({
  openTab: (...args: unknown[]) => callMock(openTabMock, args),
  waitForTabLoad: (...args: unknown[]) => callMock(waitForTabLoadMock, args),
  navigateTabToUrl: (...args: unknown[]) =>
    callMock(navigateTabToUrlMock, args),
  hideTabWindow: (...args: unknown[]) => callMock(hideTabWindowMock, args),
  closeTab: (...args: unknown[]) => callMock(closeTabMock, args),
  resolvePostLoginNavigationUrl: () => "https://example.test/dashboard",
  resolveNavigationAction: vi.fn(),
}));

vi.mock("../../src/background/sync/content-messaging.js", () => ({
  sendToTabWithTimeout: (...args: unknown[]) =>
    callMock(sendToTabWithTimeoutMock, args),
}));

vi.mock("../../src/background/sync/manual-action.js", () => ({
  waitForManualAction: (...args: unknown[]) =>
    callMock(waitForManualActionMock, args),
}));

vi.mock("../../src/background/sync/extraction-choice-action.js", () => ({
  ExtractionChoiceTimeoutError: class ExtractionChoiceTimeoutError extends Error {
    constructor(message = "Extraction choice timeout") {
      super(message);
      this.name = "ExtractionChoiceTimeoutError";
    }
  },
  waitForExtractionChoice: (...args: unknown[]) =>
    callMock(waitForExtractionChoiceMock, args),
}));

vi.mock("../../src/background/sync/extraction-orchestrator.js", () => ({
  capturePageHtml: (...args: unknown[]) => callMock(capturePageHtmlMock, args),
  extractSignalFromTab: (...args: unknown[]) =>
    callMock(extractSignalFromTabMock, args),
  getTextTreeFromTab: (...args: unknown[]) =>
    callMock(getTextTreeFromTabMock, args),
  aiExtractSignalFromTextTree: (...args: unknown[]) =>
    callMock(aiExtractSignalFromTextTreeMock, args),
  signalSelectors: (...args: unknown[]) => callMock(signalSelectorsMock, args),
}));

vi.mock("../../src/background/sync/extraction-verifier.js", () => ({
  runConvergentExtraction: (...args: unknown[]) =>
    callMock(runConvergentExtractionMock, args),
  hasUnsafeDuplicateSignalCandidate: (...args: unknown[]) =>
    callMock(hasUnsafeDuplicateSignalCandidateMock, args),
}));

vi.mock("../../src/background/sync/sync-runner.js", () => ({
  runPlatforms: (...args: unknown[]) => callMock(runPlatformsMock, args),
}));

vi.mock("../../src/shared/demo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/shared/demo.js")>();
  return {
    ...actual,
    get isDemoModeEnabled() {
      return demoModeState.enabled;
    },
  };
});

/**
 * A candidate with label evidence and a score above the auto-select bar, so
 * `isWellEvidenced` accepts it and the dashboard navigation ladder stays put.
 */
const wellEvidencedCandidate = {
  selector: ".portfolio-value",
  text: "€1.000,00",
  value: 1000,
  score: 4.5,
  keywordHits: 1,
  origin: "heuristic" as const,
};

/**
 * A selector candidate agreeing with {@link wellEvidencedCandidate}. Pairing the
 * two makes `resolveExtractionChoice` auto-select instead of opening the choice
 * modal, so a run can complete end to end.
 */
const agreeingCandidatePair = [
  { ...wellEvidencedCandidate, score: 5.5, origin: "selector" as const },
  wellEvidencedCandidate,
];

const basePlatform: PlatformCatalogEntry = {
  id: "mintos",
  name: "Mintos",
  enabled: true,
  strategy: "universal",
  domains: ["mintos.com"],
  login: {
    entryUrl: "https://example.test/login",
    usernameSelectors: ["#username"],
    passwordSelectors: ["#password"],
    submitSelectors: ['button[type="submit"]'],
    otpSelectors: [],
    postLoginIndicators: [".dashboard"],
  },
  dashboard: {
    portfolioValueSelectors: [".portfolio-value"],
    freeCashSelectors: [".free-cash"],
    netAnnualReturnSelectors: [".return"],
  },
};

const secondPlatform: PlatformCatalogEntry = {
  ...basePlatform,
  id: "debitum",
  name: "Debitum",
  domains: ["debitum.test"],
  login: {
    ...basePlatform.login,
    entryUrl: "https://debitum.test/login",
  },
};

function duplicateHeuristicResult(): ExtractSignalResult {
  return {
    value: 15800.7,
    confidence: 0.92,
    candidate: {
      selector: "h3.eg-1gw7oiu",
      text: "€15,800.70",
      value: 15800.7,
      score: 5,
      valueType: "currency",
      context: "Portfolio €15,800.70",
      origin: "heuristic",
    },
    allCandidates: [
      {
        selector: "h3.eg-1gw7oiu",
        text: "€15,800.70",
        value: 15800.7,
        score: 5,
        valueType: "currency",
        context: "Portfolio €15,800.70",
        origin: "heuristic",
      },
      {
        selector: "ai-extracted",
        text: "15800.7",
        value: 15800.7,
        score: 4,
        valueType: "currency",
        context: "AI corroborated duplicate value",
        origin: "gemini",
      },
    ],
    elementsScanned: 1029,
  };
}

function mockSuccessfulSignalExtraction(): void {
  extractSignalFromTabMock.mockImplementation(
    async (...args: unknown[]): Promise<ExtractSignalResult> => {
      const signalKey = args[2] as "portfolio_value" | "free_cash";
      const value = signalKey === "portfolio_value" ? 1000 : 100;
      return {
        value,
        confidence: 0.95,
        candidate: {
          candidateId: `${signalKey}-selector`,
          selector: `.${signalKey}`,
          text: `EUR ${value}`,
          value,
          score: 5,
          valueType: "currency",
          context: `${signalKey} EUR ${value}`,
          origin: "selector",
        },
        elementsScanned: 12,
        allCandidates: [
          {
            candidateId: `${signalKey}-selector`,
            selector: `.${signalKey}`,
            text: `EUR ${value}`,
            value,
            score: 5,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "selector",
          },
        ],
      };
    },
  );
}

describe("runSync debug HTML capture", () => {
  beforeEach(() => {
    demoModeState.enabled = false;
    syncRunState.runId = "run-1";
    vi.clearAllMocks();
    updatePlatformProgressMock.mockImplementation(async (runId: string) => {
      syncRunState.runId = runId;
    });
    getLatestSyncRunMock.mockImplementation(async (): Promise<StoredSyncRun> => ({
      runId: syncRunState.runId,
      state: "running" as const,
      startedAt: "2026-06-17T10:00:00.000Z",
      platformProgress: {
        mintos: "running" as const,
        debitum: "running" as const,
      },
    }));
    decryptMock.mockReset();
    decryptMock
      .mockResolvedValueOnce("user@example.com")
      .mockResolvedValueOnce("super-secret");
    getCredentialsMock.mockResolvedValue({
      platformId: "mintos",
      encryptedUsername: { iv: "iv", ciphertext: "user" },
      encryptedPassword: { iv: "iv", ciphertext: "pass" },
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:00:00.000Z",
    } satisfies StoredCredentials);
    getSelectorProfilesMock.mockResolvedValue([]);
    getNavigationProfileMock.mockResolvedValue(undefined);
    getMetricsHistoryMock.mockResolvedValue([]);
    logExtractionTelemetryMock.mockResolvedValue(undefined);
    runConvergentExtractionMock.mockImplementation(
      async ({
        extract,
      }: {
        extract: () => Promise<{
          portfolio_value: ExtractSignalResult;
          free_cash: ExtractSignalResult;
        }>;
      }) => {
        const result = await extract();
        return {
          portfolio: result.portfolio_value,
          freeCash: result.free_cash,
          pollCount: 1,
          converged: true,
          warnings: [] as string[],
        };
      },
    );
    hasUnsafeDuplicateSignalCandidateMock.mockImplementation(
      (portfolio: ExtractSignalResult, freeCash: ExtractSignalResult) =>
        portfolio.value !== null &&
        freeCash.value !== null &&
        Math.abs(portfolio.value - freeCash.value) <= 0.005 &&
        portfolio.candidate?.origin === "heuristic" &&
        freeCash.candidate?.origin === "heuristic" &&
        portfolio.candidate.selector === freeCash.candidate.selector &&
        portfolio.candidate.text === freeCash.candidate.text &&
        portfolio.candidate.context === freeCash.candidate.context,
    );
    getLoginSelectorProfilesMock.mockResolvedValue([]);
    learnLoginSelectorsMock.mockResolvedValue(undefined);
    markSelectorFailureMock.mockResolvedValue(undefined);
    markLoginSelectorFailuresMock.mockResolvedValue(undefined);
    waitForExtractionChoiceMock.mockClear();
    extractSignalFromTabMock.mockReset();
    extractSignalFromTabMock.mockImplementation(
      async (..._args: unknown[]): Promise<ExtractSignalResult> => ({
        value: null,
        confidence: 0,
        allCandidates: [],
        elementsScanned: 0,
      }),
    );
    getTextTreeFromTabMock.mockReset();
    getTextTreeFromTabMock.mockResolvedValue(null);
    aiExtractSignalFromTextTreeMock.mockReset();
    aiExtractSignalFromTextTreeMock.mockResolvedValue({
      ok: false,
      aiLog: { available: false, reason: "unavailable" },
    });
    runPlatformsMock.mockReset();
    runPlatformsMock.mockImplementation(
      async (
        platforms: PlatformCatalogEntry[],
        runner: (
          platform: PlatformCatalogEntry,
          signal?: AbortSignal,
        ) => Promise<unknown>,
      ) => {
        for (const platform of platforms) {
          await runner(platform, undefined);
        }
      },
    );
    capturePageHtmlMock.mockReset();
    capturePageHtmlMock
      .mockResolvedValueOnce("<html><body>Login HTML</body></html>")
      .mockResolvedValueOnce("<html><body>Dashboard HTML</body></html>");
    sendToTabWithTimeoutMock.mockImplementation(
      async (
        _tabId: number,
        message: { type?: string },
      ): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return {
              waitedMs: 10,
              domStable: true,
              readyState: "complete",
            };
          case "CHECK_LOGIN":
            return {
              loggedIn: true,
              url: "https://example.test/login",
              requires2FA: false,
              requiresCaptcha: false,
            };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    vi.stubGlobal("chrome", {
      tabs: {
        get: vi
          .fn()
          .mockResolvedValue({
            id: 11,
            url: "https://example.test/dashboard",
            status: "complete",
          }),
      },
    });
  });

  it("cancels active platform sync immediately and stops the remaining queue", async () => {
    vi.useFakeTimers();
    let done: Promise<void> | undefined;
    try {
      const { runSync } = await import("../../src/background/sync.js");
      const controller = new AbortController();
      const events: SyncEvent[] = [];
      let syncOutcome: "pending" | "resolved" | "rejected" = "pending";

      waitForTabLoadMock.mockImplementationOnce(
        () => new Promise<undefined>(() => undefined),
      );

      done = runSync(
        "run-cancel",
        [basePlatform, secondPlatform],
        false,
        (event) => {
          events.push(event);
        },
        controller.signal,
      );
      done.then(
        () => {
          syncOutcome = "resolved";
        },
        () => {
          syncOutcome = "rejected";
        },
      );

      await vi.waitFor(() => {
        expect(waitForTabLoadMock).toHaveBeenCalledWith(11, expect.any(Number));
      });

      controller.abort();
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }

      expect(closeTabMock).toHaveBeenCalledWith(11);
      await vi.waitFor(() => {
        expect(syncOutcome).toBe("resolved");
      });
      expect(openTabMock).toHaveBeenCalledTimes(1);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "platform_cancelled",
            platformId: "mintos",
            runId: "run-cancel",
            state: "cancelled",
          }),
          expect.objectContaining({
            type: "platform_cancelled",
            platformId: "debitum",
            runId: "run-cancel",
            state: "cancelled",
          }),
          expect.objectContaining({
            type: "sync_cancelled",
            runId: "run-cancel",
          }),
        ]),
      );
      expect(updatePlatformProgressMock).toHaveBeenCalledWith(
        "run-cancel",
        "debitum",
        "cancelled",
      );
    } finally {
      await vi.runOnlyPendingTimersAsync();
      await done?.catch(() => undefined);
      vi.useRealTimers();
    }
  });

  it("marks a hung platform as timed out, closes the tab, and does not ingest data", async () => {
    vi.useFakeTimers();
    try {
      const { runSync } = await import("../../src/background/sync.js");
      const events: SyncEvent[] = [];
      waitForTabLoadMock.mockImplementationOnce(
        () => new Promise<undefined>(() => undefined),
      );

      const done = runSync("run-platform-timeout", [basePlatform], false, (event) => {
        events.push(event);
      });

      await vi.waitFor(() => {
        expect(waitForTabLoadMock).toHaveBeenCalledWith(11, expect.any(Number));
      });

      await vi.advanceTimersByTimeAsync(4 * 60_000);
      await done;

      expect(updatePlatformProgressMock).toHaveBeenCalledWith(
        "run-platform-timeout",
        "mintos",
        "failed_timeout",
      );
      expect(closeTabMock).toHaveBeenCalledWith(11);
      expect(ingestConnectorResultMock).not.toHaveBeenCalled();
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "platform_error",
          platformId: "mintos",
          state: "failed_timeout",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues the run when only one platform signal is cancelled", async () => {
    let done: Promise<void> | undefined;
    const platformController = new AbortController();
    try {
      const { runSync } = await import("../../src/background/sync.js");
      const events: SyncEvent[] = [];

      decryptMock.mockReset();
      decryptMock.mockResolvedValue("secret");
      waitForTabLoadMock
        .mockImplementationOnce(() => new Promise<undefined>(() => undefined))
        .mockResolvedValue(undefined);
      extractSignalFromTabMock.mockImplementation(
        async (...args: unknown[]): Promise<ExtractSignalResult> => {
          const signalKey = args[2] as "portfolio_value" | "free_cash";
          const value = signalKey === "portfolio_value" ? 1000 : 100;
          return {
            value,
            confidence: 0.95,
            candidate: {
              selector: `.${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "selector",
            },
            elementsScanned: 12,
            allCandidates: [
              {
                selector: `.${signalKey}`,
                text: `EUR ${value}`,
                value,
                score: 5,
                valueType: "currency",
                context: `${signalKey} EUR ${value}`,
                origin: "selector",
              },
              {
                selector: `.heuristic-${signalKey}`,
                text: `EUR ${value}`,
                value,
                score: 4,
                valueType: "currency",
                context: `${signalKey} EUR ${value}`,
                origin: "heuristic",
              },
            ],
          };
        },
      );

      done = runSync(
        "run-platform-cancel",
        [basePlatform, secondPlatform],
        false,
        (event) => {
          events.push(event);
        },
        undefined,
        (platformId) =>
          platformId === "mintos"
            ? platformController.signal
            : new AbortController().signal,
      );

      await vi.waitFor(() => {
        expect(waitForTabLoadMock).toHaveBeenCalledWith(11, expect.any(Number));
      });

      platformController.abort();
      await done;

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "platform_cancelled",
            platformId: "mintos",
            runId: "run-platform-cancel",
          }),
          expect.objectContaining({
            type: "platform_done",
            platformId: "debitum",
            runId: "run-platform-cancel",
          }),
          expect.objectContaining({
            type: "sync_complete",
            runId: "run-platform-cancel",
          }),
        ]),
      );
      expect(events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "sync_cancelled",
            runId: "run-platform-cancel",
          }),
        ]),
      );
    } finally {
      platformController.abort();
      await done?.catch(() => undefined);
    }
  }, 10_000);

  it("lets the runner signal abort an active platform even when a platform signal exists", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const runnerController = new AbortController();
    const platformController = new AbortController();
    let done: Promise<void> | undefined;

    runPlatformsMock.mockImplementationOnce(
      async (
        platforms: PlatformCatalogEntry[],
        runner: (
          platform: PlatformCatalogEntry,
          signal?: AbortSignal,
        ) => Promise<unknown>,
      ) => {
        await runner(platforms[0]!, runnerController.signal);
      },
    );
    waitForTabLoadMock.mockImplementationOnce(
      () => new Promise<undefined>(() => undefined),
    );

    try {
      done = runSync(
        "run-runner-cancel",
        [basePlatform],
        false,
        () => undefined,
        undefined,
        () => platformController.signal,
      );

      await vi.waitFor(() => {
        expect(waitForTabLoadMock).toHaveBeenCalledWith(11, expect.any(Number));
      });

      runnerController.abort();
      await Promise.resolve();
      await Promise.resolve();

      expect(closeTabMock).toHaveBeenCalledWith(11);
    } finally {
      platformController.abort();
      await done?.catch(() => undefined);
    }
  });

  it("captures login HTML in debug mode and includes it on extraction failures", async () => {
    const { runSync } = await import("../../src/background/sync.js");

    const events: SyncEvent[] = [];

    await runSync("run-1", [basePlatform], false, (event) => {
      events.push(event);
    });

    const errorEvent = events.find(
      (event) =>
        event.type === "platform_error" && event.platformId === "mintos",
    );

    expect(capturePageHtmlMock).toHaveBeenCalledTimes(2);
    expect(errorEvent).toEqual(
      expect.objectContaining({
        type: "platform_error",
        platformId: "mintos",
        state: "failed_extract",
        rawLoginHtml: "<html><body>Login HTML</body></html>",
        rawHtml: "<html><body>Dashboard HTML</body></html>",
      }),
    );
  });

  it("fails extraction instead of persisting when required signals share one unsafe heuristic candidate", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const duplicate = duplicateHeuristicResult();
    runConvergentExtractionMock.mockResolvedValueOnce({
      portfolio: duplicate,
      freeCash: duplicate,
      pollCount: 2,
      converged: false,
      warnings: ["duplicate_signal_candidate"] as string[],
    });

    const events: SyncEvent[] = [];
    await runSync("run-duplicate-candidate", [basePlatform], false, (event) => {
      events.push(event);
    });

    expect(ingestConnectorResultMock).not.toHaveBeenCalled();
    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      "run-duplicate-candidate",
      "mintos",
      "failed_extract",
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "platform_error",
        platformId: "mintos",
        runId: "run-duplicate-candidate",
        state: "failed_extract",
        message: "Conflicting extraction candidates",
        rawHtml: "<html><body>Dashboard HTML</body></html>",
      }),
    );
    expect(
      events
        .flatMap((event) => event.debugLogs ?? [])
        .map((entry) => `${entry.step}: ${entry.detail ?? ""}`),
    ).toContainEqual(
      expect.stringContaining("Conflicting extraction candidates"),
    );
  });

  it("cancels the platform when CSS convergence is aborted", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const { CancelledError } = await import(
      "../../src/background/sync/cancellation.js"
    );
    runConvergentExtractionMock.mockRejectedValueOnce(
      new CancelledError("Cancelled during CSS convergence"),
    );

    const events: SyncEvent[] = [];
    await runSync("run-css-convergence-cancel", [basePlatform], false, (event) => {
      events.push(event);
    });

    expect(ingestConnectorResultMock).not.toHaveBeenCalled();
    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      "run-css-convergence-cancel",
      "mintos",
      "cancelled",
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "platform_cancelled",
        platformId: "mintos",
        runId: "run-css-convergence-cancel",
        state: "cancelled",
        rawHtml: "<html><body>Dashboard HTML</body></html>",
      }),
    );
  });

  it("does not persist when the sync run was cancelled before ingest", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    mockSuccessfulSignalExtraction();
    getLatestSyncRunMock.mockResolvedValueOnce({
      runId: "run-cancelled-before-ingest",
      state: "cancelled",
      startedAt: "2026-06-17T10:00:00.000Z",
      platformProgress: { mintos: "cancelled" },
    });

    const events: SyncEvent[] = [];
    await runSync("run-cancelled-before-ingest", [basePlatform], false, (event) => {
      events.push(event);
    });

    expect(ingestConnectorResultMock).not.toHaveBeenCalled();
    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      "run-cancelled-before-ingest",
      "mintos",
      "cancelled",
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "platform_cancelled",
        platformId: "mintos",
        runId: "run-cancelled-before-ingest",
        state: "cancelled",
      }),
    );
  });

  it("reverts a created ingestion batch when cancellation lands during ingest", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    mockSuccessfulSignalExtraction();
    ingestConnectorResultMock.mockResolvedValueOnce({
      batchId: 501,
      createdBatch: true,
      replacedExistingBatch: false,
    });
    getLatestSyncRunMock
      .mockResolvedValueOnce({
        runId: "run-cancelled-during-ingest",
        state: "running",
        startedAt: "2026-06-17T10:00:00.000Z",
        platformProgress: { mintos: "running" },
      })
      .mockResolvedValueOnce({
        runId: "run-cancelled-during-ingest",
        state: "cancelled",
        startedAt: "2026-06-17T10:00:00.000Z",
        platformProgress: { mintos: "cancelled" },
      });

    await runSync("run-cancelled-during-ingest", [basePlatform], false, () => undefined);

    expect(ingestConnectorResultMock).toHaveBeenCalled();
    expect(revertPlatformBatchMock).toHaveBeenCalledWith("mintos", 501);
    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      "run-cancelled-during-ingest",
      "mintos",
      "cancelled",
    );
  });

  it("includes captured HTML in platform_cancelled when user cancels extraction choice", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const { CancelledError } = await import(
      "../../src/background/sync/cancellation.js"
    );
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const value = signalKey === "portfolio_value" ? 1000 : 100;
        return {
          value,
          confidence: 0.55,
          candidate: {
            selector: `.${signalKey}`,
            text: `EUR ${value}`,
            value,
            score: 3.5,
            valueType: "currency",
            context: `${signalKey} candidate`,
            origin: "heuristic",
          },
          elementsScanned: 12,
          allCandidates: [
            {
              selector: `.${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 3.5,
              valueType: "currency",
              context: `${signalKey} candidate`,
              origin: "heuristic",
            },
          ],
        };
      },
    );
    waitForExtractionChoiceMock.mockRejectedValueOnce(
      new CancelledError("Extraction choice cancelled"),
    );

    const events: SyncEvent[] = [];
    await runSync("run-choice-cancel", [basePlatform], false, (event) => {
      events.push(event);
    });

    expect(waitForExtractionChoiceMock).toHaveBeenCalledTimes(1);

    const cancelEvent = events.find(
      (event) =>
        event.type === "platform_cancelled" && event.platformId === "mintos",
    );

    expect(cancelEvent).toEqual(
      expect.objectContaining({
        type: "platform_cancelled",
        platformId: "mintos",
        runId: "run-choice-cancel",
        state: "cancelled",
        rawLoginHtml: "<html><body>Login HTML</body></html>",
        rawHtml: "<html><body>Dashboard HTML</body></html>",
      }),
    );

    expect(cancelEvent?.debug).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signalKey: "portfolio_value",
          candidates: expect.arrayContaining([
            expect.objectContaining({
              selector: ".portfolio_value",
              value: 1000,
            }),
          ]),
        }),
        expect.objectContaining({
          signalKey: "free_cash",
          candidates: expect.arrayContaining([
            expect.objectContaining({
              selector: ".free_cash",
              value: 100,
            }),
          ]),
        }),
      ]),
    );
    expect(cancelEvent?.debug).toHaveLength(2);
  });

  it("classifies extraction choice timeout as extraction failure", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        return {
          value: signalKey === "portfolio_value" ? 1000 : 100,
          confidence: 0.55,
          candidate: {
            selector: `.${signalKey}`,
            text: "EUR 1000",
            value: signalKey === "portfolio_value" ? 1000 : 100,
            score: 3.5,
            valueType: "currency",
            context: `${signalKey} candidate`,
            origin: "heuristic",
          },
          elementsScanned: 12,
          allCandidates: [
            {
              selector: `.${signalKey}`,
              text: "EUR 1000",
              value: signalKey === "portfolio_value" ? 1000 : 100,
              score: 3.5,
              valueType: "currency",
              context: `${signalKey} candidate`,
              origin: "heuristic",
            },
          ],
        };
      },
    );
    waitForExtractionChoiceMock.mockRejectedValueOnce(
      new Error("Extraction choice timeout"),
    );

    const events: SyncEvent[] = [];
    await runSync("run-choice-timeout", [basePlatform], false, (event) => {
      events.push(event);
    });

    expect(updatePlatformProgressMock).toHaveBeenCalledWith(
      "run-choice-timeout",
      "mintos",
      "failed_extract",
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "platform_error",
        platformId: "mintos",
        runId: "run-choice-timeout",
        state: "failed_extract",
        message: "Extraction choice timeout",
      }),
    );
  });

  it("skips manual extraction choice in demo mode and persists the best CSS candidates", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    demoModeState.enabled = true;
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const value = signalKey === "portfolio_value" ? 4200 : 215;
        return {
          value,
          confidence: 0.68,
          candidate: {
            selector: `.${signalKey}`,
            text: `EUR ${value}`,
            value,
            score: 4.8,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "heuristic",
          },
          elementsScanned: 12,
          allCandidates: [
            {
              selector: `.${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 4.8,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "heuristic",
            },
          ],
        };
      },
    );

    const events: SyncEvent[] = [];
    await runSync("run-demo-css-fallback", [basePlatform], false, (event) => {
      events.push(event);
    });

    expect(waitForExtractionChoiceMock).not.toHaveBeenCalled();
    expect(ingestConnectorResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        overviewMetrics: expect.objectContaining({
          platformValue: 4200,
          freeCash: 215,
        }),
      }),
      expect.objectContaining({ runId: "run-demo-css-fallback" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "platform_done",
        platformId: "mintos",
        runId: "run-demo-css-fallback",
      }),
    );
  });

  it("attaches failed AI diagnostics to debug signals", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    demoModeState.enabled = true;
    getTextTreeFromTabMock.mockResolvedValueOnce(
      fetchedTree('["Dashboard",["Portfolio Value","€1,000.00"],["Free Cash","€100.00"]]'),
    );
    aiExtractSignalFromTextTreeMock.mockResolvedValue({
      ok: false,
      aiLog: {
        available: true,
        error: "missing_value_field",
        rawResponse: "{\"currency\":\"EUR\"}",
        durationMs: 42,
        estimatedTokens: 123,
      },
    });
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const value = signalKey === "portfolio_value" ? 1000 : 100;
        return {
          value,
          confidence: 0.68,
          candidate: {
            selector: `.${signalKey}`,
            text: `EUR ${value}`,
            value,
            score: 4.8,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "heuristic",
          },
          elementsScanned: 12,
          allCandidates: [
            {
              selector: `.${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 4.8,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "heuristic",
            },
          ],
        };
      },
    );

    const events: SyncEvent[] = [];
    await runSync("run-ai-diagnostics", [basePlatform], false, (event) => {
      events.push(event);
    });

    const doneEvent = events.find(
      (event) => event.type === "platform_done" && event.platformId === "mintos",
    );
    expect(doneEvent?.debug?.[0]?.aiLog).toEqual(
      expect.objectContaining({
        available: true,
        error: "missing_value_field",
        rawResponse: "{\"currency\":\"EUR\"}",
        durationMs: 42,
        estimatedTokens: 123,
      }),
    );
    expect(
      events
        .flatMap((event) => event.debugLogs ?? [])
        .map((entry) => `${entry.step}: ${entry.detail ?? ""}`),
    ).toContainEqual(
      expect.stringContaining("No result from AI: missing_value_field"),
    );
  });

  it("skips Gemini when selector evidence auto-selects", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    getTextTreeFromTabMock.mockResolvedValueOnce(
      fetchedTree('["Dashboard",["Portfolio Value","€1,000.00"],["Free Cash","€100.00"]]'),
    );
    aiExtractSignalFromTextTreeMock.mockImplementation(
      async (...args: unknown[]): Promise<AiTextTreeExtractionResult> => {
        const signalKey = args[1] as "portfolio_value" | "free_cash";
        return {
          ok: true,
          value: signalKey === "portfolio_value" ? 1500 : 100,
          currency: "EUR",
          aiLog: { available: true },
        };
      },
    );
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const value = signalKey === "portfolio_value" ? 1000 : 100;
        return {
          value,
          confidence: 0.9,
          candidate: {
            selector: `.${signalKey}`,
            text: `EUR ${value}`,
            value,
            score: 5,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "selector",
          },
          elementsScanned: 12,
          allCandidates: [
            {
              selector: `.${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "selector",
            },
            {
              selector: `.heuristic-${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 4.5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "heuristic",
            },
          ],
        };
      },
    );

    await runSync("run-gemini-warning", [basePlatform], false, () => undefined);

    expect(waitForExtractionChoiceMock).not.toHaveBeenCalled();
    expect(getTextTreeFromTabMock).not.toHaveBeenCalled();
    expect(aiExtractSignalFromTextTreeMock).not.toHaveBeenCalled();
    expect(ingestConnectorResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        overviewMetrics: expect.objectContaining({
          platformValue: 1000,
          freeCash: 100,
        }),
      }),
      expect.objectContaining({ runId: "run-gemini-warning" }),
    );
    expect(logExtractionTelemetryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-gemini-warning",
        signalKey: "portfolio_value",
        stage: "final",
        warnings: [],
      }),
    );
  });

  it("enables safe mode after a real login failure while preserving encrypted blobs", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const stored: StoredCredentials = {
      platformId: "mintos",
      encryptedUsername: { iv: "iv", ciphertext: "user" },
      encryptedPassword: { iv: "iv", ciphertext: "pass" },
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:00:00.000Z",
      safeModeEnabled: false,
      stealthModeEnabled: false,
    };
    getCredentialsMock.mockResolvedValue(stored);
    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return {
              waitedMs: 10,
              domStable: true,
              readyState: "complete",
            };
          case "CHECK_LOGIN":
            return {
              loggedIn: false,
              url: "https://example.test/login",
              requires2FA: false,
              requiresCaptcha: false,
            };
          case "LOGIN":
            return {
              success: false,
              submitted: false,
              error: "Invalid credentials",
            };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    await runSync("run-login-failed", [basePlatform], false, () => undefined);

    expect(saveCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        encryptedUsername: stored.encryptedUsername,
        encryptedPassword: stored.encryptedPassword,
        safeModeEnabled: true,
        stealthModeEnabled: false,
        consecutiveLoginFailureCount: 1,
        lastLoginError: "Invalid credentials",
      }),
    );
  });

  it("enables safe mode on the latest credential snapshot after a login failure", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const staleSnapshot: StoredCredentials = {
      platformId: "mintos",
      encryptedUsername: { iv: "old-iv", ciphertext: "old-user" },
      encryptedPassword: { iv: "old-iv", ciphertext: "old-pass" },
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:00:00.000Z",
      safeModeEnabled: false,
      stealthModeEnabled: false,
    };
    const latestSnapshot: StoredCredentials = {
      platformId: "mintos",
      encryptedUsername: { iv: "new-iv", ciphertext: "new-user" },
      encryptedPassword: { iv: "new-iv", ciphertext: "new-pass" },
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:30:00.000Z",
      safeModeEnabled: false,
      stealthModeEnabled: true,
    };
    getCredentialsMock.mockResolvedValue(latestSnapshot);
    getCredentialsMock.mockResolvedValueOnce(staleSnapshot);
    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return {
              waitedMs: 10,
              domStable: true,
              readyState: "complete",
            };
          case "CHECK_LOGIN":
            return {
              loggedIn: false,
              url: "https://example.test/login",
              requires2FA: false,
              requiresCaptcha: false,
            };
          case "LOGIN":
            return {
              success: false,
              submitted: false,
              error: "Invalid credentials",
            };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    await runSync("run-login-failed-fresh-safe-mode", [basePlatform], false, () => undefined);

    expect(saveCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        encryptedUsername: latestSnapshot.encryptedUsername,
        encryptedPassword: latestSnapshot.encryptedPassword,
        safeModeEnabled: true,
        stealthModeEnabled: true,
      }),
    );
    expect(saveCredentialsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        encryptedUsername: staleSnapshot.encryptedUsername,
        encryptedPassword: staleSnapshot.encryptedPassword,
      }),
    );
  });

  it("uses doubled page-load waits when stored safe mode is enabled", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const stored: StoredCredentials = {
      platformId: "mintos",
      encryptedUsername: { iv: "iv", ciphertext: "user" },
      encryptedPassword: { iv: "iv", ciphertext: "pass" },
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:00:00.000Z",
      safeModeEnabled: true,
    };
    getCredentialsMock.mockResolvedValue(stored);

    await runSync("run-safe-mode-timeouts", [basePlatform], false, () => undefined);

    expect(waitForTabLoadMock).toHaveBeenCalledWith(11, 30_000);
  });

  it("keeps stored safe mode enabled when extraction fails after login", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const stored: StoredCredentials = {
      platformId: "mintos",
      encryptedUsername: { iv: "iv", ciphertext: "user" },
      encryptedPassword: { iv: "iv", ciphertext: "pass" },
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:00:00.000Z",
      safeModeEnabled: true,
    };
    getCredentialsMock.mockResolvedValue(stored);

    await runSync("run-safe-mode-extract-failed", [basePlatform], false, () => undefined);

    expect(saveCredentialsMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        safeModeEnabled: false,
      }),
    );
  });

  it("disables stored safe mode after successful data extraction and persistence", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const stored: StoredCredentials = {
      platformId: "mintos",
      encryptedUsername: { iv: "iv", ciphertext: "user" },
      encryptedPassword: { iv: "iv", ciphertext: "pass" },
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:00:00.000Z",
      safeModeEnabled: true,
      stealthModeEnabled: true,
      consecutiveLoginFailureCount: 1,
      lastLoginError: "Previous login failure",
    };
    getCredentialsMock.mockResolvedValue(stored);
    mockSuccessfulSignalExtraction();
    getTextTreeFromTabMock.mockResolvedValue(
      fetchedTree('["Dashboard",["Portfolio Value","EUR 1000"],["Free Cash","EUR 100"]]'),
    );
    aiExtractSignalFromTextTreeMock.mockImplementation(
      async (...args: unknown[]): Promise<AiTextTreeExtractionResult> => {
        const signalKey = args[1] as "portfolio_value" | "free_cash";
        return {
          ok: true,
          value: signalKey === "portfolio_value" ? 1000 : 100,
          currency: "EUR",
          aiLog: { available: true },
        };
      },
    );

    await runSync("run-safe-mode-success", [basePlatform], false, () => undefined);

    expect(
      saveCredentialsMock.mock.calls.some(([credentials]) => {
        const saved = credentials as StoredCredentials;
        return (
          saved.consecutiveLoginFailureCount === 1 &&
          saved.lastLoginError === undefined
        );
      }),
    ).toBe(true);

    expect(ingestConnectorResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        overviewMetrics: expect.objectContaining({
          platformValue: 1000,
          freeCash: 100,
        }),
      }),
      expect.objectContaining({ runId: "run-safe-mode-success" }),
    );

    expect(saveCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        encryptedUsername: stored.encryptedUsername,
        encryptedPassword: stored.encryptedPassword,
        stealthModeEnabled: true,
        consecutiveLoginFailureCount: 0,
      }),
    );
    expect(saveCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        safeModeEnabled: false,
        stealthModeEnabled: true,
      }),
    );
  });

  it("does not fail a successful sync when safe mode disable persistence fails", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const stored: StoredCredentials = {
      platformId: "mintos",
      encryptedUsername: { iv: "iv", ciphertext: "user" },
      encryptedPassword: { iv: "iv", ciphertext: "pass" },
      createdAt: "2026-05-25T10:00:00.000Z",
      updatedAt: "2026-05-25T10:00:00.000Z",
      safeModeEnabled: true,
    };
    const events: SyncEvent[] = [];
    getCredentialsMock.mockResolvedValue(stored);
    mockSuccessfulSignalExtraction();
    getTextTreeFromTabMock.mockResolvedValue(
      fetchedTree('["Dashboard",["Portfolio Value","EUR 1000"],["Free Cash","EUR 100"]]'),
    );
    aiExtractSignalFromTextTreeMock.mockImplementation(
      async (...args: unknown[]): Promise<AiTextTreeExtractionResult> => {
        const signalKey = args[1] as "portfolio_value" | "free_cash";
        return {
          ok: true,
          value: signalKey === "portfolio_value" ? 1000 : 100,
          currency: "EUR",
          aiLog: { available: true },
        };
      },
    );
    saveCredentialsMock.mockRejectedValueOnce(
      new Error("IndexedDB write failed"),
    );

    await runSync("run-safe-mode-disable-failed", [basePlatform], false, (event) => {
      events.push(event);
    });

    expect(ingestConnectorResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        overviewMetrics: expect.objectContaining({
          platformValue: 1000,
          freeCash: 100,
        }),
      }),
      expect.objectContaining({ runId: "run-safe-mode-disable-failed" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "platform_done",
        platformId: "mintos",
        runId: "run-safe-mode-disable-failed",
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "platform_error",
        platformId: "mintos",
        runId: "run-safe-mode-disable-failed",
      }),
    );
  });

  it("uses stored selector fast-path before default extraction or Gemini", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    getSelectorProfilesMock.mockResolvedValue([
      {
        platformId: "mintos",
        signalKey: "portfolio_value",
        selector: ".stored-portfolio",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
      {
        platformId: "mintos",
        signalKey: "free_cash",
        selector: ".stored-cash",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
    ]);
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const options = args[3] as { selectorOnly?: boolean; selectors?: string[] };
        if (!options.selectorOnly) {
          throw new Error(`Unexpected full extraction for ${signalKey}`);
        }
        const value = signalKey === "portfolio_value" ? 7565.29 : 47;
        const selector = options.selectors?.[0] ?? ".missing";
        return {
          value,
          confidence: 0.95,
          candidate: {
            selector,
            text: `EUR ${value}`,
            value,
            score: 5,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "selector",
          },
          elementsScanned: 0,
          allCandidates: [
            {
              selector,
              text: `EUR ${value}`,
              value,
              score: 5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "selector",
            },
          ],
        };
      },
    );

    await runSync("run-stored-fast-path", [basePlatform], false, () => undefined);

    expect(extractSignalFromTabMock).toHaveBeenCalledTimes(2);
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      1,
      11,
      basePlatform,
      "portfolio_value",
      expect.objectContaining({
        selectorOnly: true,
        selectors: [".stored-portfolio"],
      }),
    );
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      2,
      11,
      basePlatform,
      "free_cash",
      expect.objectContaining({
        selectorOnly: true,
        selectors: [".stored-cash"],
      }),
    );
    expect(getTextTreeFromTabMock).not.toHaveBeenCalled();
    expect(aiExtractSignalFromTextTreeMock).not.toHaveBeenCalled();
    expect(markSelectorFailureMock).not.toHaveBeenCalled();
    expect(ingestConnectorResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        overviewMetrics: expect.objectContaining({
          platformValue: 7565.29,
          freeCash: 47,
        }),
      }),
      expect.objectContaining({
        runId: "run-stored-fast-path",
        sourceKind: "sync",
      }),
    );
  });

  it("uses one fresh extraction per convergence poll", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    mockSuccessfulSignalExtraction();
    runConvergentExtractionMock.mockImplementationOnce(
      async ({
        extract,
      }: {
        extract: () => Promise<{
          portfolio_value: ExtractSignalResult;
          free_cash: ExtractSignalResult;
        }>;
      }) => {
        await extract();
        const second = await extract();
        return {
          portfolio: second.portfolio_value,
          freeCash: second.free_cash,
          pollCount: 2,
          converged: true,
          warnings: [] as string[],
        };
      },
    );

    await runSync("run-fresh-per-poll", [basePlatform], false, () => undefined);

    const freshFlags = extractSignalFromTabMock.mock.calls.map(
      (call) => (call[3] as { fresh?: boolean } | undefined)?.fresh ?? false,
    );
    expect(freshFlags).toEqual([true, false, true, false]);
  });

  it("reuses the fast-path fresh snapshot for fallback extraction", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    getSelectorProfilesMock.mockResolvedValue([
      {
        platformId: "mintos",
        signalKey: "portfolio_value",
        selector: ".stored-portfolio",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
    ]);
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const options = args[3] as { selectorOnly?: boolean; selectors?: string[] };
        if (options.selectorOnly) {
          return {
            value: null,
            confidence: 0,
            elementsScanned: 0,
            allCandidates: [],
          };
        }
        const value = signalKey === "portfolio_value" ? 1000 : 100;
        return {
          value,
          confidence: 0.95,
          candidate: {
            selector: `.${signalKey}`,
            text: `EUR ${value}`,
            value,
            score: 5,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "selector",
          },
          elementsScanned: 12,
          allCandidates: [
            {
              selector: `.${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "selector",
            },
          ],
        };
      },
    );

    await runSync("run-fast-path-fallback-fresh", [basePlatform], false, () => undefined);

    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      1,
      11,
      basePlatform,
      "portfolio_value",
      expect.objectContaining({
        fresh: true,
        selectorOnly: true,
        selectors: [".stored-portfolio"],
      }),
    );
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      2,
      11,
      basePlatform,
      "portfolio_value",
      expect.not.objectContaining({ fresh: true }),
    );
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      3,
      11,
      basePlatform,
      "free_cash",
      expect.not.objectContaining({ fresh: true }),
    );
  });

  it("falls back to a fresh full extraction when the fast-path request fails", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    getSelectorProfilesMock.mockResolvedValue([
      {
        platformId: "mintos",
        signalKey: "portfolio_value",
        selector: ".stored-portfolio",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
    ]);
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const options = args[3] as { selectorOnly?: boolean };
        if (options.selectorOnly) {
          throw new Error("fast-path message timeout");
        }
        const value = signalKey === "portfolio_value" ? 1000 : 100;
        return {
          value,
          confidence: 0.95,
          candidate: {
            selector: `.${signalKey}`,
            text: `EUR ${value}`,
            value,
            score: 5,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "selector",
          },
          elementsScanned: 12,
          allCandidates: [
            {
              selector: `.${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "selector",
            },
          ],
        };
      },
    );

    await runSync("run-fast-path-transport-failure", [basePlatform], false, () => undefined);

    expect(markSelectorFailureMock).toHaveBeenCalledWith(
      "mintos",
      "portfolio_value",
    );
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      1,
      11,
      basePlatform,
      "portfolio_value",
      expect.objectContaining({
        fresh: true,
        selectorOnly: true,
        selectors: [".stored-portfolio"],
      }),
    );
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      2,
      11,
      basePlatform,
      "portfolio_value",
      expect.objectContaining({ fresh: true }),
    );
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      3,
      11,
      basePlatform,
      "free_cash",
      expect.not.objectContaining({ fresh: true }),
    );
  });

  it("forces manual choices with all candidates and skips stored fast-path auto-selection", async () => {
    demoModeState.enabled = true;
    const { runSync } = await import("../../src/background/sync.js");
    getSelectorProfilesMock.mockResolvedValue([
      {
        platformId: "mintos",
        signalKey: "portfolio_value",
        selector: ".stored-portfolio",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
      {
        platformId: "mintos",
        signalKey: "free_cash",
        selector: ".stored-cash",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
    ]);
    waitForExtractionChoiceMock
      .mockResolvedValueOnce("portfolio-choice-6")
      .mockResolvedValueOnce("cash-choice-6");
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const baseValue = signalKey === "portfolio_value" ? 1000 : 100;
        const candidatePrefix =
          signalKey === "portfolio_value" ? "portfolio" : "cash";
        const allCandidates = Array.from({ length: 6 }, (_, index) => ({
          candidateId: `${candidatePrefix}-choice-${index + 1}`,
          selector: `.${candidatePrefix}-${index + 1}`,
          text: `EUR ${baseValue + index}`,
          value: baseValue + index,
          score: 6 - index / 10,
          valueType: "currency" as const,
          context: `${signalKey} candidate ${index + 1}`,
          origin: index % 2 === 0 ? ("selector" as const) : ("heuristic" as const),
        }));
        return {
          value: baseValue,
          confidence: 0.95,
          candidate: allCandidates[0]!,
          elementsScanned: 12,
          allCandidates,
        };
      },
    );

    await runSync(
      "run-forced-choice",
      [basePlatform],
      false,
      () => undefined,
      undefined,
      undefined,
      undefined,
      () => ["portfolio_value", "free_cash"],
    );

    expect(
      extractSignalFromTabMock.mock.calls.some(
        (call) => (call[3] as { selectorOnly?: boolean } | undefined)?.selectorOnly,
      ),
    ).toBe(false);
    expect(waitForExtractionChoiceMock).toHaveBeenCalledTimes(2);
    expect(waitForExtractionChoiceMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        signalKey: "portfolio_value",
        candidates: expect.arrayContaining([
          expect.objectContaining({ candidateId: "portfolio-choice-6" }),
        ]),
      }),
    );
    expect(
      (waitForExtractionChoiceMock.mock.calls[0]?.[0] as {
        candidates?: unknown[];
      }).candidates,
    ).toHaveLength(6);
    expect(waitForExtractionChoiceMock.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        signalKey: "free_cash",
        candidates: expect.arrayContaining([
          expect.objectContaining({ candidateId: "cash-choice-6" }),
        ]),
      }),
    );
    expect(
      (waitForExtractionChoiceMock.mock.calls[1]?.[0] as {
        candidates?: unknown[];
      }).candidates,
    ).toHaveLength(6);
    expect(getTextTreeFromTabMock).not.toHaveBeenCalled();
    expect(aiExtractSignalFromTextTreeMock).not.toHaveBeenCalled();
    expect(learnSelectorMock).toHaveBeenCalledTimes(2);
    expect(learnSelectorMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        platformId: "mintos",
        signalKey: "portfolio_value",
        selector: ".portfolio-6",
        source: "user",
      }),
    );
    expect(learnSelectorMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        platformId: "mintos",
        signalKey: "free_cash",
        selector: ".cash-6",
        source: "user",
      }),
    );
    expect(ingestConnectorResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        overviewMetrics: expect.objectContaining({
          platformValue: 1005,
          freeCash: 105,
        }),
      }),
      expect.objectContaining({
        runId: "run-forced-choice",
        sourceKind: "sync",
      }),
    );
  });

  it("skips low-confidence auto-learned selector fast-path", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    getSelectorProfilesMock.mockResolvedValue([
      {
        platformId: "mintos",
        signalKey: "portfolio_value",
        selector: ".auto-portfolio",
        confidence: 0.9,
        source: "auto",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
      {
        platformId: "mintos",
        signalKey: "free_cash",
        selector: ".stored-cash",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
    ]);
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const options = args[3] as { selectorOnly?: boolean; selectors?: string[] };
        const value = signalKey === "portfolio_value" ? 1000 : 100;
        const selector = options.selectorOnly
          ? (options.selectors?.[0] ?? ".missing")
          : `.${signalKey}`;
        return {
          value,
          confidence: 0.95,
          candidate: {
            selector,
            text: `EUR ${value}`,
            value,
            score: 5,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "selector",
          },
          elementsScanned: options.selectorOnly ? 0 : 12,
          allCandidates: [
            {
              selector,
              text: `EUR ${value}`,
              value,
              score: 5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "selector",
            },
            ...(options.selectorOnly
              ? []
              : [
                  {
                    selector: `.heuristic-${signalKey}`,
                    text: `EUR ${value}`,
                    value,
                    score: 4,
                    valueType: "currency" as const,
                    context: `${signalKey} EUR ${value}`,
                    origin: "heuristic" as const,
                  },
                ]),
          ],
        };
      },
    );

    await runSync("run-low-auto-selector", [basePlatform], false, () => undefined);

    expect(extractSignalFromTabMock).not.toHaveBeenCalledWith(
      11,
      basePlatform,
      "portfolio_value",
      expect.objectContaining({
        selectorOnly: true,
        selectors: [".auto-portfolio"],
      }),
    );
    expect(extractSignalFromTabMock).toHaveBeenCalledWith(
      11,
      basePlatform,
      "portfolio_value",
      { fresh: true },
    );
    expect(extractSignalFromTabMock).toHaveBeenCalledWith(
      11,
      basePlatform,
      "free_cash",
      expect.objectContaining({
        selectorOnly: true,
        selectors: [".stored-cash"],
      }),
    );
  });

  it("re-reads stored selector fast-path after placeholder reload", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const reloadMock = vi.fn(async () => undefined);
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi.fn().mockResolvedValue({
          id: 11,
          url: "https://example.test/dashboard",
          status: "complete",
        }),
        reload: reloadMock,
      },
    });
    getMetricsHistoryMock.mockResolvedValue([
      {
        platformId: "mintos",
        date: "2026-06-15",
        platformValue: 1000,
        freeCash: 100,
        fetchedAt: "2026-06-15T10:00:00.000Z",
      },
    ]);
    getSelectorProfilesMock.mockResolvedValue([
      {
        platformId: "mintos",
        signalKey: "portfolio_value",
        selector: ".stored-portfolio",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
      {
        platformId: "mintos",
        signalKey: "free_cash",
        selector: ".stored-cash",
        confidence: 1,
        source: "user",
        learnedAt: "2026-06-01T10:00:00.000Z",
        lastVerifiedAt: "2026-06-01T10:00:00.000Z",
        failureCount: 0,
      },
    ]);
    runConvergentExtractionMock
      .mockImplementationOnce(
        async ({
          extract,
        }: {
          extract: () => Promise<{
            portfolio_value: ExtractSignalResult;
            free_cash: ExtractSignalResult;
          }>;
        }) => {
          const first = await extract();
          return {
            portfolio: first.portfolio_value,
            freeCash: first.free_cash,
            pollCount: 1,
            converged: false,
            warnings: ["placeholder_zero"],
          };
        },
      )
      .mockImplementationOnce(
        async ({
          extract,
        }: {
          extract: () => Promise<{
            portfolio_value: ExtractSignalResult;
            free_cash: ExtractSignalResult;
          }>;
        }) => {
          const second = await extract();
          return {
            portfolio: second.portfolio_value,
            freeCash: second.free_cash,
            pollCount: 1,
            converged: true,
            warnings: [] as string[],
          };
        },
      );

    let portfolioStoredCalls = 0;
    let cashStoredCalls = 0;
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]): Promise<ExtractSignalResult> => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const options = args[3] as { selectorOnly?: boolean; selectors?: string[] };
        if (!options.selectorOnly) {
          throw new Error(`Unexpected full extraction for ${signalKey}`);
        }
        const selector = options.selectors?.[0] ?? ".missing";
        const callCount =
          signalKey === "portfolio_value"
            ? ++portfolioStoredCalls
            : ++cashStoredCalls;
        const value =
          callCount === 1 ? 0 : signalKey === "portfolio_value" ? 1000 : 100;
        return {
          value,
          confidence: 0.95,
          candidate: {
            selector,
            text: `EUR ${value}`,
            value,
            score: 5,
            valueType: "currency",
            context: `${signalKey} EUR ${value}`,
            origin: "selector",
          },
          elementsScanned: 0,
          allCandidates: [
            {
              selector,
              text: `EUR ${value}`,
              value,
              score: 5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "selector",
            },
          ],
        };
      },
    );

    await runSync("run-stored-placeholder-reload", [basePlatform], false, () => undefined);

    expect(reloadMock).toHaveBeenCalledWith(11);
    expect(portfolioStoredCalls).toBe(2);
    expect(cashStoredCalls).toBe(2);
    expect(ingestConnectorResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        overviewMetrics: expect.objectContaining({
          platformValue: 1000,
          freeCash: 100,
        }),
      }),
      expect.objectContaining({
        runId: "run-stored-placeholder-reload",
        sourceKind: "sync",
      }),
    );
  });

  it("escalates dashboard navigation strategies until extraction finds values", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const getTabMock = vi
      .fn()
      .mockResolvedValueOnce({
        id: 11,
        url: "https://example.test/transfer",
        status: "complete",
      })
      .mockResolvedValueOnce({
        id: 11,
        url: "https://example.test/transfer",
        status: "complete",
      })
      .mockResolvedValueOnce({
        id: 11,
        url: "https://example.test/",
        status: "complete",
      })
      .mockResolvedValue({
        id: 11,
        url: "https://example.test/portfolio",
        status: "complete",
      });
    vi.stubGlobal("chrome", {
      tabs: {
        get: getTabMock,
      },
    });

    let extractionAttempt = 0;
    runConvergentExtractionMock.mockImplementation(async () => {
      extractionAttempt += 1;
      // Only the fourth page carries a labelled portfolio value; the earlier
      // ones have nothing, so the ladder keeps escalating until it lands here.
      const found = extractionAttempt >= 4;
      const candidate = found
        ? {
            selector: ".portfolio",
            text: "€1.000,00",
            value: 1000,
            score: 4.5,
            keywordHits: 1,
            origin: "heuristic" as const,
          }
        : undefined;
      return {
        portfolio: {
          value: found ? 1000 : null,
          confidence: found ? 0.95 : 0,
          ...(candidate ? { candidate } : {}),
          allCandidates: candidate ? [candidate] : [],
          elementsScanned: 0,
        },
        freeCash: {
          value: found ? 100 : null,
          confidence: found ? 0.95 : 0,
          allCandidates: [],
          elementsScanned: 0,
        },
        pollCount: 1,
        converged: true,
        warnings: [] as string[],
      };
    });

    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return {
              waitedMs: 10,
              domStable: true,
              readyState: "complete",
            };
          case "CHECK_LOGIN":
            return {
              loggedIn: true,
              url: "https://example.test/transfer",
              requires2FA: false,
              requiresCaptcha: false,
            };
          case "CLICK_DASHBOARD_LINK":
            return {
              success: true,
              clicked: true,
              href: "https://example.test/next",
              navigationKind: "click",
            };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    await runSync("run-dashboard-nav-escalation", [basePlatform], false, () => undefined);

    const clickMessages = sendToTabWithTimeoutMock.mock.calls
      .map(([, message]) => message as { type?: string; payload?: unknown })
      .filter((message) => message.type === "CLICK_DASHBOARD_LINK");
    expect(clickMessages).toHaveLength(3);
    // "keywords" runs twice: the growing excludeHrefs list makes the second run
    // pick the next-best keyword link rather than repeating the first.
    expect(clickMessages.map((message) => message.payload)).toEqual([
      {
        strategy: "keywords",
        excludeHrefs: ["https://example.test/transfer"],
      },
      {
        strategy: "keywords",
        excludeHrefs: [
          "https://example.test/transfer",
          "https://example.test/next",
          "https://example.test/",
        ],
      },
      {
        strategy: "logo",
        excludeHrefs: [
          "https://example.test/transfer",
          "https://example.test/next",
          "https://example.test/",
          "https://example.test/portfolio",
        ],
      },
    ]);
    expect(extractionAttempt).toBe(4);
  }, 12_000);

  it("navigates into the authenticated area instead of logging in when the session is still alive", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi
          .fn()
          .mockResolvedValueOnce({
            id: 11,
            url: "https://example.test/en/login",
            status: "complete",
          })
          .mockResolvedValue({
            id: 11,
            url: "https://example.test/overview",
            status: "complete",
          }),
      },
    });

    // Extraction succeeds with a labelled candidate, so the (separate)
    // extraction-time dashboard-link fallback never runs and the only click
    // comes from session recovery.
    runConvergentExtractionMock.mockResolvedValue({
      portfolio: {
        value: 1000,
        confidence: 0.95,
        candidate: wellEvidencedCandidate,
        allCandidates: [wellEvidencedCandidate],
        elementsScanned: 0,
      },
      freeCash: {
        value: 100,
        confidence: 0.95,
        allCandidates: [],
        elementsScanned: 0,
      },
      pollCount: 1,
      converged: true,
      warnings: [] as string[],
    });

    let checkLoginCalls = 0;
    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return { waitedMs: 10, domStable: true, readyState: "complete" };
          case "CHECK_LOGIN": {
            checkLoginCalls += 1;
            // First check: login form rendered, but the header still shows the
            // signed-in session. Second check runs after the recovery click.
            return checkLoginCalls === 1
              ? {
                  loggedIn: false,
                  sessionEvidence: true,
                  url: "https://example.test/en/login",
                  requires2FA: false,
                  requiresCaptcha: false,
                }
              : {
                  loggedIn: true,
                  url: "https://example.test/overview",
                  requires2FA: false,
                  requiresCaptcha: false,
                };
          }
          case "CLICK_DASHBOARD_LINK":
            return {
              success: true,
              clicked: true,
              href: "https://example.test/overview",
              navigationKind: "click",
            };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    await runSync("run-session-recovery", [basePlatform], false, () => undefined);

    const sent = sendToTabWithTimeoutMock.mock.calls.map(
      ([, message]) => message as { type?: string; payload?: unknown },
    );

    expect(sent.filter((message) => message.type === "LOGIN")).toHaveLength(0);

    const clickMessages = sent.filter(
      (message) => message.type === "CLICK_DASHBOARD_LINK",
    );
    expect(clickMessages).toHaveLength(1);
    expect(clickMessages[0]?.payload).toMatchObject({ strategy: "keywords" });
    expect(checkLoginCalls).toBe(2);
  }, 12_000);

  it("still logs in normally when recovery navigation fails to reach an authenticated page", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    vi.stubGlobal("chrome", {
      tabs: {
        get: vi.fn().mockResolvedValue({
          id: 11,
          url: "https://example.test/en/login",
          status: "complete",
        }),
      },
    });

    // Extraction succeeds with a labelled candidate, so every dashboard-link
    // click below comes from the session-recovery ladder rather than the
    // extraction fallback.
    runConvergentExtractionMock.mockResolvedValue({
      portfolio: {
        value: 1000,
        confidence: 0.95,
        candidate: wellEvidencedCandidate,
        allCandidates: [wellEvidencedCandidate],
        elementsScanned: 0,
      },
      freeCash: {
        value: 100,
        confidence: 0.95,
        allCandidates: [],
        elementsScanned: 0,
      },
      pollCount: 1,
      converged: true,
      warnings: [] as string[],
    });

    let checkLoginCalls = 0;
    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return { waitedMs: 10, domStable: true, readyState: "complete" };
          case "CHECK_LOGIN": {
            checkLoginCalls += 1;
            // Recovery never reaches an authenticated page; after LOGIN the
            // verify loop finally succeeds.
            return {
              loggedIn: checkLoginCalls > 4,
              sessionEvidence: checkLoginCalls <= 4,
              url: "https://example.test/en/login",
              requires2FA: false,
              requiresCaptcha: false,
            };
          }
          case "CLICK_DASHBOARD_LINK":
            return { success: true, clicked: true, navigationKind: "click" };
          case "LOGIN":
            return { success: true, submitted: true };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    await runSync(
      "run-session-recovery-fallback",
      [basePlatform],
      false,
      () => undefined,
    );

    const sent = sendToTabWithTimeoutMock.mock.calls.map(
      ([, message]) => message as { type?: string },
    );
    expect(
      sent.filter((message) => message.type === "CLICK_DASHBOARD_LINK").length,
    ).toBe(3);
    expect(sent.filter((message) => message.type === "LOGIN").length).toBe(1);
  }, 12_000);

  describe("learned overview page", () => {
    // The stub tabs live on example.test, so the platform has to claim it for
    // the stored-URL guard to accept them.
    const navPlatform: PlatformCatalogEntry = {
      ...basePlatform,
      domains: ["example.test"],
    };
    const storedProfile: NavigationProfile = {
      platformId: "mintos",
      url: "https://example.test/konto",
      source: "auto",
      confidence: 0.95,
      learnedAt: "2026-06-01T10:00:00.000Z",
      lastVerifiedAt: "2026-06-01T10:00:00.000Z",
      failureCount: 0,
    };

    function stubTabAt(url: string): void {
      vi.stubGlobal("chrome", {
        tabs: {
          get: vi.fn().mockResolvedValue({ id: 11, url, status: "complete" }),
        },
      });
    }

    function resolveExtractionAs(portfolio: { value: number | null }): void {
      const found = portfolio.value !== null;
      runConvergentExtractionMock.mockResolvedValue({
        portfolio: {
          value: portfolio.value,
          confidence: found ? 0.95 : 0,
          ...(found ? { candidate: agreeingCandidatePair[0] } : {}),
          allCandidates: found ? agreeingCandidatePair : [],
          elementsScanned: 0,
        },
        freeCash: {
          value: found ? 100 : null,
          confidence: found ? 0.95 : 0,
          ...(found ? { candidate: agreeingCandidatePair[0] } : {}),
          allCandidates: found ? agreeingCandidatePair : [],
          elementsScanned: 0,
        },
        pollCount: 1,
        converged: true,
        warnings: [] as string[],
      });
    }

    function replyToTab(): void {
      sendToTabWithTimeoutMock.mockImplementation(
        async (_tabId: number, message: { type?: string }): Promise<unknown> => {
          switch (message.type) {
            case "WAIT_FOR_READY":
              return { waitedMs: 10, domStable: true, readyState: "complete" };
            case "CHECK_LOGIN":
              return {
                loggedIn: true,
                url: "https://example.test/konto",
                requires2FA: false,
                requiresCaptcha: false,
              };
            case "CLICK_DASHBOARD_LINK":
              return {
                success: true,
                clicked: true,
                href: "https://example.test/next",
                navigationKind: "click",
              };
            case "LOGIN":
              return { success: true, submitted: true };
            default:
              throw new Error(`Unexpected message type: ${message.type}`);
          }
        },
      );
    }

    it("navigates straight to the stored page and skips the ladder", async () => {
      const { runSync } = await import("../../src/background/sync.js");
      stubTabAt("https://example.test/investments");
      getNavigationProfileMock.mockResolvedValue(storedProfile);
      resolveExtractionAs({ value: 1000 });
      replyToTab();

      await runSync("run-nav-stored", [navPlatform], false, () => undefined);

      expect(navigateTabToUrlMock).toHaveBeenCalledWith(
        11,
        "https://example.test/konto",
        expect.any(Number),
      );
      const clicks = sendToTabWithTimeoutMock.mock.calls.filter(
        ([, message]) =>
          (message as { type?: string }).type === "CLICK_DASHBOARD_LINK",
      );
      expect(clicks).toHaveLength(0);
      expect(markNavigationFailureMock).not.toHaveBeenCalled();
    });

    it("ignores a stored page that no longer belongs to the platform", async () => {
      const { runSync } = await import("../../src/background/sync.js");
      stubTabAt("https://example.test/konto");
      getNavigationProfileMock.mockResolvedValue({
        ...storedProfile,
        url: "https://attacker.test/konto",
      });
      resolveExtractionAs({ value: 1000 });
      replyToTab();

      await runSync("run-nav-foreign", [navPlatform], false, () => undefined);

      expect(navigateTabToUrlMock).not.toHaveBeenCalledWith(
        11,
        "https://attacker.test/konto",
        expect.any(Number),
      );
    });

    it("learns the page a confident extraction came from", async () => {
      const { runSync } = await import("../../src/background/sync.js");
      stubTabAt("https://example.test/konto");
      resolveExtractionAs({ value: 1000 });
      replyToTab();

      await runSync("run-nav-learn", [navPlatform], false, () => undefined);

      expect(learnNavigationProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          platformId: "mintos",
          url: "https://example.test/konto",
          source: "auto",
        }),
      );
    });

    it("retires a stored page that sent us hunting again", async () => {
      const { runSync } = await import("../../src/background/sync.js");
      stubTabAt("https://example.test/stale");
      getNavigationProfileMock.mockResolvedValue(storedProfile);
      // Nothing well-evidenced anywhere, so the ladder runs despite the
      // stored URL having been used.
      resolveExtractionAs({ value: null });
      replyToTab();

      await runSync("run-nav-stale", [navPlatform], false, () => undefined);

      expect(markNavigationFailureMock).toHaveBeenCalledWith("mintos");
    }, 20_000);

    it("counts a stored page that cannot even be loaded as a failure", async () => {
      const { runSync } = await import("../../src/background/sync.js");
      stubTabAt("https://example.test/investments");
      getNavigationProfileMock.mockResolvedValue(storedProfile);
      navigateTabToUrlMock.mockRejectedValueOnce(new Error("Tab load timeout"));
      resolveExtractionAs({ value: 1000 });
      replyToTab();

      await runSync("run-nav-unreachable", [navPlatform], false, () => undefined);

      expect(markNavigationFailureMock).toHaveBeenCalledWith("mintos");
    });

    it("neither reads nor writes a learned page in demo mode", async () => {
      const { runSync } = await import("../../src/background/sync.js");
      demoModeState.enabled = true;
      stubTabAt("https://example.test/konto");
      resolveExtractionAs({ value: 1000 });
      replyToTab();

      await runSync("run-nav-demo", [navPlatform], false, () => undefined);

      expect(getNavigationProfileMock).not.toHaveBeenCalled();
      expect(learnNavigationProfileMock).not.toHaveBeenCalled();
    });
  });

  it("marks stale extraction selector profiles when their fingerprint no longer matches", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    const staleProfile: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: ".portfolio-value",
      fingerprint: "portfolio_value|.portfolio-value|old balance",
      confidence: 1,
      source: "auto",
      learnedAt: "2026-06-01T10:00:00.000Z",
      lastVerifiedAt: "2026-06-01T10:00:00.000Z",
      failureCount: 0,
    };
    getSelectorProfilesMock.mockResolvedValue([staleProfile]);
    extractSignalFromTabMock.mockImplementation(
      async (...args: unknown[]) => {
        const signalKey = args[2] as "portfolio_value" | "free_cash";
        const value = signalKey === "portfolio_value" ? 1000 : 100;
        return {
          value,
          confidence: 0.9,
          elementsScanned: 12,
          allCandidates: [
            {
              candidateId: `${signalKey}-selector`,
              selector: `.${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 5,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "selector",
            },
            {
              candidateId: `${signalKey}-heuristic`,
              selector: `.heuristic-${signalKey}`,
              text: `EUR ${value}`,
              value,
              score: 4,
              valueType: "currency",
              context: `${signalKey} EUR ${value}`,
              origin: "heuristic",
            },
          ],
        };
      },
    );

    await runSync("run-stale-extraction-selector", [basePlatform], false, () => undefined);

    expect(markSelectorFailureMock).toHaveBeenCalledWith(
      "mintos",
      "portfolio_value",
    );
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      1,
      11,
      basePlatform,
      "portfolio_value",
      expect.objectContaining({
        fresh: true,
        selectorOnly: true,
        selectors: [".portfolio-value"],
      }),
    );
    expect(extractSignalFromTabMock).toHaveBeenNthCalledWith(
      2,
      11,
      basePlatform,
      "portfolio_value",
      expect.not.objectContaining({ fresh: true }),
    );
    expect(ingestConnectorResultMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        overviewMetrics: expect.objectContaining({
          platformValue: 1000,
          freeCash: 100,
        }),
      }),
      expect.objectContaining({
        runId: "run-stale-extraction-selector",
        sourceKind: "sync",
      }),
    );
  });

  it(
    "passes active cached login selectors and learns AI selectors after verification",
    async () => {
      const { runSync } = await import("../../src/background/sync.js");
      getLoginSelectorProfilesMock.mockResolvedValue([
        {
          platformId: "mintos",
          fieldRole: "username",
          selector: "#cached-email",
          fingerprint: "username|#cached-email",
          confidence: 1,
          source: "ai",
          learnedAt: "2026-06-08T10:00:00.000Z",
          failureCount: 0,
        },
        {
          platformId: "mintos",
          fieldRole: "password",
          selector: "#cached-password",
          fingerprint: "password|#cached-password",
          confidence: 1,
          source: "ai",
          learnedAt: "2026-06-08T10:00:00.000Z",
          failureCount: 0,
        },
      ]);

      let checkCount = 0;
      sendToTabWithTimeoutMock.mockImplementation(
        async (_tabId: number, message: { type?: string }): Promise<unknown> => {
          switch (message.type) {
            case "WAIT_FOR_READY":
              return {
                waitedMs: 10,
                domStable: true,
                readyState: "complete",
              };
            case "CHECK_LOGIN":
              checkCount += 1;
              return {
                loggedIn: checkCount > 1,
                url: "https://example.test/dashboard",
                requires2FA: false,
                requiresCaptcha: false,
              };
            case "LOGIN":
              return {
                success: false,
                submitted: true,
                learnedLoginSelectors: {
                  username: "#ai-email",
                  password: "#ai-password",
                  submit: "#ai-submit",
                },
                usedLoginSelectorRoles: ["username", "password"],
              };
            default:
              throw new Error(`Unexpected message type: ${message.type}`);
          }
        },
      );

      await runSync("run-learn-login-selectors", [basePlatform], false, () => undefined);

      const loginCall = sendToTabWithTimeoutMock.mock.calls.find(
        ([, message]) => (message as { type?: string }).type === "LOGIN",
      );
      expect(loginCall?.[1]).toEqual(
        expect.objectContaining({
          payload: expect.objectContaining({
            cachedLoginSelectors: {
              username: ["#cached-email"],
              password: ["#cached-password"],
            },
          }),
        }),
      );
      expect(learnLoginSelectorsMock).toHaveBeenCalledWith(
        "mintos",
        expect.arrayContaining([
          expect.objectContaining({
            fieldRole: "username",
            selector: "#ai-email",
            source: "ai",
            failureCount: 0,
          }),
        ]),
      );
      expect(markLoginSelectorFailuresMock).not.toHaveBeenCalled();
    },
    10_000,
  );

  it("marks stale cached login selectors after login failure", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    getLoginSelectorProfilesMock.mockResolvedValue([
      {
        platformId: "mintos",
        fieldRole: "username",
        selector: "#cached-email",
        confidence: 1,
        source: "ai",
        learnedAt: "2026-06-08T10:00:00.000Z",
        failureCount: 0,
      },
    ]);

    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return {
              waitedMs: 10,
              domStable: true,
              readyState: "complete",
            };
          case "CHECK_LOGIN":
            return {
              loggedIn: false,
              url: "https://example.test/login",
              requires2FA: false,
              requiresCaptcha: false,
            };
          case "LOGIN":
            return {
              success: false,
              submitted: false,
              error: "Login form fields not found",
              usedLoginSelectorRoles: ["password"],
              staleLoginSelectorRoles: ["username"],
            };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    await runSync("run-stale-login-selectors", [basePlatform], false, () => undefined);

    expect(markLoginSelectorFailuresMock).toHaveBeenCalledWith("mintos", [
      "username",
    ]);
    expect(learnLoginSelectorsMock).not.toHaveBeenCalled();
  });

  it("does not mark matched cached login selectors after a non-stale login failure", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    getLoginSelectorProfilesMock.mockResolvedValue([
      {
        platformId: "mintos",
        fieldRole: "username",
        selector: "#cached-email",
        confidence: 1,
        source: "ai",
        learnedAt: "2026-06-08T10:00:00.000Z",
        failureCount: 0,
      },
    ]);

    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return {
              waitedMs: 10,
              domStable: true,
              readyState: "complete",
            };
          case "CHECK_LOGIN":
            return {
              loggedIn: false,
              url: "https://example.test/login",
              requires2FA: false,
              requiresCaptcha: false,
            };
          case "LOGIN":
            return {
              success: false,
              submitted: false,
              error: "Invalid credentials",
              usedLoginSelectorRoles: ["username"],
            };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    await runSync("run-invalid-credentials", [basePlatform], false, () => undefined);

    expect(markLoginSelectorFailuresMock).not.toHaveBeenCalled();
  });

  it("treats unexpected LOGIN errors as failed login instead of submitted navigation", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    let checkLoginCalls = 0;
    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return {
              waitedMs: 10,
              domStable: true,
              readyState: "complete",
            };
          case "CHECK_LOGIN":
            checkLoginCalls += 1;
            return {
              loggedIn: false,
              url: "https://example.test/login",
              requires2FA: false,
              requiresCaptcha: false,
            };
          case "LOGIN":
            throw new Error("Unexpected login content failure");
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    const events: SyncEvent[] = [];
    await runSync("run-login-unexpected-error", [basePlatform], false, (event) => {
      events.push(event);
    });

    expect(checkLoginCalls).toBe(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "platform_error",
        platformId: "mintos",
        runId: "run-login-unexpected-error",
        state: "failed_login",
        message: "Unexpected login content failure",
      }),
    );
  });

  it("persists failed-login recovery metadata from the generic login catch", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    getEncryptionKeyMock.mockRejectedValueOnce(new Error("Keystore unavailable"));

    await runSync("run-generic-login-failure", [basePlatform], false, () => undefined);

    expect(saveCredentialsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        safeModeEnabled: true,
        consecutiveLoginFailureCount: 1,
        lastLoginError: "Keystore unavailable",
      }),
    );
  });

  it("does not enable safe mode when manual 2FA action times out", async () => {
    const { runSync } = await import("../../src/background/sync.js");
    waitForManualActionMock.mockResolvedValueOnce(false);
    sendToTabWithTimeoutMock.mockImplementation(
      async (_tabId: number, message: { type?: string }): Promise<unknown> => {
        switch (message.type) {
          case "WAIT_FOR_READY":
            return {
              waitedMs: 10,
              domStable: true,
              readyState: "complete",
            };
          case "CHECK_LOGIN":
            return {
              loggedIn: false,
              url: "https://example.test/login",
              requires2FA: false,
              requiresCaptcha: false,
            };
          case "LOGIN":
            return {
              success: false,
              submitted: false,
              requires2FA: true,
            };
          default:
            throw new Error(`Unexpected message type: ${message.type}`);
        }
      },
    );

    await runSync("run-2fa-timeout", [basePlatform], false, () => undefined);

    expect(saveCredentialsMock).not.toHaveBeenCalled();
  });

  it.each([
    {
      actionName: "2FA",
      challengeResponse: { requires2FA: true },
      deferredState: "failed_2fa" as const,
    },
    {
      actionName: "captcha",
      challengeResponse: { requiresCaptcha: true },
      deferredState: "failed_captcha" as const,
    },
  ])(
    "defers post-submit $actionName detected during the parallel first pass",
    async ({ challengeResponse, deferredState }) => {
      vi.useFakeTimers();
      try {
        const { runSync } = await import("../../src/background/sync.js");
        getSettingsMock.mockResolvedValue({
          debugModeEnabled: true,
          parallelSyncEnabled: true,
        });
        decryptMock.mockReset();
        decryptMock.mockResolvedValue("secret");
        mockSuccessfulSignalExtraction();

        let checkLoginCalls = 0;
        sendToTabWithTimeoutMock.mockImplementation(
          async (_tabId: number, message: { type?: string }): Promise<unknown> => {
            switch (message.type) {
              case "WAIT_FOR_READY":
                return {
                  waitedMs: 10,
                  domStable: true,
                  readyState: "complete",
                };
              case "CHECK_LOGIN":
                checkLoginCalls += 1;
                if (checkLoginCalls === 1) {
                  return {
                    loggedIn: false,
                    url: "https://example.test/login",
                    requires2FA: false,
                    requiresCaptcha: false,
                  };
                }
                if (checkLoginCalls === 2) {
                  return {
                    loggedIn: false,
                    url: "https://example.test/login",
                    requires2FA: false,
                    requiresCaptcha: false,
                    ...challengeResponse,
                  };
                }
                return {
                  loggedIn: true,
                  url: "https://example.test/dashboard",
                  requires2FA: false,
                  requiresCaptcha: false,
                };
              case "LOGIN":
                return {
                  success: false,
                  submitted: true,
                };
              default:
                throw new Error(`Unexpected message type: ${message.type}`);
            }
          },
        );

        const events: SyncEvent[] = [];
        const done = runSync("run-deferred-post-submit", [basePlatform], false, (event) => {
          events.push(event);
        });

        await vi.advanceTimersByTimeAsync(30_000);
        await done;

        expect(updatePlatformProgressMock).toHaveBeenCalledWith(
          "run-deferred-post-submit",
          "mintos",
          deferredState,
        );
        expect(saveCredentialsMock).not.toHaveBeenCalledWith(
          expect.objectContaining({
            platformId: "mintos",
            safeModeEnabled: true,
          }),
        );
        expect(events).not.toContainEqual(
          expect.objectContaining({
            type: "platform_error",
            platformId: "mintos",
            state: "failed_login",
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("does not consume platform or run timeout while waiting for manual 2FA", async () => {
    vi.useFakeTimers();
    try {
      const { runSync } = await import("../../src/background/sync.js");
      let resolveManualAction: ((solved: boolean) => void) | undefined;
      waitForManualActionMock.mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveManualAction = resolve;
          }),
      );
      sendToTabWithTimeoutMock.mockImplementation(
        async (_tabId: number, message: { type?: string }): Promise<unknown> => {
          switch (message.type) {
            case "WAIT_FOR_READY":
              return {
                waitedMs: 10,
                domStable: true,
                readyState: "complete",
              };
            case "CHECK_LOGIN":
              return {
                loggedIn: false,
                url: "https://example.test/login",
                requires2FA: false,
                requiresCaptcha: false,
              };
            case "LOGIN":
              return {
                success: false,
                submitted: false,
                requires2FA: true,
              };
            default:
              throw new Error(`Unexpected message type: ${message.type}`);
          }
        },
      );

      const events: SyncEvent[] = [];
      const done = runSync("run-2fa-long-wait", [basePlatform], false, (event) => {
        events.push(event);
      });

      await vi.advanceTimersByTimeAsync(20_000);
      await vi.waitFor(() => {
        expect(waitForManualActionMock).toHaveBeenCalled();
      });

      await vi.advanceTimersByTimeAsync(8 * 60_000 + 30_000);
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: "platform_error",
          state: "failed_timeout",
        }),
      );

      resolveManualAction?.(true);
      await vi.advanceTimersByTimeAsync(2_500);
      await done;

      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: "platform_error",
          state: "failed_timeout",
        }),
      );
      expect(updatePlatformProgressMock).not.toHaveBeenCalledWith(
        "run-2fa-long-wait",
        "mintos",
        "failed_timeout",
      );
      expect(hideTabWindowMock).toHaveBeenNthCalledWith(1, 11);
      expect(hideTabWindowMock).toHaveBeenNthCalledWith(2, 11);
    } finally {
      vi.useRealTimers();
    }
  });

  it(
    "retries login once after a landing-page login trigger is clicked",
    async () => {
      const { runSync } = await import("../../src/background/sync.js");
      let checkLoginCount = 0;
      let loginCount = 0;
      sendToTabWithTimeoutMock.mockImplementation(
        async (_tabId: number, message: { type?: string }): Promise<unknown> => {
          switch (message.type) {
            case "WAIT_FOR_READY":
              return {
                waitedMs: 10,
                domStable: true,
                readyState: "complete",
              };
            case "CHECK_LOGIN":
              checkLoginCount += 1;
              return {
                loggedIn: checkLoginCount > 1,
                url: checkLoginCount > 1
                  ? "https://example.test/dashboard"
                  : "https://example.test/overview",
                requires2FA: false,
                requiresCaptcha: false,
              };
            case "LOGIN":
              loginCount += 1;
              return loginCount === 1
                ? {
                    success: false,
                    submitted: false,
                    loginTriggerClicked: true,
                    foundElements: {
                      loginTrigger: '<a href="/login">Login</a>',
                    },
                  }
                : {
                    success: false,
                    submitted: true,
                  };
            default:
              throw new Error(`Unexpected message type: ${message.type}`);
          }
        },
      );

      await runSync("run-login-trigger", [basePlatform], false, () => undefined);

      const loginCalls = sendToTabWithTimeoutMock.mock.calls.filter(
        ([, message]) => (message as { type?: string }).type === "LOGIN",
      );
      const progressCalls = updatePlatformProgressMock.mock.calls as unknown as Array<
        [string, string, string]
      >;
      const failedLoginProgress = progressCalls.filter(
        ([runId, platformId, state]) =>
          runId === "run-login-trigger" &&
          platformId === "mintos" &&
          state === "failed_login",
      );
      expect(loginCalls).toHaveLength(2);
      expect(checkLoginCount).toBe(2);
      expect(loginCount).toBe(2);
      expect(failedLoginProgress).toEqual([]);
    },
    10_000,
  );
});
