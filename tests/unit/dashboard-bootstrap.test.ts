import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDashboardStore } from "../../src/dashboard/store.js";

const sendBackground = vi.fn();
const { settingsPanelProps, platformTableProps, portfolioHeaderProps, onboardingProps } = vi.hoisted(() => ({
  settingsPanelProps: [] as Array<Record<string, unknown>>,
  platformTableProps: [] as Array<Record<string, unknown>>,
  portfolioHeaderProps: [] as Array<Record<string, unknown>>,
  onboardingProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../src/shared/messages.js", () => ({
  sendBackground,
}));

vi.mock("../../src/shared/theme.js", () => ({
  ThemeToggle: () => React.createElement("div"),
}));

vi.mock("../../src/dashboard/components/PlatformTable.js", () => ({
  PlatformTable: (props: {
    onSyncPlatform: (platformId: "mintos" | "peerberry") => void;
    onReportWrongImport: (input: {
      platformId: "mintos" | "peerberry";
      batchId: number;
    }) => Promise<void>;
    onAddPlatform: () => void;
  }) => {
    platformTableProps.push(props as unknown as Record<string, unknown>);
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "mock-platform-sync-mintos",
          onClick: () => props.onSyncPlatform("mintos"),
        },
        "Sync Mintos",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "mock-platform-sync-peerberry",
          onClick: () => props.onSyncPlatform("peerberry"),
        },
        "Sync PeerBerry",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "mock-report-wrong-mintos",
          onClick: () =>
            void props
              .onReportWrongImport({ platformId: "mintos", batchId: 7 })
              .catch(() => undefined),
        },
        "Report Wrong Mintos",
      ),
      React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "mock-platform-add",
          className: "hover:bg-accent hover:text-slate-950",
          onClick: props.onAddPlatform,
        },
        "Add Platform",
      ),
    );
  },
}));

vi.mock("../../src/dashboard/components/PortfolioHeader.js", () => ({
  PortfolioHeader: (props: Record<string, unknown>) => {
    portfolioHeaderProps.push(props);
    return React.createElement("div");
  },
}));

vi.mock("../../src/dashboard/components/SettingsPanel.js", () => ({
  SettingsPanel: (props: Record<string, unknown>) => {
    settingsPanelProps.push(props);
    return React.createElement(
      "div",
      { "data-testid": "mock-settings-panel" },
      "Settings Panel",
    );
  },
}));

vi.mock("../../src/dashboard/components/SyncProgressDetail.js", () => ({
  SyncProgressDetail: () => React.createElement("div"),
}));

vi.mock("../../src/dashboard/components/OnboardingModal.js", () => ({
  OnboardingModal: (props: Record<string, unknown>) => {
    onboardingProps.push(props);
    return React.createElement("div");
  },
}));

vi.mock("../../src/dashboard/components/UnlockScreen.js", () => ({
  UnlockScreen: () => React.createElement("div"),
}));

vi.mock("../../src/dashboard/components/Analytics.js", () => ({
  Analytics: () => React.createElement("div"),
}));

vi.mock("../../src/dashboard/components/ExportPanel.js", () => ({
  ExportPanel: () =>
    React.createElement("div", { "data-testid": "mock-export-panel" }, "Export Panel"),
}));

vi.mock("../../src/dashboard/components/DebugPanel.js", () => ({
  DebugPanel: () => React.createElement("div"),
}));

vi.mock("../../src/dashboard/components/LoginExtractorTab.js", () => ({
  LoginExtractorTab: () => React.createElement("div"),
}));

vi.mock("../../src/dashboard/components/DashboardExtractorTab.js", () => ({
  DashboardExtractorTab: () => React.createElement("div"),
}));

