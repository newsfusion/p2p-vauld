import { describe, expect, it, vi } from "vitest";
import {
  focusTabForManualAction,
  hideTabWindow,
  openTab,
  resolveNavigationAction,
  type BrowserTabPort,
} from "../../src/background/sync/tab-session.js";

function createTabPort(): BrowserTabPort {
  return {
    createWindow: async () =>
      ({
        tabs: [{ id: 11, windowId: 22 }],
      }) as chrome.windows.Window,
    updateWindow: async () => ({}) as chrome.windows.Window,
    getTab: async () => ({ id: 11, windowId: 22 }) as chrome.tabs.Tab,
    updateTab: async () => ({}) as chrome.tabs.Tab,
    reloadTab: async () => undefined,
    removeTab: async () => undefined,
    onTabUpdated: {
      addListener: () => undefined,
      removeListener: () => undefined,
    },
  };
}

describe("openTab", () => {
  it("opens an unfocused desktop-sized popup window when safe mode is disabled", async () => {
    const port = createTabPort();
    const createWindowSpy = vi.spyOn(port, "createWindow");
    const updateWindowSpy = vi.spyOn(port, "updateWindow");

    const tab = await openTab("https://example.com/login", false, port);

    expect(tab.id).toBe(11);
    expect(createWindowSpy).toHaveBeenCalledWith({
      url: "https://example.com/login",
      type: "popup",
      width: 1280,
      height: 900,
      focused: false,
    });
    expect(updateWindowSpy).not.toHaveBeenCalled();
  });

  it("opens a focused popup window when safe mode is enabled", async () => {
    const port = createTabPort();
    const createWindowSpy = vi.spyOn(port, "createWindow");

    const tab = await openTab("https://example.com/login", true, port);

    expect(tab.id).toBe(11);
    expect(createWindowSpy).toHaveBeenCalledWith({
      url: "https://example.com/login",
      type: "popup",
      width: 1280,
      height: 900,
      focused: true,
    });
  });

  it("throws when the popup window has no tabs", async () => {
    const port = createTabPort();
    port.createWindow = async () => ({ tabs: [] }) as unknown as chrome.windows.Window;

    await expect(openTab("https://example.com/login", false, port)).rejects.toThrow(
      "Failed to create sync window",
    );
  });
});

describe("hideTabWindow", () => {
  it("minimizes the tab window", async () => {
    const port = createTabPort();
    const updateWindowSpy = vi.spyOn(port, "updateWindow");

    await hideTabWindow(11, port);

    expect(updateWindowSpy).toHaveBeenCalledWith(22, { state: "minimized" });
  });

  it("swallows errors when the tab no longer exists", async () => {
    const port = createTabPort();
    port.getTab = async () => {
      throw new Error("No tab with id");
    };

    await expect(hideTabWindow(11, port)).resolves.toBeUndefined();
  });
});

describe("focusTabForManualAction", () => {
  it("restores a minimized popup window before focusing the tab", async () => {
    const port = createTabPort();
    const updateWindowSpy = vi.spyOn(port, "updateWindow");
    const updateTabSpy = vi.spyOn(port, "updateTab");

    await focusTabForManualAction(11, port);

    expect(updateWindowSpy).toHaveBeenNthCalledWith(1, 22, { state: "normal" });
    expect(updateWindowSpy).toHaveBeenNthCalledWith(2, 22, {
      focused: true,
      left: 100,
      top: 100,
    });
    expect(updateTabSpy).toHaveBeenCalledWith(11, { active: true });
  });

  it("reports failure instead of throwing when the tab no longer exists", async () => {
    const port = createTabPort();
    port.getTab = async () => {
      throw new Error("No tab with id");
    };

    await expect(focusTabForManualAction(11, port)).resolves.toBe(false);
  });

  it("reports success when the window was surfaced", async () => {
    const port = createTabPort();

    await expect(focusTabForManualAction(11, port)).resolves.toBe(true);
  });
});

describe("resolveNavigationAction", () => {
  it("returns navigate when URLs differ", () => {
    const action = resolveNavigationAction(
      "https://example.com/login",
      "https://example.com/dashboard",
      false,
    );

    expect(action).toBe("navigate");
  });

  it("returns none when URLs are equivalent and force reload is disabled", () => {
    const action = resolveNavigationAction(
      "https://debitum.investments/en/overview",
      "https://debitum.investments/en/overview",
      false,
    );

    expect(action).toBe("none");
  });

  it("returns reload when URLs are equivalent and force reload is enabled", () => {
    const action = resolveNavigationAction(
      "https://debitum.investments/en/overview",
      "https://debitum.investments/en/overview",
      true,
    );

    expect(action).toBe("reload");
  });
});
