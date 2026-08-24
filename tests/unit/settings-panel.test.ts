import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PlatformId } from "../../src/shared/types/index.js";
import { useDashboardStore } from "../../src/dashboard/store.js";

async function defaultSendBackground(
  message: { type: string; payload?: unknown },
): Promise<unknown> {
  if (message.type === "GET_CREDENTIAL_STATUS") {
    return { platformIds: [] as PlatformId[] };
  }

  if (message.type === "GET_SETTINGS") {
    return {
      settings: {
        privacyModeEnabled: false,
        stealthModeEnabled: false,
        debugModeEnabled: false,
        parallelSyncEnabled: false,
        showTwoFactorManualActionDialog: false,
        disabledPlatformIds: [] as PlatformId[],
        language: "en",
        syncReminderDays: 7,
        autoLockEnabled: true,
        sessionTimeoutMinutes: 15,
        historyRetentionDays: 0,
        geminiActivationBannerDismissed: false,
      },
    };
  }

  if (message.type === "GET_CREDENTIAL_PREFILL") {
    return { username: "" };
  }

  if (message.type === "GET_CREDENTIAL_EDIT_PREFILL") {
    return { username: "" };
  }

  if (message.type === "GET_LOCK_STATUS") {
    return { locked: false, hasMasterPassword: false };
  }

  if (message.type === "GET_GEMINI_STATUS") {
    return { status: "unavailable" };
  }

  if (message.type === "SAVE_CREDENTIALS") {
    return { success: true };
  }

  if (message.type === "UPDATE_PLATFORM_MODES") {
    return { success: true };
  }

  if (message.type === "SAVE_SETTINGS") {
    return { success: true };
  }

  if (message.type === "SETUP_MASTER_PASSWORD") {
    return { success: true };
  }

  if (message.type === "DELETE_CREDENTIALS") {
    return { success: true };
  }

  if (message.type === "RESET_PLATFORM_SELECTORS") {
    return { success: true };
  }

  return {};
}

const sendBackgroundMock = vi.fn(defaultSendBackground);
const triggerGeminiDownloadMock = vi.fn();

vi.mock("../../src/shared/messages.js", () => ({
  sendBackground: sendBackgroundMock,
}));

vi.mock("../../src/shared/ai/gemini.js", () => ({
  triggerGeminiDownload: triggerGeminiDownloadMock,
}));