describe("dashboard bootstrap", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sendBackground.mockReset();
    settingsPanelProps.length = 0;
    platformTableProps.length = 0;
    portfolioHeaderProps.length = 0;
    onboardingProps.length = 0;
    useDashboardStore.setState({
      lockStatus: null,
      metrics: [],
      configuredPlatformIds: [],
      privacyMode: false,
      debugMode: false,
      geminiStatus: null,
      geminiDownloadProgress: null,
      geminiDownloadError: null,
      geminiBannerDismissed: false,
      geminiSettingsFocusRequest: 0,
      isSyncing: false,
      queuedPlatformIds: [],
      syncStates: {},
      syncSteps: {},
      debugSnapshots: [],
      view: "overview",
      extractorTransfer: null,
      showOnboarding: false,
    });
    (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mockClear();
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      p2p_onboarding_complete: true,
    });
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  async function flushDashboardEffects() {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function baseSettings(overrides: Record<string, unknown> = {}) {
    return {
      privacyModeEnabled: false,
      stealthModeEnabled: false,
      debugModeEnabled: false,
      disabledPlatformIds: [],
      lastUsedCredentialEmail: "",
      language: "en",
      sessionTimeoutMinutes: 0,
      historyRetentionDays: 0,
      geminiActivationBannerDismissed: false,
      ...overrides,
    };
  }

  it("renders dashboard shell after bootstrap without throwing", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    expect(container.textContent).toContain("P2P Portfolio Tracker");
  });

  it("reacts to lock broadcasts and reports dashboard activity", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: true };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");
    flushSync(() => root.render(React.createElement(App)));
    await flushDashboardEffects();

    sendBackground.mockClear();
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await flushDashboardEffects();
    expect(sendBackground).toHaveBeenCalledWith({ type: "SESSION_ACTIVITY" });

    const listeners = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
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

    expect(useDashboardStore.getState().lockStatus).toEqual({
      locked: true,
      hasMasterPassword: true,
      reason: "timeout",
    });
  });

  it("refreshes lock status after onboarding completes", async () => {
    (chrome.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      p2p_onboarding_complete: false,
    });
    let lockStatusCalls = 0;
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          lockStatusCalls += 1;
          return lockStatusCalls === 1
            ? { locked: false, hasMasterPassword: false }
            : { locked: false, hasMasterPassword: true };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");
    flushSync(() => root.render(React.createElement(App)));
    await flushDashboardEffects();

    const onComplete = onboardingProps.at(-1)?.onComplete as () => void;
    await act(async () => onComplete());
    await flushDashboardEffects();

    expect(useDashboardStore.getState().lockStatus).toEqual({
      locked: false,
      hasMasterPassword: true,
    });
  });

  it("drops a platform from the overview table and totals as soon as it is disabled", async () => {
    const metrics = [
      {
        platformId: "mintos",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 1000,
        freeCash: 100,
        currency: "EUR",
        confidence: 0.9,
      },
      {
        platformId: "debitum",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 2000,
        freeCash: 200,
        currency: "EUR",
        confidence: 0.9,
      },
    ];
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos", "debitum"], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });
    await flushDashboardEffects();

    const initialTable = platformTableProps.at(-1) as {
      platforms: Array<{ id: string }>;
      metrics: Array<{ platformId: string }>;
    };
    expect(initialTable.platforms.map((p) => p.id)).toEqual(["mintos", "debitum"]);
    expect(initialTable.metrics).toHaveLength(2);
    expect((portfolioHeaderProps.at(-1) as { totalValue: number }).totalValue).toBe(3000);

    // Simulate the Connected Platforms toggle turning Mintos off.
    await act(async () => {
      useDashboardStore.setState({ view: "settings" });
    });
    const settingsProps = settingsPanelProps.at(-1) as {
      onConfiguredPlatformsChange: (
        active: string[],
        disabled: string[],
      ) => void;
    };
    await act(async () => {
      settingsProps.onConfiguredPlatformsChange(["debitum"], ["mintos"]);
    });
    await act(async () => {
      useDashboardStore.setState({ view: "overview" });
    });

    const nextTable = platformTableProps.at(-1) as {
      platforms: Array<{ id: string }>;
      metrics: Array<{ platformId: string }>;
      syncablePlatformIds?: string[];
    };
    expect(nextTable.platforms.map((p) => p.id)).toEqual(["debitum"]);
    expect(nextTable.metrics.map((m) => m.platformId)).toEqual(["debitum"]);
    expect(nextTable.syncablePlatformIds).toEqual(["debitum"]);
    expect((portfolioHeaderProps.at(-1) as { totalValue: number }).totalValue).toBe(2000);
  });

  it("clears dashboard syncing state immediately when cancel all is clicked", async () => {
    let cancelAllCalled = false;
    let syncStatusCall = 0;
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          syncStatusCall += 1;
          if (syncStatusCall === 1) {
            return {
              run: {
                runId: "run-cancel-ui",
                state: "running",
                startedAt: "2026-06-09T07:00:00.000Z",
                platformProgress: {
                  mintos: "running",
                },
              },
            };
          }
          return {
            run: {
              runId: "run-cancel-ui",
              state: "cancelled",
              startedAt: "2026-06-09T07:00:00.000Z",
              finishedAt: "2026-06-09T07:01:00.000Z",
              platformProgress: {
                mintos: "cancelled",
              },
            },
          };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        case "CANCEL_SYNC_ALL":
          cancelAllCalled = true;
          return { success: true };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Cancel all",
    );
    expect(cancelButton).toBeTruthy();

    flushSync(() => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushDashboardEffects();

    expect(cancelAllCalled).toBe(true);
    expect(container.textContent).not.toContain("Cancel all");
    expect(useDashboardStore.getState().isSyncing).toBe(false);
  });

  it("restores extraction choice modal from pendingChoice during bootstrap", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return {
            run: {
              runId: "run-choice-restore",
              state: "running",
              startedAt: "2026-06-09T07:00:00.000Z",
              platformProgress: { mintos: "running" },
            },
            pendingChoice: {
              requestId: "choice-restore",
              runId: "run-choice-restore",
              platformId: "mintos",
              platformName: "Mintos",
              signalKey: "portfolio_value",
              expiresAt: "2026-06-09T08:00:00.000Z",
              candidates: [
                {
                  candidateId: "candidate-1",
                  selector: ".balance",
                  text: "€ 1,000.00",
                  value: 1000,
                  score: 4.3,
                  context: "Account Balance",
                  valueType: "currency",
                },
              ],
            },
          };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    expect(useDashboardStore.getState().isSyncing).toBe(true);
    expect(useDashboardStore.getState().syncSteps.mintos).toBe(
      "Waiting for value selection...",
    );
    expect(container.textContent).toContain("Select Portfolio Value");
  });

  it("keeps syncing state cleared after cancel all succeeds for orphaned sync", async () => {
    let syncStatusCall = 0;
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          syncStatusCall += 1;
          if (syncStatusCall === 1) {
            return {
              run: {
                runId: "run-orphan",
                state: "running",
                startedAt: "2026-06-09T07:00:00.000Z",
                platformProgress: { mintos: "running" },
              },
            };
          }
          return {
            run: {
              runId: "run-orphan",
              state: "failed",
              startedAt: "2026-06-09T07:00:00.000Z",
              finishedAt: "2026-06-09T07:05:00.000Z",
              message: "Sync interrupted by extension restart",
              platformProgress: { mintos: "failed_timeout" },
            },
          };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        case "CANCEL_SYNC_ALL":
          return { success: true };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Cancel all",
    );
    expect(cancelButton).toBeTruthy();

    flushSync(() => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushDashboardEffects();

    expect(useDashboardStore.getState().isSyncing).toBe(false);
    expect(container.textContent).not.toContain("Cancel all");
  });

  it("clears dashboard syncing state when a running sync fails in the background", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return {
            run: {
              runId: "run-failed-restart",
              state: "running",
              startedAt: "2026-06-09T07:00:00.000Z",
              platformProgress: {
                mintos: "running",
              },
            },
          };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    expect(useDashboardStore.getState().isSyncing).toBe(true);
    expect(container.textContent).toContain("Cancel all");

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    if (!listener) {
      throw new Error("Expected SYNC_PROGRESS listener to be registered");
    }

    flushSync(() => {
      listener({
        type: "SYNC_PROGRESS",
        payload: {
          type: "sync_failed",
          runId: "run-failed-restart",
          message: "Sync interrupted by extension restart",
        },
      });
    });

    expect(container.textContent).not.toContain("Cancel all");
    expect(useDashboardStore.getState().isSyncing).toBe(false);
    expect(useDashboardStore.getState().syncSteps).toEqual({});
  });

  it("renders Export as a primary dashboard tab between Analytics and Settings", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [], dataPlatformIds: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const navLabels = Array.from(container.querySelectorAll("nav button")).map(
      (button) => button.textContent?.trim(),
    );
    expect(navLabels.slice(0, 4)).toEqual([
      "Portfolio",
      "Analytics",
      "Export",
      "Settings",
    ]);

    const exportButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Export",
    );
    exportButton?.click();
    await flushDashboardEffects();

    expect(container.querySelector('[data-testid="mock-export-panel"]')).toBeTruthy();
  });

  it("hydrates sync state from GET_SYNC_STATUS during bootstrap", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return {
            run: {
              runId: "run-1",
              state: "running",
              startedAt: "2026-03-29T10:00:00.000Z",
              platformProgress: { mintos: "running" },
            },
          };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const state = useDashboardStore.getState();
    expect(state.isSyncing).toBe(true);
    expect(state.syncStates.mintos).toBe("running");
  });

  it("hydrates queued platforms from GET_SYNC_STATUS during bootstrap", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos", "peerberry"] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return {
            run: {
              runId: "run-queue",
              state: "running",
              startedAt: "2026-03-29T10:00:00.000Z",
              platformProgress: { mintos: "running", peerberry: "pending" },
            },
            queuedPlatformIds: ["peerberry"],
          };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const state = useDashboardStore.getState();
    expect(state.queuedPlatformIds).toEqual(["peerberry"]);
    expect(state.syncStates.peerberry).toBe("pending");
    expect(state.syncSteps.peerberry).toBe("In Queue #1");
  });

  it("rolls back optimistic queued state when active enqueue is rejected", async () => {
    let syncStatusCalls = 0;
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos", "peerberry"] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          syncStatusCalls += 1;
          return {
            run: {
              runId: "run-reject-queue",
              state: "running",
              startedAt: "2026-03-29T10:00:00.000Z",
              platformProgress: { mintos: "running" },
            },
            queuedPlatformIds: [],
          };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        case "START_SYNC":
          return { error: "A sync is finishing. Please try again shortly." };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const peerberryButton = container.querySelector(
      '[data-testid="mock-platform-sync-peerberry"]',
    );
    expect(peerberryButton).toBeTruthy();

    flushSync(() => {
      peerberryButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await flushDashboardEffects();

    const state = useDashboardStore.getState();
    expect(syncStatusCalls).toBeGreaterThan(1);
    expect(state.queuedPlatformIds).toEqual([]);
    expect(state.syncStates).toEqual({ mintos: "running" });
    expect(state.syncSteps.peerberry).toBeUndefined();
  });

  it("tracks and clears sync step text from SYNC_PROGRESS events", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    if (!listener) {
      throw new Error("Expected SYNC_PROGRESS listener to be registered");
    }

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_progress",
        platformId: "mintos",
        runId: "run-42",
        message: "Opening dashboard...",
      },
    });

    expect(useDashboardStore.getState().syncSteps.mintos).toBe("Opening dashboard...");

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_done",
        platformId: "mintos",
        runId: "run-42",
      },
    });

    expect(useDashboardStore.getState().syncSteps.mintos).toBeUndefined();
  });

  it("tracks queued events and clears queue on metrics refresh", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["peerberry"] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined, queuedPlatformIds: [] };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_queued",
        platformId: "peerberry",
        runId: "run-queue",
        queuePosition: 1,
      },
    });

    expect(useDashboardStore.getState().queuedPlatformIds).toEqual(["peerberry"]);
    expect(useDashboardStore.getState().syncSteps.peerberry).toBe("In Queue #1");

    listener({
      type: "METRICS_UPDATED",
      payload: { metrics: [], dataPlatformIds: [] },
    });

    expect(useDashboardStore.getState().queuedPlatformIds).toEqual([]);
  });

  it("retains login and dashboard HTML in a single debug snapshot", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: true,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
              historyRetentionDays: 0,
              geminiActivationBannerDismissed: false,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    if (!listener) {
      throw new Error("Expected SYNC_PROGRESS listener to be registered");
    }

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_error",
        platformId: "mintos",
        runId: "run-7",
        message: "Login failed",
        state: "failed_login",
        rawLoginHtml: "<html><body>Mintos Login</body></html>",
      },
    });

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_done",
        platformId: "mintos",
        runId: "run-7",
        rawHtml: "<html><body>Mintos Dashboard</body></html>",
        result: {
          fetchedAt: "2026-05-25T12:00:00.000Z",
          platformId: "mintos",
          cashflows: [],
          positions: [],
          overviewMetrics: {
            platformValue: 1234,
            freeCash: 56,
            currency: "EUR",
            confidence: 0.9,
          },
          warnings: [],
        },
      },
    });

    await flushDashboardEffects();

    const snapshot = useDashboardStore
      .getState()
      .debugSnapshots.find((entry) => entry.platformId === "mintos");

    expect(snapshot?.rawLoginHtml).toContain("Mintos Login");
    expect(snapshot?.rawHtml).toContain("Mintos Dashboard");
  });

  it("stores platform_error messages in syncErrors for dashboard display", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_error",
        platformId: "mintos",
        runId: "run-login-fail",
        message: "Login form fields not found",
        state: "failed_login",
      },
    });

    await flushDashboardEffects();

    expect(useDashboardStore.getState().syncStates.mintos).toBe("failed_login");
    expect(useDashboardStore.getState().syncErrors.mintos).toBe(
      "Login form fields not found",
    );

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_start",
        platformId: "mintos",
        runId: "run-login-retry",
      },
    });

    await flushDashboardEffects();

    expect(useDashboardStore.getState().syncErrors.mintos).toBeUndefined();
  });

  it("restores persisted login errors after dashboard reload", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return {
            platformIds: ["mintos"],
            credentials: [
              {
                platformId: "mintos",
                lastLoginError: "Login rejected — invalid credentials",
              },
            ],
          };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");
    flushSync(() => root.render(React.createElement(App)));
    await flushDashboardEffects();

    expect(useDashboardStore.getState().syncStates.mintos).toBe("failed_login");
    expect(useDashboardStore.getState().syncErrors.mintos).toBe(
      "Login rejected — invalid credentials",
    );
  });

  it("does not overwrite an active platform with its persisted login error", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return {
            platformIds: ["mintos", "peerberry"],
            credentials: [
              { platformId: "mintos", lastLoginError: "Old Mintos error" },
              { platformId: "peerberry", lastLoginError: "PeerBerry error" },
            ],
          };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return {
            run: {
              runId: "run-active",
              state: "running",
              startedAt: "2026-08-17T09:00:00.000Z",
              platformProgress: { mintos: "running" },
            },
          };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");
    flushSync(() => root.render(React.createElement(App)));
    await flushDashboardEffects();

    const state = useDashboardStore.getState();
    expect(state.syncStates.mintos).toBe("running");
    expect(state.syncErrors.mintos).toBeUndefined();
    expect(state.syncStates.peerberry).toBe("failed_login");
    expect(state.syncErrors.peerberry).toBe("PeerBerry error");
  });

  it("retains debug logs and dashboard HTML when sync is cancelled", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: true,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
              historyRetentionDays: 0,
              geminiActivationBannerDismissed: false,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    if (!listener) {
      throw new Error("Expected SYNC_PROGRESS listener to be registered");
    }

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_start",
        platformId: "mintos",
        runId: "run-cancel-debug",
      },
    });

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_progress",
        platformId: "mintos",
        runId: "run-cancel-debug",
        debugLogs: [
          {
            timestamp: "2026-05-25T12:00:00.000Z",
            step: "Extracting data",
            level: "info",
          },
        ],
      },
    });

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_cancelled",
        platformId: "mintos",
        runId: "run-cancel-debug",
        message: "Cancelled by user",
        state: "cancelled",
        rawLoginHtml: "<html><body>Estate Guru Login</body></html>",
        rawHtml: "<html><body>Estate Guru Dashboard</body></html>",
      },
    });

    await flushDashboardEffects();

    const snapshot = useDashboardStore
      .getState()
      .debugSnapshots.find((entry) => entry.platformId === "mintos");

    expect(snapshot?.logs).toHaveLength(1);
    expect(snapshot?.cancelled).toBe(true);
    expect(snapshot?.rawLoginHtml).toContain("Estate Guru Login");
    expect(snapshot?.rawHtml).toContain("Estate Guru Dashboard");
  });

  it("clears stale error state when sync is cancelled", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: true,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
              historyRetentionDays: 0,
              geminiActivationBannerDismissed: false,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    useDashboardStore.setState({
      debugSnapshots: [
        {
          platformId: "mintos",
          platformName: "Mintos",
          timestamp: "2026-03-09T10:00:00.000Z",
          signals: [],
          loginSuccess: false,
          error: "Previous login failed",
          logs: [],
        },
      ],
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    if (!listener) {
      throw new Error("Expected SYNC_PROGRESS listener to be registered");
    }

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_cancelled",
        platformId: "mintos",
        runId: "run-cancel-error-clear",
        message: "Cancelled by user",
        state: "cancelled",
        rawHtml: "<html><body>Dashboard after cancel</body></html>",
      },
    });

    await flushDashboardEffects();

    const snapshot = useDashboardStore
      .getState()
      .debugSnapshots.find((entry) => entry.platformId === "mintos");

    expect(snapshot?.cancelled).toBe(true);
    expect(snapshot?.error).toBeUndefined();
    expect(snapshot?.rawHtml).toContain("Dashboard after cancel");
  });

  it("preserves debug snapshots when dashboard hydrates sync state", async () => {
    useDashboardStore.setState({
      debugSnapshots: [
        {
          platformId: "mintos",
          platformName: "Mintos",
          timestamp: "2026-03-09T10:00:00.000Z",
          signals: [],
          loginSuccess: false,
          cancelled: true,
          logs: [
            {
              timestamp: "2026-03-09T10:00:00.000Z",
              step: "Extracting data",
              level: "info",
            },
          ],
          rawHtml: "<html><body>Dashboard after cancel</body></html>",
        },
      ],
    });

    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"], credentials: [] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: true,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
              historyRetentionDays: 0,
              geminiActivationBannerDismissed: false,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "unavailable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const snapshot = useDashboardStore.getState().debugSnapshots[0];
    expect(snapshot?.rawHtml).toContain("Dashboard after cancel");
    expect(snapshot?.logs).toHaveLength(1);
  });

  it("updates platform metrics immediately on platform_done events", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return {
            metrics: [
              {
                platformId: "mintos",
                platformValue: 1000,
                freeCash: 100,
                netAnnualReturnPct: 10,
                currency: "EUR",
                confidence: 0.9,
                fetchedAt: "2026-05-21T09:00:00.000Z",
              },
            ],
          };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_done",
        platformId: "mintos",
        runId: "run-42",
        result: {
          fetchedAt: "2026-05-21T10:00:00.000Z",
          platformId: "mintos",
          cashflows: [],
          positions: [],
          warnings: [],
          overviewMetrics: {
            platformValue: 2345,
            freeCash: 456,
            netAnnualReturnPct: 12.5,
            currency: "EUR",
            confidence: 1,
          },
        },
      },
    });

    expect(useDashboardStore.getState().metrics).toEqual([
      {
        platformId: "mintos",
        platformValue: 2345,
        freeCash: 456,
        netAnnualReturnPct: 12.5,
        currency: "EUR",
        confidence: 1,
        fetchedAt: "2026-05-21T10:00:00.000Z",
      },
    ]);
  });

  it("starts a sync for only the selected platform from a row action", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos", "peerberry"] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "START_SYNC":
          return { runId: "run-1" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    container
      .querySelector<HTMLButtonElement>('[data-testid="mock-platform-sync-mintos"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(sendBackground).toHaveBeenCalledWith({
      type: "START_SYNC",
      payload: { platformIds: ["mintos"] },
    });
    expect(sendBackground).not.toHaveBeenCalledWith({
      type: "START_SYNC",
      payload: {},
    });
  });

  it("keeps report-resync UI active when revert broadcasts refreshed metrics", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return {
            metrics: [
              {
                platformId: "mintos",
                fetchedAt: "2026-06-08T10:00:00.000Z",
                platformValue: 1234,
                freeCash: 56,
                currency: "EUR",
                confidence: 1,
              },
            ],
            dataPlatformIds: ["mintos"],
          };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "REVERT_PLATFORM_BATCH": {
          const listener = (
            chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
          ).mock.calls[0]?.[0] as
            | ((message: { type: string; payload: unknown }) => void)
            | undefined;
          listener?.({
            type: "METRICS_UPDATED",
            payload: {
              metrics: [],
              dataPlatformIds: ["mintos"],
            },
          });
          return { success: true };
        }
        case "RESET_PLATFORM_SELECTORS":
          return { success: true };
        case "START_SYNC":
          return { runId: "forced-run" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    container
      .querySelector<HTMLButtonElement>('[data-testid="mock-report-wrong-mintos"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(sendBackground).toHaveBeenCalledWith({
      type: "REVERT_PLATFORM_BATCH",
      payload: { platformId: "mintos", batchId: 7 },
    });
    expect(sendBackground).toHaveBeenCalledWith({
      type: "RESET_PLATFORM_SELECTORS",
      payload: { platformId: "mintos" },
    });
    expect(sendBackground).toHaveBeenCalledWith({
      type: "START_SYNC",
      payload: {
        platformIds: ["mintos"],
        forceExtractionChoiceForSignals: ["portfolio_value", "free_cash"],
      },
    });
    expect(useDashboardStore.getState().isSyncing).toBe(true);
    expect(useDashboardStore.getState().syncStates.mintos).toBe("pending");

    const correctionCalls = sendBackground.mock.calls
      .map(([message]) => message as { type: string })
      .filter((message) =>
        [
          "REVERT_PLATFORM_BATCH",
          "RESET_PLATFORM_SELECTORS",
          "START_SYNC",
        ].includes(message.type),
      );
    expect(correctionCalls.map((message) => message.type)).toEqual([
      "REVERT_PLATFORM_BATCH",
      "RESET_PLATFORM_SELECTORS",
      "START_SYNC",
    ]);
  });

  it("stops report resync and restores UI state when selector reset fails", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return {
            metrics: [
              {
                platformId: "mintos",
                fetchedAt: "2026-06-08T10:00:00.000Z",
                platformValue: 1234,
                freeCash: 56,
                currency: "EUR",
                confidence: 1,
              },
            ],
            dataPlatformIds: ["mintos"],
          };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "REVERT_PLATFORM_BATCH":
          return { success: true };
        case "RESET_PLATFORM_SELECTORS":
          return { success: false, error: "Selector reset failed" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });
    await flushDashboardEffects();

    container
      .querySelector<HTMLButtonElement>('[data-testid="mock-report-wrong-mintos"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushDashboardEffects();

    expect(sendBackground).toHaveBeenCalledWith({
      type: "RESET_PLATFORM_SELECTORS",
      payload: { platformId: "mintos" },
    });
    expect(sendBackground).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "START_SYNC" }),
    );
    expect(useDashboardStore.getState().isSyncing).toBe(false);
    expect(useDashboardStore.getState().syncStates.mintos).toBeUndefined();
  });

  it("opens settings from platform table add platform button", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const addPlatformButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Add Platform",
    );
    expect(addPlatformButton).not.toBeUndefined();
    expect(addPlatformButton?.className).toContain("hover:text-slate-950");
    expect(addPlatformButton?.className).not.toContain("hover:text-primary");

    flushSync(() => {
      addPlatformButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="mock-settings-panel"]')).not.toBeNull();
    expect(useDashboardStore.getState().view).toBe("settings");
  });

  it("shows the Gemini Nano activation banner for first-time users when unavailable", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "downloadable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    expect(container.textContent).toContain("Gemini Nano");
    expect(container.textContent).toContain("Open Settings");
  });

  it("opens Settings from the Gemini Nano activation banner", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "downloadable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    container
      .querySelector<HTMLButtonElement>('[data-testid="gemini-banner-open-settings"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushDashboardEffects();

    expect(container.textContent).toContain("Settings Panel");
    expect(settingsPanelProps.at(-1)).not.toHaveProperty("scrollToGeminiNano");
    expect(useDashboardStore.getState().geminiSettingsFocusRequest).toBe(1);
  });

  it("routes Gemini download broadcasts through the shared dashboard state", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "downloadable" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    listener({
      type: "GEMINI_DOWNLOAD_PROGRESS",
      payload: { loaded: 25, total: 100 },
    });
    listener({
      type: "GEMINI_DOWNLOAD_FAILED",
      payload: { error: "download failed" },
    });
    listener({
      type: "GEMINI_STATUS_CHANGED",
      payload: { status: "available" },
    });

    const state = useDashboardStore.getState();
    expect(state.geminiStatus).toBe("available");
    expect(state.geminiDownloadProgress).toBeNull();
    expect(state.geminiDownloadError).toBeNull();
  });

  it("dismisses the Gemini Nano activation banner and persists the choice", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "downloadable" };
        case "SAVE_SETTINGS":
          return { success: true };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    container
      .querySelector<HTMLButtonElement>('[data-testid="gemini-banner-dismiss"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushDashboardEffects();

    expect(sendBackground).toHaveBeenCalledWith({
      type: "SAVE_SETTINGS",
      payload: { geminiActivationBannerDismissed: true },
    });
    expect(container.textContent).not.toContain("Open Settings");
  });

  it("does not show the Gemini Nano activation banner when Gemini is available", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "available" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    expect(container.textContent).not.toContain("Open Settings");
  });

  it("marks dashboard menu items as interactive hover targets", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: true };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const menuItems = Array.from(
      container.querySelectorAll<HTMLButtonElement>("nav button"),
    );

    expect(menuItems).toHaveLength(4);
    expect(menuItems.map((button) => button.textContent?.trim())).toEqual([
      "Portfolio",
      "Analytics",
      "Export",
      "Settings",
    ]);
    expect(
      menuItems.every((button) =>
        button.className.split(/\s+/).includes("dashboard-menu-item"),
      ),
    ).toBe(true);
  });

  it("keeps tracker branding and omits non-functional template controls", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: true };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: [] };
        case "GET_SETTINGS":
          return {
            settings: {
              privacyModeEnabled: false,
              stealthModeEnabled: false,
              debugModeEnabled: false,
              disabledPlatformIds: [],
              lastUsedCredentialEmail: "",
              language: "en",
              sessionTimeoutMinutes: 0,
            },
          };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const header = container.querySelector("header");
    expect(header?.textContent).toContain("P2P Portfolio Tracker");
    expect(header?.querySelector('img[src="/vauld-banner.png"]')).not.toBeNull();
    expect(header?.textContent).not.toContain("P2P Ledger");
    expect(container.querySelector('input[placeholder="Search..."]')).toBeNull();
    expect(container.textContent).not.toContain("Summary");
    expect(container.textContent).not.toContain("Details");
    expect(container.textContent).not.toContain("History");
  });

  it("shows neutral Gemini match badges in manual extraction choice mode and submits the selected candidate", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return { platformIds: ["mintos"] };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "available" };
        case "RESOLVE_EXTRACTION_CHOICE":
          return { success: true };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "extraction_choice_required",
        platformId: "mintos",
        platformName: "Mintos",
        runId: "run-42",
        requestId: "choice-1",
        signalKey: "portfolio_value",
        expiresAt: "2026-05-18T10:02:00.000Z",
        candidates: [
          {
            candidateId: "portfolio_value|.balance|account balance",
            selector: ".balance",
            text: "€ 1,000.00",
            value: 1000,
            score: 4.4,
            context: "Account Balance",
            valueType: "currency",
            geminiSupported: true,
          },
          {
            candidateId: "portfolio_value|.header-balance|account balance",
            selector: ".header-balance",
            text: "€ 1,000.00",
            value: 1001,
            score: 4.4,
            context: `Header Balance ${"X".repeat(260)}`,
            valueType: "currency",
            geminiSupported: true,
          },
        ],
      },
    });

    await Promise.resolve();

    expect(container.textContent).toContain("Select Portfolio Value");
    expect(container.textContent).not.toContain("Gemini recommended");
    expect(container.textContent).not.toContain("X".repeat(260));

    const geminiBadges = container.querySelectorAll('[title="Matches Gemini"]');
    expect(geminiBadges).toHaveLength(2);

    const tooltipRow = Array.from(
      container.querySelectorAll<HTMLElement>("div[title]"),
    ).find((row) => row.title.startsWith("Header Balance"));
    expect(tooltipRow).toBeTruthy();
    expect(tooltipRow?.title).toContain(".header-balance");

    const chooseButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Use this value"));
    expect(chooseButton).toBeTruthy();

    chooseButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushDashboardEffects();

    expect(sendBackground).toHaveBeenCalledWith({
      type: "RESOLVE_EXTRACTION_CHOICE",
      payload: {
        requestId: "choice-1",
        candidateId: "portfolio_value|.balance|account balance",
      },
    });
  });

  it("prompts to enable Safe Mode after extraction failure and persists the choice", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return {
            platformIds: ["mintos"],
            credentials: [
              {
                platformId: "mintos",
                safeModeEnabled: false,
                stealthModeEnabled: true,
              },
            ],
          };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "available" };
        case "UPDATE_PLATFORM_MODES":
          return { success: true };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_error",
        platformId: "mintos",
        platformName: "Mintos",
        runId: "run-42",
        state: "failed_extract",
        message: "Could not extract portfolio value or free cash",
      },
    });

    await flushDashboardEffects();

    expect(container.textContent).toContain("Enable Safe Mode?");
    expect(container.textContent).toContain(
      "Scraping could not read reliable values.",
    );
    expect(container.textContent).toContain("Mintos");

    const enableButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Enable Safe Mode"));
    expect(enableButton).toBeTruthy();

    enableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushDashboardEffects();

    expect(sendBackground).toHaveBeenCalledWith({
      type: "UPDATE_PLATFORM_MODES",
      payload: {
        platformId: "mintos",
        config: { safeModeEnabled: true },
      },
    });
    expect(container.textContent).not.toContain("Enable Safe Mode?");
  });

  it("does not prompt for Safe Mode when extraction fails on a platform already using it", async () => {
    sendBackground.mockImplementation(async (message: { type: string }) => {
      switch (message.type) {
        case "GET_LOCK_STATUS":
          return { locked: false, hasMasterPassword: false };
        case "GET_METRICS":
          return { metrics: [] };
        case "GET_CREDENTIAL_STATUS":
          return {
            platformIds: ["mintos"],
            credentials: [
              {
                platformId: "mintos",
                safeModeEnabled: true,
                stealthModeEnabled: true,
              },
            ],
          };
        case "GET_SETTINGS":
          return { settings: baseSettings() };
        case "GET_SYNC_STATUS":
          return { run: undefined };
        case "GET_GEMINI_STATUS":
          return { status: "available" };
        default:
          return {};
      }
    });

    const { App } = await import("../../src/dashboard/App.js");

    flushSync(() => {
      root.render(React.createElement(App));
    });

    await flushDashboardEffects();

    const listener = (
      chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as ((message: { type: string; payload: unknown }) => void);

    listener({
      type: "SYNC_PROGRESS",
      payload: {
        type: "platform_error",
        platformId: "mintos",
        platformName: "Mintos",
        runId: "run-42",
        state: "failed_extract",
      },
    });

    await flushDashboardEffects();

    expect(container.textContent).not.toContain("Enable Safe Mode?");
    expect(sendBackground).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "UPDATE_PLATFORM_MODES" }),
    );
  });
});
