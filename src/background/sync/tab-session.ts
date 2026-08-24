export interface BrowserTabPort {
  createWindow: (
    createData: chrome.windows.CreateData,
  ) => Promise<chrome.windows.Window | undefined>;
  updateWindow: (
    windowId: number,
    updateInfo: chrome.windows.UpdateInfo,
  ) => Promise<chrome.windows.Window>;
  getTab: (tabId: number) => Promise<chrome.tabs.Tab>;
  updateTab: (
    tabId: number,
    updateProperties: chrome.tabs.UpdateProperties,
  ) => Promise<chrome.tabs.Tab | undefined>;
  reloadTab: (tabId: number) => Promise<void>;
  removeTab: (tabId: number) => Promise<void>;
  onTabUpdated: Pick<
    typeof chrome.tabs.onUpdated,
    "addListener" | "removeListener"
  >;
}

export const chromeTabPort: BrowserTabPort = {
  createWindow: (...args) => chrome.windows.create(...args),
  updateWindow: (...args) => chrome.windows.update(...args),
  getTab: (...args) => chrome.tabs.get(...args),
  updateTab: (...args) => chrome.tabs.update(...args),
  reloadTab: (...args) => chrome.tabs.reload(...args),
  removeTab: (...args) => chrome.tabs.remove(...args),
  onTabUpdated: {
    addListener: (...args) => chrome.tabs.onUpdated.addListener(...args),
    removeListener: (...args) => chrome.tabs.onUpdated.removeListener(...args),
  },
};

const SYNC_POPUP_WIDTH = 1280;
const SYNC_POPUP_HEIGHT = 900;

export async function openTab(
  url: string,
  safeMode = false,
  port: BrowserTabPort = chromeTabPort,
): Promise<chrome.tabs.Tab> {
  const win = await port.createWindow({
    url,
    type: "popup",
    width: SYNC_POPUP_WIDTH,
    height: SYNC_POPUP_HEIGHT,
    focused: safeMode,
  });
  if (!win?.tabs || win.tabs.length === 0) {
    throw new Error("Failed to create sync window");
  }
  return win.tabs[0]!;
}

export async function hideTabWindow(
  tabId: number,
  port: BrowserTabPort = chromeTabPort,
): Promise<void> {
  try {
    const tab = await port.getTab(tabId);
    if (tab.windowId !== undefined) {
      await port.updateWindow(tab.windowId, { state: "minimized" });
    }
  } catch {
    // Tab or window may already be closed.
  }
}

function areUrlsEquivalent(
  currentUrl: string | undefined,
  targetUrl: string,
): boolean {
  if (!currentUrl) return false;

  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    return (
      current.origin === target.origin &&
      current.pathname === target.pathname &&
      current.search === target.search
    );
  } catch {
    return currentUrl === targetUrl;
  }
}

export function resolveNavigationAction(
  currentUrl: string | undefined,
  targetUrl: string,
  forceReloadOnEquivalent: boolean,
): "none" | "navigate" | "reload" {
  if (!areUrlsEquivalent(currentUrl, targetUrl)) {
    return "navigate";
  }
  return forceReloadOnEquivalent ? "reload" : "none";
}

export async function navigateTabToUrl(
  tabId: number,
  targetUrl: string,
  timeoutMs: number,
  options?: {
    forceReloadOnEquivalent?: boolean;
    port?: BrowserTabPort;
  },
): Promise<boolean> {
  const port = options?.port ?? chromeTabPort;
  const currentTab = await port.getTab(tabId);
  const action = resolveNavigationAction(
    currentTab.url,
    targetUrl,
    options?.forceReloadOnEquivalent ?? false,
  );
  if (action === "none") return false;

  if (action === "reload") {
    await port.reloadTab(tabId);
  } else {
    await port.updateTab(tabId, { url: targetUrl });
  }
  await waitForTabLoad(tabId, timeoutMs, port);
  return true;
}

export function waitForTabLoad(
  tabId: number,
  timeoutMs: number,
  port: BrowserTabPort = chromeTabPort,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        cleanup();
        reject(new Error("Tab load timeout"));
      }
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      port.onTabUpdated.removeListener(listener);
    }

    function listener(
      updatedTabId: number,
      changeInfo: chrome.tabs.OnUpdatedInfo,
    ): void {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        resolved = true;
        cleanup();
        resolve();
      }
    }

    port.onTabUpdated.addListener(listener);

    port.getTab(tabId)
      .then((tab) => {
        if (!resolved && tab.status === "complete") {
          resolved = true;
          cleanup();
          resolve();
        }
      })
      .catch((err) => {
        if (!resolved) {
          cleanup();
          reject(err);
        }
      });
  });
}

export async function closeTab(
  tabId: number,
  port: BrowserTabPort = chromeTabPort,
): Promise<void> {
  try {
    await port.removeTab(tabId);
  } catch {
    // Tab may already be closed.
  }
}

export async function getTabDiagnostics(
  tabId: number,
  port: BrowserTabPort = chromeTabPort,
): Promise<string> {
  try {
    const tab = await port.getTab(tabId);
    return `tabId=${tabId}, url=${tab.url ?? "unknown"}, status=${tab.status ?? "unknown"}`;
  } catch {
    return `tabId=${tabId}, tab no longer exists`;
  }
}

/**
 * Brings the platform's sync window back into view for a manual action.
 * Returns false when the tab/window could not be surfaced (usually because it
 * no longer exists), so the caller can tell the user instead of pointing them
 * at a tab that isn't there.
 */
export async function focusTabForManualAction(
  tabId: number,
  port: BrowserTabPort = chromeTabPort,
): Promise<boolean> {
  try {
    const tab = await port.getTab(tabId);
    if (tab.windowId) {
      await port.updateWindow(tab.windowId, { state: "normal" });
      await port.updateWindow(tab.windowId, {
        focused: true,
        left: 100,
        top: 100,
      });
    }
    await port.updateTab(tabId, { active: true });
    return true;
  } catch {
    // Tab may no longer exist.
    return false;
  }
}
