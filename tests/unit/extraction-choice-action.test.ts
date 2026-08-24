import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPersistedPendingExtractionChoice,
  getPersistedPendingExtractionChoice,
  PENDING_CHOICE_SESSION_KEY,
  resolvePendingExtractionChoice,
  waitForExtractionChoice,
} from "../../src/background/sync/extraction-choice-action.js";
import { CancelledError } from "../../src/background/sync/cancellation.js";
import type { PlatformCatalogEntry } from "../../src/shared/types/index.js";

const platform: PlatformCatalogEntry = {
  id: "mintos",
  name: "Mintos",
  enabled: true,
  strategy: "universal",
  domains: ["mintos.com"],
  login: {
    entryUrl: "https://mintos.com",
    usernameSelectors: [],
    passwordSelectors: [],
    submitSelectors: [],
    otpSelectors: [],
    postLoginIndicators: [],
  },
  dashboard: {
    portfolioValueSelectors: [],
    freeCashSelectors: [],
    netAnnualReturnSelectors: [],
  },
};

function installSessionStorageMock() {
  const sessionStorage = new Map<string, unknown>();
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage.get(key) })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values)) {
            sessionStorage.set(key, value);
          }
        }),
        remove: vi.fn(async (key: string) => {
          sessionStorage.delete(key);
        }),
      },
    },
  };
  return sessionStorage;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("extraction choice sync action", () => {
  beforeEach(() => {
    installSessionStorageMock();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("emits a choice request and resolves with the selected candidate id", async () => {
    const onEvent = vi.fn();
    const openDashboard = vi.fn().mockResolvedValue(undefined);

    const pending = waitForExtractionChoice({
      platform,
      runId: "run-1",
      signalKey: "portfolio_value",
      candidates: [
        {
          candidateId: "candidate-1",
          selector: ".balance",
          text: "€ 1,000.00",
          value: 1000,
          score: 4.3,
        },
      ],
      onEvent,
      timeoutMs: 1000,
      openDashboard,
    });

    await flushAsync();

    const event = onEvent.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: "extraction_choice_required",
      platformId: "mintos",
      runId: "run-1",
      signalKey: "portfolio_value",
    });
    expect(openDashboard).toHaveBeenCalled();
    await expect(resolvePendingExtractionChoice(event.requestId, "candidate-1")).resolves.toBe(
      true,
    );
    await expect(pending).resolves.toBe("candidate-1");
  });

  it("returns false when resolving an unknown request", async () => {
    await expect(
      resolvePendingExtractionChoice("missing", "candidate-1"),
    ).resolves.toBe(false);
  });

  it("rejects with CancelledError when the sync aborts", async () => {
    const controller = new AbortController();
    const pending = waitForExtractionChoice({
      platform,
      runId: "run-2",
      signalKey: "free_cash",
      candidates: [
        {
          candidateId: "candidate-2",
          selector: ".cash",
          text: "€ 25.00",
          value: 25,
          score: 4.1,
        },
      ],
      onEvent: vi.fn(),
      timeoutMs: 1000,
      signal: controller.signal,
      openDashboard: vi.fn().mockResolvedValue(undefined),
    });

    await flushAsync();
    const rejection = expect(pending).rejects.toBeInstanceOf(CancelledError);
    controller.abort();

    await rejection;
  });

  it("rejects with timeout-classifiable message when no choice arrives", async () => {
    vi.useFakeTimers();
    const pending = waitForExtractionChoice({
      platform,
      runId: "run-3",
      signalKey: "portfolio_value",
      candidates: [
        {
          candidateId: "candidate-3",
          selector: ".balance",
          text: "€ 1,000.00",
          value: 1000,
          score: 4.3,
        },
      ],
      onEvent: vi.fn(),
      timeoutMs: 1000,
      openDashboard: vi.fn().mockResolvedValue(undefined),
    });

    const rejection = expect(pending).rejects.toThrow(
      "Extraction choice timeout",
    );
    await vi.advanceTimersByTimeAsync(1000);

    await rejection;
  });

  it("persists pending choice in session storage and clears it on resolve", async () => {
    const onEvent = vi.fn();
    const pending = waitForExtractionChoice({
      platform,
      runId: "run-persist",
      signalKey: "portfolio_value",
      candidates: [
        {
          candidateId: "candidate-1",
          selector: ".balance",
          text: "€ 1,000.00",
          value: 1000,
          score: 4.3,
        },
      ],
      onEvent,
      timeoutMs: 60_000,
      openDashboard: vi.fn().mockResolvedValue(undefined),
    });

    await flushAsync();

    const event = onEvent.mock.calls[0]?.[0];
    const stored = await getPersistedPendingExtractionChoice();
    expect(stored).toMatchObject({
      requestId: event.requestId,
      runId: "run-persist",
      platformId: "mintos",
      signalKey: "portfolio_value",
    });

    await resolvePendingExtractionChoice(event.requestId, "candidate-1");
    await pending;

    expect(await getPersistedPendingExtractionChoice()).toBeUndefined();
    expect(
      (globalThis as { chrome: typeof chrome }).chrome.storage.session.remove,
    ).toHaveBeenCalledWith(PENDING_CHOICE_SESSION_KEY);
  });

  it("keeps selected extraction choice successful when persisted cleanup fails", async () => {
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const onEvent = vi.fn();
    const pending = waitForExtractionChoice({
      platform,
      runId: "run-cleanup-fail",
      signalKey: "portfolio_value",
      candidates: [
        {
          candidateId: "candidate-1",
          selector: ".balance",
          text: "€ 1,000.00",
          value: 1000,
          score: 4.3,
        },
      ],
      onEvent,
      timeoutMs: 60_000,
      openDashboard: vi.fn().mockResolvedValue(undefined),
    });

    await flushAsync();
    const event = onEvent.mock.calls[0]?.[0];
    vi.mocked(chromeApi.storage.session.remove).mockRejectedValueOnce(
      new Error("session remove failed"),
    );

    await expect(
      resolvePendingExtractionChoice(event.requestId, "candidate-1"),
    ).resolves.toBe(true);
    await expect(pending).resolves.toBe("candidate-1");

    expect(await getPersistedPendingExtractionChoice()).toMatchObject({
      requestId: event.requestId,
    });

    await expect(
      resolvePendingExtractionChoice(event.requestId, "candidate-1"),
    ).resolves.toBe(false);
  });

  it("clears the timeout before waiting for slow persisted cleanup", async () => {
    vi.useFakeTimers();
    const chromeApi = (globalThis as { chrome: typeof chrome }).chrome;
    const onEvent = vi.fn();
    let resolveRemove: () => void = () => {};
    vi.mocked(chromeApi.storage.session.remove).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRemove = resolve;
        }),
    );

    const pending = waitForExtractionChoice({
      platform,
      runId: "run-slow-cleanup",
      signalKey: "portfolio_value",
      candidates: [
        {
          candidateId: "candidate-1",
          selector: ".balance",
          text: "€ 1,000.00",
          value: 1000,
          score: 4.3,
        },
      ],
      onEvent,
      timeoutMs: 1000,
      openDashboard: vi.fn().mockResolvedValue(undefined),
    });

    await flushAsync();
    const event = onEvent.mock.calls[0]?.[0];
    const resolveChoice = resolvePendingExtractionChoice(
      event.requestId,
      "candidate-1",
    );
    const marker = vi.fn();
    void resolveChoice.then(marker);

    await expect(pending).resolves.toBe("candidate-1");
    await vi.advanceTimersByTimeAsync(1000);
    expect(marker).not.toHaveBeenCalled();

    resolveRemove();
    await expect(resolveChoice).resolves.toBe(true);
  });

  it("clears persisted pending choice on abort and timeout", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = waitForExtractionChoice({
      platform,
      runId: "run-clear",
      signalKey: "free_cash",
      candidates: [
        {
          candidateId: "candidate-2",
          selector: ".cash",
          text: "€ 25.00",
          value: 25,
          score: 4.1,
        },
      ],
      onEvent: vi.fn(),
      timeoutMs: 1000,
      signal: controller.signal,
      openDashboard: vi.fn().mockResolvedValue(undefined),
    });

    await flushAsync();
    expect(await getPersistedPendingExtractionChoice()).toBeTruthy();

    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(await getPersistedPendingExtractionChoice()).toBeUndefined();

    const timeoutPending = waitForExtractionChoice({
      platform,
      runId: "run-timeout",
      signalKey: "portfolio_value",
      candidates: [
        {
          candidateId: "candidate-3",
          selector: ".balance",
          text: "€ 1,000.00",
          value: 1000,
          score: 4.3,
        },
      ],
      onEvent: vi.fn(),
      timeoutMs: 1000,
      openDashboard: vi.fn().mockResolvedValue(undefined),
    });

    await flushAsync();
    expect(await getPersistedPendingExtractionChoice()).toBeTruthy();

    const timeoutRejection = expect(timeoutPending).rejects.toThrow(
      "Extraction choice timeout",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await timeoutRejection;
    expect(await getPersistedPendingExtractionChoice()).toBeUndefined();
  });

  it("drops expired persisted pending choices", async () => {
    await (
      globalThis as { chrome: typeof chrome }
    ).chrome.storage.session.set({
      [PENDING_CHOICE_SESSION_KEY]: {
        requestId: "expired",
        runId: "run-expired",
        platformId: "mintos",
        platformName: "Mintos",
        signalKey: "portfolio_value",
        candidates: [],
        expiresAt: "2020-01-01T00:00:00.000Z",
      },
    });

    expect(await getPersistedPendingExtractionChoice()).toBeUndefined();
    await clearPersistedPendingExtractionChoice();
  });
});
