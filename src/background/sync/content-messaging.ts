import { getTabDiagnostics } from "./tab-session.js";
import { getErrorMessage } from "../../shared/error-utils.js";

export interface ContentMessagingPort {
  executeScript: (
    injection: chrome.scripting.ScriptInjection<unknown[], unknown>,
  ) => Promise<chrome.scripting.InjectionResult<unknown>[]>;
  sendMessage: (tabId: number, message: object) => Promise<unknown>;
}

export const chromeContentMessagingPort: ContentMessagingPort = {
  executeScript: (...args) => chrome.scripting.executeScript(...args),
  sendMessage: (...args) => chrome.tabs.sendMessage(...args),
};

async function injectContentScript(
  tabId: number,
  port: ContentMessagingPort = chromeContentMessagingPort,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    throwIfAborted(signal);
    await port.executeScript({
      target: { tabId },
      files: ["src/content/index.js"],
    });
    await delay(300, signal);
    return true;
  } catch {
    return false;
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    throw reason instanceof Error ? reason : new Error("Content message aborted");
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Content message aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Content message aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function combineSignals(
  first: AbortSignal,
  second?: AbortSignal,
): AbortSignal {
  if (!second) return first;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([first, second]);
  }
  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  if (first.aborted) abort(first);
  if (second.aborted) abort(second);
  first.addEventListener("abort", () => abort(first), { once: true });
  second.addEventListener("abort", () => abort(second), { once: true });
  return controller.signal;
}

export async function sendToTab<T>(
  tabId: number,
  message: object,
  port: ContentMessagingPort = chromeContentMessagingPort,
  signal?: AbortSignal,
): Promise<T> {
  const msgType = (message as { type?: string }).type ?? "UNKNOWN";
  try {
    throwIfAborted(signal);
    const response = await port.sendMessage(tabId, message);
    throwIfAborted(signal);
    return response as T;
  } catch (err) {
    throwIfAborted(signal);
    const originalMsg = getErrorMessage(err);

    if (originalMsg.includes("Could not establish connection")) {
      const injected = await injectContentScript(tabId, port, signal);
      throwIfAborted(signal);
      if (injected) {
        try {
          throwIfAborted(signal);
          const retryResponse = await port.sendMessage(tabId, message);
          throwIfAborted(signal);
          return retryResponse as T;
        } catch {
          // Fall through to diagnostic error.
        }
      }
    }

    const diag = await getTabDiagnostics(tabId);

    let classified: string;
    if (originalMsg.includes("Could not establish connection")) {
      classified = `Content script not reachable (${msgType}): No listener on tab. ${diag}. The content script may not be injected yet, or the page navigated and destroyed it.`;
    } else if (
      originalMsg.includes("No tab with id") ||
      originalMsg.includes("No tab")
    ) {
      classified = `Tab closed (${msgType}): ${diag}`;
    } else {
      classified = `Message failed (${msgType}): ${originalMsg}. ${diag}`;
    }
    throw new Error(classified, { cause: err });
  }
}

export async function sendToTabWithTimeout<T>(
  tabId: number,
  message: object,
  timeoutMs: number,
  port?: ContentMessagingPort,
  signal?: AbortSignal,
): Promise<T> {
  const msgType = (message as { type?: string }).type ?? "UNKNOWN";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const combinedSignal = combineSignals(controller.signal, signal);

  try {
    timer = setTimeout(
      () =>
        controller.abort(
          new Error(
            `Content script response timeout after ${timeoutMs}ms (${msgType}): tabId=${tabId}`,
          ),
      ),
      timeoutMs,
    );
    return await Promise.race([
      sendToTab<T>(tabId, message, port, combinedSignal),
      new Promise<never>((_, reject) => {
        combinedSignal.addEventListener(
          "abort",
          () =>
            reject(
              combinedSignal.reason instanceof Error
                ? combinedSignal.reason
                : new Error(`Content script response timeout after ${timeoutMs}ms (${msgType}): tabId=${tabId}`),
            ),
          { once: true },
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
