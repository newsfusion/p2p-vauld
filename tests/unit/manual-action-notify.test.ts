import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const focusTabForManualActionMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../src/background/sync/tab-session.js", () => ({
  focusTabForManualAction: (...args: unknown[]) =>
    focusTabForManualActionMock(...args),
}));

describe("manual action notifications", () => {
  beforeEach(() => {
    vi.resetModules();
    focusTabForManualActionMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a notification and stores tabId for click-to-focus", async () => {
    const create = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(true);
    const getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);

    vi.stubGlobal("chrome", {
      runtime: { getURL },
      notifications: { create, clear },
    });

    const {
      notifyManualAction,
      focusTabForNotification,
      clearManualActionNotification,
    } = await import("../../src/background/sync/manual-action-notify.js");

    const notificationId = await notifyManualAction("Estateguru", "2fa", 42);

    expect(notificationId).toBeDefined();
    expect(create).toHaveBeenCalledWith(
      notificationId,
      expect.objectContaining({
        type: "basic",
        iconUrl: "chrome-extension://test/icons/icon128.png",
        title: "Action required: Estateguru",
        message: "Enter your 2FA code to continue the sync",
      }),
    );

    await focusTabForNotification(notificationId!);
    expect(focusTabForManualActionMock).toHaveBeenCalledWith(42);

    await clearManualActionNotification(notificationId);
    expect(clear).toHaveBeenCalledWith(notificationId);
    await focusTabForNotification(notificationId!);
    expect(focusTabForManualActionMock).toHaveBeenCalledTimes(1);
  });

  it("uses captcha-specific notification copy", async () => {
    const create = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal("chrome", {
      runtime: { getURL: (path: string) => path },
      notifications: { create, clear: vi.fn().mockResolvedValue(true) },
    });

    const { notifyManualAction } = await import(
      "../../src/background/sync/manual-action-notify.js"
    );

    await notifyManualAction("Mintos", "captcha", 7);

    expect(create).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        message: "Solve the security challenge in the opened tab",
      }),
    );
  });

  it("no-ops when chrome.notifications is unavailable", async () => {
    vi.stubGlobal("chrome", undefined);

    const { notifyManualAction, focusTabForNotification } = await import(
      "../../src/background/sync/manual-action-notify.js"
    );

    const notificationId = await notifyManualAction("Estateguru", "2fa", 42);
    expect(notificationId).toBeUndefined();

    await focusTabForNotification("missing-id");
    expect(focusTabForManualActionMock).not.toHaveBeenCalled();
  });
});
