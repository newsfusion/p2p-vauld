import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendBackgroundMock = vi.fn();
const listEnabledPlatformsMock = vi.fn();

const eur = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
  }).format(value);

vi.mock("../../src/shared/messages.js", () => ({
  sendBackground: sendBackgroundMock,
}));

vi.mock("../../src/shared/platforms/index.js", () => ({
  listEnabledPlatforms: listEnabledPlatformsMock,
}));

async function settleUi(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("Popup App", () => {
  let container: HTMLDivElement;
  let root: Root;
  let App: typeof import("../../src/popup/App.js").App;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    listEnabledPlatformsMock.mockReturnValue([
      { id: "mintos", name: "Mintos" },
    ]);

    sendBackgroundMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: true };
      }
      if (message.type === "GET_METRICS") {
        return {
          metrics: [
            {
              platformId: "mintos",
              fetchedAt: "2026-03-01T12:00:00.000Z",
              platformValue: 1000,
              freeCash: 200,
              netAnnualReturnPct: 8.5,
              currency: "EUR",
              confidence: 0.9,
            },
          ],
        };
      }
      if (message.type === "GET_SYNC_STATUS") {
        return { run: undefined, queuedPlatformIds: [] };
      }
      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            showLowConfidenceMetricsInPopup: false,
            disabledPlatformIds: [],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }
      return {};
    });

    ({ App } = await import("../../src/popup/App.js"));
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.clearAllMocks();
  });

  it("renders an accessible loading indicator while lock status is loading", () => {
    sendBackgroundMock.mockImplementation(() => new Promise(() => undefined));

    flushSync(() => {
      root.render(React.createElement(App));
    });

    expect(container.querySelector('[aria-label="Loading"]')).not.toBeNull();
  });

  it("labels invested total as Portfolio Value", async () => {
    flushSync(() => {
      root.render(React.createElement(App));
    });
    for (let i = 0; i < 5; i += 1) {
      await settleUi();
    }

    expect(container.querySelector('img[src="/vauld-banner.png"]')).not.toBeNull();
    expect(container.textContent).toContain("Portfolio Value");
    expect(container.textContent).toContain("Free Cash");
    expect(container.textContent).not.toContain("Total Portfolio");
  });

  it("reacts to lock broadcasts and reports extension activity", async () => {
    flushSync(() => {
      root.render(React.createElement(App));
    });
    for (let i = 0; i < 5; i += 1) await settleUi();

    sendBackgroundMock.mockClear();
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await settleUi();
    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "SESSION_ACTIVITY",
    });

    const listeners = (
      chrome.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map(([listener]) => listener as (message: unknown) => void);
    flushSync(() => {
      for (const listener of listeners) {
        listener({
          type: "LOCK_STATUS_CHANGED",
          payload: {
            locked: true,
            hasMasterPassword: true,
            reason: "timeout",
          },
        });
      }
    });

    expect(container.textContent).toContain("Enter your master password to unlock.");
  });

  it("hides disabled platforms and excludes them from the totals", async () => {
    listEnabledPlatformsMock.mockReturnValue([
      { id: "mintos", name: "Mintos" },
      { id: "debitum", name: "Debitum" },
    ]);
    sendBackgroundMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: true };
      }
      if (message.type === "GET_METRICS") {
        return {
          metrics: [
            {
              platformId: "mintos",
              fetchedAt: "2026-03-01T12:00:00.000Z",
              platformValue: 1000,
              freeCash: 200,
              currency: "EUR",
              confidence: 0.9,
            },
            {
              platformId: "debitum",
              fetchedAt: "2026-03-01T12:00:00.000Z",
              platformValue: 2000,
              freeCash: 300,
              currency: "EUR",
              confidence: 0.9,
            },
          ],
        };
      }
      if (message.type === "GET_SYNC_STATUS") {
        return { run: undefined, queuedPlatformIds: [] };
      }
      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            showLowConfidenceMetricsInPopup: true,
            disabledPlatformIds: ["mintos"],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }
      return {};
    });

    flushSync(() => {
      root.render(React.createElement(App));
    });
    for (let i = 0; i < 5; i += 1) {
      await settleUi();
    }

    expect(container.textContent).toContain("Debitum");
    expect(container.textContent).not.toContain("Mintos");
    // Totals cover Debitum only (2000 / 300), not the disabled Mintos.
    expect(container.textContent).toContain(eur(2000));
    expect(container.textContent).not.toContain(eur(3000));
  });

  it("keeps low-confidence values in More until the user includes them in totals", async () => {
    sendBackgroundMock.mockImplementation(async (message: { type: string; payload?: unknown }) => {
      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: true };
      }
      if (message.type === "GET_METRICS") {
        return {
          metrics: [
            {
              platformId: "mintos",
              fetchedAt: "2026-03-01T12:00:00.000Z",
              platformValue: 1000,
              freeCash: 200,
              currency: "EUR",
              confidence: 0.39,
              warnings: ["Low confidence extraction: 0.39"],
            },
          ],
        };
      }
      if (message.type === "GET_SYNC_STATUS") {
        return { run: undefined, queuedPlatformIds: [] };
      }
      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            showLowConfidenceMetricsInPopup: false,
            disabledPlatformIds: [],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }
      if (message.type === "SAVE_SETTINGS") {
        return { success: true };
      }
      return {};
    });

    flushSync(() => {
      root.render(React.createElement(App));
    });
    for (let i = 0; i < 5; i += 1) {
      await settleUi();
    }

    expect(container.querySelector('[data-testid="popup-total-value"]')?.textContent).toContain(eur(0));
    expect(container.querySelector('[data-testid="popup-total-cash"]')?.textContent).toContain(eur(0));
    expect(container.textContent).toContain("Needs review");

    container
      .querySelector<HTMLButtonElement>('[data-testid="popup-more-toggle"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleUi();

    expect(container.querySelector('[data-testid="popup-low-confidence-details"]')?.textContent).toContain("Mintos");
    expect(container.querySelector('[data-testid="popup-low-confidence-details"]')?.textContent).toContain("39%");
    expect(container.querySelector('[data-testid="popup-low-confidence-details"]')?.textContent).toContain(eur(1000));
    expect(container.querySelector('[data-testid="popup-low-confidence-details"]')?.textContent).toContain(eur(200));

    container
      .querySelector<HTMLButtonElement>('[data-testid="popup-include-low-confidence"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleUi();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "SAVE_SETTINGS",
      payload: { showLowConfidenceMetricsInPopup: true },
    });
    expect(container.querySelector('[data-testid="popup-total-value"]')?.textContent).toContain(eur(1000));
    expect(container.querySelector('[data-testid="popup-total-cash"]')?.textContent).toContain(eur(200));
    expect(container.textContent).toContain("low confidence");
  });

  it("includes low-confidence values in totals when the saved default is enabled", async () => {
    sendBackgroundMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: true };
      }
      if (message.type === "GET_METRICS") {
        return {
          metrics: [
            {
              platformId: "mintos",
              fetchedAt: "2026-03-01T12:00:00.000Z",
              platformValue: 1000,
              freeCash: 200,
              currency: "EUR",
              confidence: 0.39,
              warnings: ["Low confidence extraction: 0.39"],
            },
          ],
        };
      }
      if (message.type === "GET_SYNC_STATUS") {
        return { run: undefined, queuedPlatformIds: [] };
      }
      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            showLowConfidenceMetricsInPopup: true,
            disabledPlatformIds: [],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }
      return {};
    });

    flushSync(() => {
      root.render(React.createElement(App));
    });
    for (let i = 0; i < 5; i += 1) {
      await settleUi();
    }

    expect(container.querySelector('[data-testid="popup-total-value"]')?.textContent).toContain(eur(1000));
    expect(container.querySelector('[data-testid="popup-total-cash"]')?.textContent).toContain(eur(200));
    expect(container.textContent).toContain("low confidence");
  });

  it("hydrates queued platforms from sync status", async () => {
    listEnabledPlatformsMock.mockReturnValue([
      { id: "mintos", name: "Mintos" },
      { id: "peerberry", name: "PeerBerry" },
    ]);
    sendBackgroundMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: true };
      }
      if (message.type === "GET_METRICS") {
        return { metrics: [] };
      }
      if (message.type === "GET_SYNC_STATUS") {
        return {
          run: {
            runId: "run-queue",
            state: "running",
            startedAt: "2026-06-17T10:00:00.000Z",
            platformProgress: { mintos: "running", peerberry: "pending" },
          },
          queuedPlatformIds: ["peerberry"],
        };
      }
      return {};
    });

    flushSync(() => {
      root.render(React.createElement(App));
    });
    for (let i = 0; i < 5; i += 1) {
      await settleUi();
    }

    expect(container.textContent).toContain("Syncing platforms…");
    expect(container.textContent).toContain("PeerBerry");
    expect(container.textContent).toContain("In Queue #1");
    expect(container.querySelector('[role="img"][aria-label="Syncing"]')).not.toBeNull();
    expect(container.querySelector('[role="img"][aria-label="Queued"]')).not.toBeNull();
  });

  it("clears syncing state when a sync_failed progress event arrives", async () => {
    listEnabledPlatformsMock.mockReturnValue([
      { id: "mintos", name: "Mintos" },
    ]);
    sendBackgroundMock.mockImplementation(async (message: { type: string }) => {
      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: true };
      }
      if (message.type === "GET_METRICS") {
        return { metrics: [] };
      }
      if (message.type === "GET_SYNC_STATUS") {
        return {
          run: {
            runId: "run-failed",
            state: "running",
            startedAt: "2026-06-17T10:00:00.000Z",
            platformProgress: { mintos: "running" },
          },
          queuedPlatformIds: [],
        };
      }
      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            showLowConfidenceMetricsInPopup: true,
            disabledPlatformIds: [],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }
      return {};
    });

    flushSync(() => {
      root.render(React.createElement(App));
    });
    for (let i = 0; i < 5; i += 1) {
      await settleUi();
    }

    expect(container.textContent).toContain("Syncing platforms…");

    const listener = (
      chrome.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);
    flushSync(() => {
      listener({
        type: "SYNC_PROGRESS",
        payload: {
          type: "sync_failed",
          platformId: "",
          runId: "run-failed",
          message: "Sync interrupted by service worker restart",
        },
      });
    });
    await settleUi();

    expect(container.textContent).not.toContain("Syncing platforms…");
    expect(container.textContent).toContain("Refresh All");
  });
});