describe("SettingsPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  let SettingsPanel: typeof import("../../src/dashboard/components/SettingsPanel.js").SettingsPanel;

  beforeAll(async () => {
    ({ SettingsPanel } = await import("../../src/dashboard/components/SettingsPanel.js"));
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    sendBackgroundMock.mockClear();
    triggerGeminiDownloadMock.mockReset();
    triggerGeminiDownloadMock.mockImplementation(async (options?: {
      onStatusChange?: (status: string) => void;
    }) => {
      options?.onStatusChange?.("downloading");
      return { status: "downloading" };
    });
    useDashboardStore.setState({
      geminiStatus: null,
      geminiDownloadProgress: null,
      geminiDownloadError: null,
      geminiBannerDismissed: false,
      geminiSettingsFocusRequest: 0,
      isSyncing: false,
    });
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  function renderSettings(
    props: Parameters<typeof SettingsPanel>[0] = {},
  ): void {
    flushSync(() => {
      root.render(React.createElement(SettingsPanel, props));
    });
  }

  function inputValue(input: HTMLInputElement, value: string): void {
    const prototype = Object.getPrototypeOf(input) as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    valueSetter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function click(element: Element | null | undefined): void {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it("renders credential card before connected platforms", async () => {
    renderSettings();
    await flushAsyncWork();

    const credentialCard = container.querySelector('[data-testid="credential-card"]');
    const connectedCard = container.querySelector('[data-testid="connected-platforms-card"]');

    expect(credentialCard).toBeTruthy();
    expect(connectedCard).toBeTruthy();

    expect(
      credentialCard!.compareDocumentPosition(connectedCard!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("sets a master password from settings and enables the auto-lock defaults", async () => {
    renderSettings();
    await flushAsyncWork();

    const setupButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Set Master Password"),
    );
    expect(setupButton).toBeTruthy();
    click(setupButton);
    await flushAsyncWork();

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const inputs = dialog!.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="new-password"]',
    );
    inputValue(inputs[0]!, "x");
    inputValue(inputs[1]!, "x");
    await flushAsyncWork();
    expect(container.textContent).toContain("Very weak");

    Array.from(container.querySelectorAll("form")).at(-1)?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "SETUP_MASTER_PASSWORD",
      payload: { password: "x" },
    });
    expect(container.textContent).toContain("Auto-Lock");
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Auto-lock timeout"]')
        ?.value,
    ).toBe("15");
  });

  it("saves auto-lock enabled state separately from its timeout", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: true };
      }
      return defaultSendBackground(message);
    });

    renderSettings();
    await flushAsyncWork();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[role="switch"][aria-label="Enable Auto-Lock"]',
    );
    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    click(toggle);
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "SAVE_SETTINGS",
      payload: { autoLockEnabled: false },
    });
    expect(
      container.querySelector<HTMLSelectElement>('[aria-label="Auto-lock timeout"]')
        ?.value,
    ).toBe("15");
  });

  it("lays out credential and connected platform cards in the primary settings grid", async () => {
    renderSettings();
    await flushAsyncWork();

    const primaryGrid = container.querySelector('[data-testid="settings-primary-grid"]');
    const credentialCard = container.querySelector('[data-testid="credential-card"]');
    const connectedCard = container.querySelector('[data-testid="connected-platforms-card"]');

    expect(primaryGrid).toBeTruthy();
    // xl, not lg: below 1280px a half-width card is narrower than the
    // connected-platforms table's minimum width.
    expect(primaryGrid?.className).toContain("xl:grid-cols-2");
    expect(credentialCard?.parentElement).toBe(primaryGrid);
    expect(connectedCard?.parentElement).toBe(primaryGrid);
  });

  it("starts with no platform selected and blocks saving until a platform is chosen", async () => {
    renderSettings();
    await flushAsyncWork();

    const platformInput = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    const submitButton = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(platformInput).toBeTruthy();
    expect(platformInput?.value).toBe("");
    expect(submitButton?.disabled).toBe(true);

    const form = container.querySelector("form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flushAsyncWork();

    expect(sendBackgroundMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SAVE_CREDENTIALS" }),
    );
  });

  it("shows configured platforms as collapsed accessible list items", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: ["mintos", "peerberry"] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            lastUsedCredentialEmail: "",
            language: "en",
          },
        };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const connectedCard = container.querySelector('[data-testid="connected-platforms-card"]');
    expect(connectedCard?.textContent).toContain("2 connected");
    expect(connectedCard?.textContent).toContain("Mintos");
    expect(connectedCard?.textContent).toContain("PeerBerry");
    expect(connectedCard?.textContent).not.toContain("Debitum");
    expect(connectedCard?.querySelector("table")).toBeNull();
    expect(
      connectedCard
        ?.querySelector<HTMLButtonElement>('button[aria-label="Show details for Mintos"]')
        ?.getAttribute("aria-expanded"),
    ).toBe("false");
    expect(connectedCard?.textContent).not.toContain("Login behavior");
    expect(
      connectedCard
        ?.querySelector<HTMLButtonElement>('button[aria-label="Deactivate Mintos"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("resets learned extraction selectors from expanded platform details", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: ["mintos"] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }

      if (message.type === "RESET_PLATFORM_SELECTORS") {
        return { success: true };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for Mintos"]',
      ),
    );
    await flushAsyncWork();

    const resetButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reset learned selections for Mintos"]',
    );
    click(resetButton);
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RESET_PLATFORM_SELECTORS",
        payload: { platformId: "mintos" },
      }),
    );
    expect(container.textContent).toContain(
      "Learned extraction selectors reset for Mintos.",
    );
  });

  it("shows the remembered value selection and forgets a single signal", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: ["mintos"] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }

      if (message.type === "GET_SELECTOR_PROFILES") {
        return {
          success: true,
          profiles: [
            {
              platformId: "mintos" as PlatformId,
              signalKey: "portfolio_value",
              selector: "#account-balance",
              confidence: 1,
              source: "user",
              learnedAt: "2026-07-18T10:00:00.000Z",
              failureCount: 0,
            },
          ],
        };
      }

      if (message.type === "RESET_PLATFORM_SELECTORS") {
        return { success: true };
      }

      return {};
    });

    renderSettings();

    for (let attempt = 0; attempt < 20; attempt++) {
      await flushAsyncWork();
      if (
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="Show details for Mintos"]',
        )
      ) {
        break;
      }
    }
    expect(
      container.querySelector('[data-testid="selector-profiles-mintos"]'),
    ).toBeNull();

    click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for Mintos"]',
      ),
    );
    await flushAsyncWork();

    const profilesRow = container.querySelector(
      '[data-testid="selector-profiles-mintos"]',
    );
    expect(profilesRow?.textContent).toContain("Remembered value selection");
    expect(profilesRow?.textContent).toContain("Portfolio value");
    expect(profilesRow?.textContent).not.toContain("#account-balance");

    const forgetButton = container.querySelector<HTMLButtonElement>(
      'button[title="Forget remembered Portfolio value selection"]',
    );
    click(forgetButton);
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RESET_PLATFORM_SELECTORS",
        payload: { platformId: "mintos", signalKey: "portfolio_value" },
      }),
    );
    expect(container.textContent).toContain(
      "Remembered Portfolio value selection reset for Mintos.",
    );
  });

  it("reloads the remembered value selection after a sync finished", async () => {
    let profileSignalKey = "portfolio_value";
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: ["mintos"] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }

      if (message.type === "GET_SELECTOR_PROFILES") {
        return {
          success: true,
          profiles: [
            {
              platformId: "mintos" as PlatformId,
              signalKey: profileSignalKey,
              selector: "#account-balance",
              confidence: 1,
              source: "user",
              learnedAt: "2026-07-18T10:00:00.000Z",
              failureCount: 0,
            },
          ],
        };
      }

      return {};
    });

    renderSettings();

    for (let attempt = 0; attempt < 20; attempt++) {
      await flushAsyncWork();
      if (
        container.querySelector<HTMLButtonElement>(
          'button[aria-label="Show details for Mintos"]',
        )
      ) {
        break;
      }
    }
    click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for Mintos"]',
      ),
    );
    await flushAsyncWork();
    expect(
      container.querySelector('[data-testid="selector-profiles-mintos"]')
        ?.textContent,
    ).toContain("Portfolio value");

    profileSignalKey = "free_cash";
    flushSync(() => {
      useDashboardStore.setState({ isSyncing: true });
    });
    await flushAsyncWork();
    expect(
      container.querySelector('[data-testid="selector-profiles-mintos"]')
        ?.textContent,
    ).toContain("Portfolio value");

    flushSync(() => {
      useDashboardStore.setState({ isSyncing: false });
    });
    for (let attempt = 0; attempt < 20; attempt++) {
      await flushAsyncWork();
      if (
        container
          .querySelector('[data-testid="selector-profiles-mintos"]')
          ?.textContent?.includes("Free cash")
      ) {
        break;
      }
    }

    expect(
      container.querySelector('[data-testid="selector-profiles-mintos"]')
        ?.textContent,
    ).toContain("Free cash");
  });

  it("filters combobox options and saves credentials for selected platform", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: [] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }

      if (message.type === "GET_CREDENTIAL_PREFILL") {
        return { username: "" };
      }

      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: false };
      }

      if (message.type === "SAVE_CREDENTIALS") {
        return { success: true };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const platformInput = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(platformInput).toBeTruthy();

    platformInput?.focus();
    inputValue(platformInput!, "peer");
    await flushAsyncWork();

    const optionButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="option"]'),
    );
    expect(optionButtons.map((button) => button.textContent?.trim())).toContain("PeerBerry");
    expect(optionButtons.map((button) => button.textContent?.trim())).not.toContain("Mintos");

    const peerberryOption = optionButtons.find(
      (button) => button.textContent?.trim() === "PeerBerry",
    );
    click(peerberryOption);

    const usernameInput = container.querySelector<HTMLInputElement>("#username");
    const passwordInput = container.querySelector<HTMLInputElement>("#password");
    expect(usernameInput).toBeTruthy();
    expect(passwordInput).toBeTruthy();

    inputValue(usernameInput!, "user@example.com");
    inputValue(passwordInput!, "top-secret");

    const form = container.querySelector("form");
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SAVE_CREDENTIALS",
        payload: expect.objectContaining({
          platformId: "peerberry",
          config: {
            safeModeEnabled: false,
            stealthModeEnabled: true,
          },
        }),
      }),
    );
  });

  it("prefills username from session-backed credential prefill", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: [] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }

      if (message.type === "GET_CREDENTIAL_PREFILL") {
        return { username: "session@example.com" };
      }

      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: false };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const usernameInput = container.querySelector<HTMLInputElement>("#username");
    expect(usernameInput?.value).toBe("session@example.com");
  });

  it("shows advanced mode defaults from platform catalog and global settings", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: [] as PlatformId[], credentials: [] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            lastUsedCredentialEmail: "",
            language: "en",
          },
        };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const platformInput = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    platformInput?.focus();
    inputValue(platformInput!, "debitum");
    await flushAsyncWork();

    const debitumOption = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="option"]'),
    ).find((button) => button.textContent?.trim() === "Debitum");
    click(debitumOption);
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Toggle advanced settings"]'));
    await flushAsyncWork();

    const safeSwitch = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Safe Mode"]',
    );
    const stealthSwitch = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stealth Mode"]',
    );

    expect(safeSwitch?.getAttribute("aria-checked")).toBe("false");
    expect(stealthSwitch?.getAttribute("aria-checked")).toBe("false");
  });

  it("keeps advanced switch thumbs anchored inside their tracks", async () => {
    sendBackgroundMock.mockImplementation(defaultSendBackground);

    renderSettings();
    await flushAsyncWork();

    click(container.querySelector<HTMLButtonElement>('button[aria-label="Toggle advanced settings"]'));
    await flushAsyncWork();

    const safeThumb = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Safe Mode"]',
    )?.querySelector("span");
    const stealthSwitch = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Stealth Mode"]',
    );
    const stealthThumb = stealthSwitch?.querySelector("span");

    expect(safeThumb?.className).toContain("left-1");
    expect(safeThumb?.className).toContain("translate-x-0");
    expect(stealthThumb?.className).toContain("left-1");
    expect(stealthThumb?.className).toContain("translate-x-0");
    expect(stealthThumb?.className).not.toContain("translate-x-6");
  });

  it("describes safe mode and stealth mode with their separated behavior", async () => {
    renderSettings();
    await flushAsyncWork();

    click(container.querySelector<HTMLButtonElement>('button[aria-label="Toggle advanced settings"]'));
    await flushAsyncWork();

    expect(container.textContent).toContain(
      "Opens the sync window in the foreground so you can watch the login.",
    );
    expect(container.textContent).toContain(
      "Simulates human typing and adds human-paced pauses around login actions.",
    );
  });

  it("uses a muted privacy notice tint instead of the solid accent color", async () => {
    renderSettings();
    await flushAsyncWork();

    const privacyNotice = container.querySelector('[data-testid="privacy-notice"]');

    expect(privacyNotice?.className).toContain("bg-primary/10");
    expect(privacyNotice?.className).not.toContain("bg-accent");
  });

  it("loads existing platform mode overrides when editing", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return {
          platformIds: ["mintos"] as PlatformId[],
          credentials: [
            {
              platformId: "mintos",
              safeModeEnabled: true,
              stealthModeEnabled: false,
            },
          ],
        };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            lastUsedCredentialEmail: "",
            language: "en",
          },
        };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for Mintos"]',
      ),
    );
    await flushAsyncWork();
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Edit Mintos"]'));
    click(container.querySelector<HTMLButtonElement>('button[aria-label="Toggle advanced settings"]'));
    await flushAsyncWork();

    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Safe Mode"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Stealth Mode"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("shows mode summaries and exposes mode switches in platform details", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return {
          platformIds: ["mintos", "peerberry"] as PlatformId[],
          credentials: [
            {
              platformId: "mintos",
              safeModeEnabled: true,
              stealthModeEnabled: true,
            },
            {
              platformId: "peerberry",
              safeModeEnabled: false,
              stealthModeEnabled: false,
            },
          ],
        };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            lastUsedCredentialEmail: "",
            language: "en",
          },
        };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const connectedCard = container.querySelector('[data-testid="connected-platforms-card"]');
    expect(connectedCard?.textContent).toContain("Safe");
    expect(connectedCard?.textContent).toContain("Stealth");
    expect(connectedCard?.textContent).not.toContain("Standard");
    expect(
      connectedCard?.querySelector('button[aria-label="Toggle Safe Mode for Mintos"]'),
    ).toBeNull();

    click(
      connectedCard?.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for Mintos"]',
      ),
    );
    click(
      connectedCard?.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for PeerBerry"]',
      ),
    );
    await flushAsyncWork();

    expect(
      connectedCard
        ?.querySelector<HTMLButtonElement>('button[aria-label="Toggle Safe Mode for Mintos"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      connectedCard
        ?.querySelector<HTMLButtonElement>('button[aria-label="Toggle Stealth Mode for PeerBerry"]')
        ?.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("toggles connected platform modes without resaving credentials", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return {
          platformIds: ["mintos"] as PlatformId[],
          credentials: [
            {
              platformId: "mintos",
              safeModeEnabled: false,
              stealthModeEnabled: false,
            },
          ],
        };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            lastUsedCredentialEmail: "",
            language: "en",
          },
        };
      }

      if (message.type === "UPDATE_PLATFORM_MODES") {
        return { success: true };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for Mintos"]',
      ),
    );
    await flushAsyncWork();

    const safeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle Safe Mode for Mintos"]',
    );
    const stealthButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle Stealth Mode for Mintos"]',
    );
    expect(safeButton?.getAttribute("aria-checked")).toBe("false");
    expect(stealthButton?.getAttribute("aria-checked")).toBe("false");

    click(safeButton);
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "UPDATE_PLATFORM_MODES",
      payload: {
        platformId: "mintos",
        config: { safeModeEnabled: true },
      },
    });
    expect(sendBackgroundMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "SAVE_CREDENTIALS" }),
    );
    expect(
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Toggle Safe Mode for Mintos"]')
        ?.getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("prefills the stored username, clears password, and shows edit mode when clicking edit", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: ["mintos"] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            lastUsedCredentialEmail: "",
            language: "en",
          },
        };
      }

      if (message.type === "GET_CREDENTIAL_PREFILL") {
        return { username: "" };
      }

      if (message.type === "GET_CREDENTIAL_EDIT_PREFILL") {
        return { username: "old@example.test" };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const passwordInput = container.querySelector<HTMLInputElement>("#password");
    inputValue(passwordInput!, "do-not-keep-this");

    click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for Mintos"]',
      ),
    );
    await flushAsyncWork();

    const editButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Mintos"]',
    );
    click(editButton);

    await flushAsyncWork();

    const platformInput = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    const usernameInput = container.querySelector<HTMLInputElement>("#username");
    const credentialCard = container.querySelector('[data-testid="credential-card"]');
    expect(platformInput?.value).toBe("Mintos");
    expect(usernameInput?.value).toBe("old@example.test");
    expect(passwordInput?.value).toBe("");
    expect(sendBackgroundMock).toHaveBeenCalledWith({
      type: "GET_CREDENTIAL_EDIT_PREFILL",
      payload: { platformId: "mintos" },
    });
    expect(credentialCard?.textContent).toContain("Edit Mintos");
    expect(credentialCard?.textContent).toContain(
      "Update the credentials and login behavior for this platform.",
    );
    expect(
      credentialCard?.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.textContent,
    ).toBe("Save changes");
    expect(document.activeElement).toBe(usernameInput);
  });

  it("deactivates a configured platform and updates active platform callback", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: ["mintos"] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
            language: "en",
          },
        };
      }

      if (message.type === "GET_CREDENTIAL_PREFILL") {
        return { username: "" };
      }

      if (message.type === "SAVE_SETTINGS") {
        return { success: true };
      }

      return {};
    });

    const onConfiguredPlatformsChange = vi.fn();

    flushSync(() => {
      root.render(
        React.createElement(SettingsPanel, {
          onConfiguredPlatformsChange,
        }),
      );
    });

    await flushAsyncWork();

    expect(onConfiguredPlatformsChange).toHaveBeenCalledWith(["mintos"], []);

    const deactivateButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Deactivate Mintos"]',
    );
    expect(deactivateButton).toBeTruthy();
    click(deactivateButton);

    await flushAsyncWork();
    await flushAsyncWork();

    expect(onConfiguredPlatformsChange).toHaveBeenLastCalledWith([], ["mintos"]);

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SAVE_SETTINGS",
        payload: { disabledPlatformIds: ["mintos"] },
      }),
    );
  });

  it("loads and saves sync reminder days", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: [] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: [] as PlatformId[],
            lastUsedCredentialEmail: "",
            language: "en",
            syncReminderDays: 14,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }

      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: false };
      }

      if (message.type === "SAVE_SETTINGS") {
        return { success: true };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const reminderInput = container.querySelector<HTMLInputElement>(
      'input[aria-label="Sync Reminder Days"]',
    );
    expect(reminderInput).toBeTruthy();
    expect(reminderInput?.value).toBe("14");
    expect(reminderInput?.parentElement?.textContent).toContain("days");

    inputValue(reminderInput!, "21");
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SAVE_SETTINGS",
        payload: { syncReminderDays: 21 },
      }),
    );
  });

  it("loads and saves parallel sync setting", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: [] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            parallelSyncEnabled: true,
            showTwoFactorManualActionDialog: false,
            disabledPlatformIds: [] as PlatformId[],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }

      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: false };
      }

      if (message.type === "SAVE_SETTINGS") {
        return { success: true };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="parallel-sync-toggle"]',
    );
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    click(toggle);
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SAVE_SETTINGS",
        payload: { parallelSyncEnabled: false },
      }),
    );
  });

  it("loads and saves the 2FA dashboard prompt setting", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: [] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: false,
            debugModeEnabled: false,
            parallelSyncEnabled: false,
            showTwoFactorManualActionDialog: false,
            disabledPlatformIds: [] as PlatformId[],
            language: "en",
            syncReminderDays: 7,
            sessionTimeoutMinutes: 0,
            historyRetentionDays: 0,
            geminiActivationBannerDismissed: false,
          },
        };
      }

      if (message.type === "GET_LOCK_STATUS") {
        return { locked: false, hasMasterPassword: false };
      }

      if (message.type === "SAVE_SETTINGS") {
        return { success: true };
      }

      return {};
    });

    renderSettings();
    await flushAsyncWork();

    const toggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="two-factor-dashboard-prompt-toggle"]',
    );
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute("aria-checked")).toBe("false");

    click(toggle);
    await flushAsyncWork();

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SAVE_SETTINGS",
        payload: { showTwoFactorManualActionDialog: true },
      }),
    );
  });

  it("deletes credentials and cleans disabled platform settings", async () => {
    sendBackgroundMock.mockImplementation(async (message) => {
      if (message.type === "GET_CREDENTIAL_STATUS") {
        return { platformIds: ["mintos"] as PlatformId[] };
      }

      if (message.type === "GET_SETTINGS") {
        return {
          settings: {
            privacyModeEnabled: false,
            stealthModeEnabled: true,
            debugModeEnabled: false,
            disabledPlatformIds: ["mintos"] as PlatformId[],
            lastUsedCredentialEmail: "",
            language: "en",
          },
        };
      }

      if (message.type === "SAVE_SETTINGS") {
        return { success: true };
      }

      if (message.type === "DELETE_CREDENTIALS") {
        return { success: true };
      }

      return {};
    });

    function Wrapper() {
      const [platformIds, setPlatformIds] = React.useState<PlatformId[]>([]);

      return React.createElement(
        React.Fragment,
        {},
        React.createElement(
          "div",
          { "data-testid": "configured-count" },
          String(platformIds.length),
        ),
        React.createElement(SettingsPanel, {
          onConfiguredPlatformsChange: (next) => setPlatformIds(next),
        }),
      );
    }

    flushSync(() => {
      root.render(React.createElement(Wrapper));
    });

    await flushAsyncWork();

    expect(
      container.querySelector('[data-testid="configured-count"]')?.textContent,
    ).toBe("0");

    click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Show details for Mintos"]',
      ),
    );
    await flushAsyncWork();

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Mintos"]',
    );
    click(deleteButton);

    await flushAsyncWork();

    const connectedCard = container.querySelector('[data-testid="connected-platforms-card"]');
    expect(connectedCard?.textContent).toContain("No connected platforms yet.");

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DELETE_CREDENTIALS",
        payload: { platformId: "mintos" },
      }),
    );

    expect(sendBackgroundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "SAVE_SETTINGS",
        payload: { disabledPlatformIds: [] },
      }),
    );
  });

  it("renders Gemini Nano status from shared dashboard state", async () => {
    useDashboardStore.setState({ geminiStatus: "available" });

    renderSettings();
    await flushAsyncWork();

    expect(container.textContent).toContain("Gemini Nano");
    expect(container.textContent).toContain("Active");
    expect(sendBackgroundMock).not.toHaveBeenCalledWith({ type: "GET_GEMINI_STATUS" });
  });

  it("requests Gemini Nano download from the dashboard click", async () => {
    useDashboardStore.setState({ geminiStatus: "downloadable" });

    renderSettings();
    await flushAsyncWork();

    const downloadButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Download Gemini Nano"),
    );
    expect(downloadButton).toBeTruthy();

    click(downloadButton);
    await flushAsyncWork();

    expect(triggerGeminiDownloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        broadcast: true,
        onProgress: expect.any(Function),
        onStatusChange: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(sendBackgroundMock).not.toHaveBeenCalledWith({ type: "TRIGGER_GEMINI_DOWNLOAD" });
    expect(container.textContent).toContain("Downloading...");
  });

  it("shows an indeterminate Gemini Nano progress bar when download has no progress", async () => {
    useDashboardStore.setState({
      geminiStatus: "downloading",
      geminiDownloadProgress: null,
    });

    renderSettings();
    await flushAsyncWork();

    const progressBar = container.querySelector<HTMLElement>(
      '[role="progressbar"][aria-label="Gemini Nano download progress"]',
    );
    const progressIndicator = progressBar?.firstElementChild as HTMLElement | null;
    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Retry download"),
    );

    expect(container.textContent).toContain("Downloading...");
    expect(container.textContent).toContain("Waiting for progress...");
    expect(progressBar).toBeTruthy();
    expect(progressBar?.getAttribute("aria-valuenow")).toBeNull();
    expect(progressIndicator?.className).toContain("w-1/3");
    expect(progressIndicator?.className).toContain("animate-pulse");
    expect(retryButton).toBeTruthy();
    expect(retryButton?.className).toContain("cursor-pointer");
  });

  it("retries a stuck Gemini Nano download from the downloading state with immediate feedback", async () => {
    useDashboardStore.setState({
      geminiStatus: "downloading",
      geminiDownloadProgress: null,
    });
    let resolveDownload: ((value: { status: string }) => void) | undefined;
    triggerGeminiDownloadMock.mockImplementation(async (options?: {
      onStatusChange?: (status: string) => void;
    }) => {
      options?.onStatusChange?.("downloading");
      return new Promise((resolve) => {
        resolveDownload = resolve;
      });
    });

    renderSettings();
    await flushAsyncWork();

    const retryButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Retry download"),
    );
    expect(retryButton).toBeTruthy();

    click(retryButton);
    await flushAsyncWork();

    expect(container.textContent).toContain("Retrying...");
    expect(triggerGeminiDownloadMock).toHaveBeenCalledWith(
      expect.objectContaining({
        broadcast: true,
        onProgress: expect.any(Function),
        onStatusChange: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(sendBackgroundMock).not.toHaveBeenCalledWith({ type: "TRIGGER_GEMINI_DOWNLOAD" });

    resolveDownload?.({ status: "downloading" });
    await flushAsyncWork();
  });

  it("shows Gemini Nano download percentage from normalized fractional progress", async () => {
    useDashboardStore.setState({
      geminiStatus: "downloading",
      geminiDownloadProgress: { loaded: 0.42, total: 1 },
    });

    renderSettings();
    await flushAsyncWork();

    const progressBar = container.querySelector<HTMLElement>(
      '[role="progressbar"][aria-label="Gemini Nano download progress"]',
    );

    expect(container.textContent).toContain("Downloading... 42%");
    expect(progressBar?.getAttribute("aria-valuenow")).toBe("42");
  });

  it("shows a Gemini Nano download error received from the shared dashboard state", async () => {
    useDashboardStore.setState({ geminiStatus: "downloadable" });

    renderSettings();
    await flushAsyncWork();

    useDashboardStore.getState().setGeminiDownloadError("download failed");
    await flushAsyncWork();

    expect(container.textContent).toContain("download failed");
  });

  it("scrolls directly to Gemini Nano when requested from shared dashboard state", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    try {
      useDashboardStore.setState({ geminiSettingsFocusRequest: 1 });
      renderSettings();
      await flushAsyncWork();

      expect(scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "start",
      });
    } finally {
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it("shows Chrome Prompt API setup guidance when Gemini Nano is unsupported", async () => {
    useDashboardStore.setState({ geminiStatus: "api_not_supported" });

    renderSettings();
    await flushAsyncWork();

    expect(container.textContent).toContain("chrome://flags/#optimization-guide-on-device-model");
    expect(container.textContent).toContain("chrome://flags/#prompt-api-for-gemini-nano");
    expect(container.textContent).toContain("chrome://on-device-internals");
  });
});
