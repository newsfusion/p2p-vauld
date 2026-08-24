import type { OffscreenControlMessage } from "../shared/offscreen-messages.js";
import { createSerialQueue } from "../shared/async-queue.js";
import { getErrorMessage } from "../shared/error-utils.js";

export type OffscreenLeaseKind = "db" | "sync";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
const leaseCounts: Record<OffscreenLeaseKind, number> = {
  db: 0,
  sync: 0,
};

const transitionQueue = createSerialQueue();

function totalLeaseCount(): number {
  return leaseCounts.db + leaseCounts.sync;
}

async function hasOffscreenDocument(): Promise<boolean> {
  if (typeof chrome.offscreen.hasDocument === "function") {
    return chrome.offscreen.hasDocument();
  }

  if (typeof chrome.runtime.getContexts === "function") {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
    const contexts = (await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
      documentUrls: [offscreenUrl],
    })) as chrome.runtime.ExtensionContext[];
    return contexts.length > 0;
  }

  return false;
}

function isAlreadyCreatedError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("Only a single offscreen document may be created") ||
    message.includes("already exists")
  );
}

function isNotFoundError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes("No current offscreen document") ||
    message.includes("No document") ||
    message.includes("offscreen document not found")
  );
}

async function createOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.LOCAL_STORAGE],
      justification: "Keep IndexedDB and sync heartbeat available during sync runs",
    });
  } catch (error: unknown) {
    if (!isAlreadyCreatedError(error)) throw error;
  }
}

async function closeOffscreenDocument(): Promise<void> {
  if (!(await hasOffscreenDocument())) return;

  try {
    await chrome.offscreen.closeDocument();
  } catch (error: unknown) {
    if (!isNotFoundError(error)) throw error;
  }
}

export async function acquireOffscreenLease(
  kind: OffscreenLeaseKind,
): Promise<() => Promise<void>> {
  await transitionQueue.enqueue(async () => {
    leaseCounts[kind] += 1;
    if (totalLeaseCount() === 1) {
      await createOffscreenDocument();
    }
  });

  let released = false;
  return async () => {
    if (released) return;
    released = true;

    await transitionQueue.enqueue(async () => {
      leaseCounts[kind] = Math.max(0, leaseCounts[kind] - 1);
      if (totalLeaseCount() === 0) {
        await closeOffscreenDocument();
      }
    });
  };
}

export async function withOffscreenLease<T>(
  kind: OffscreenLeaseKind,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireOffscreenLease(kind);
  try {
    return await operation();
  } finally {
    await release();
  }
}

export async function closeManagedOffscreenDocumentIfIdle(): Promise<void> {
  await transitionQueue.enqueue(async () => {
    if (totalLeaseCount() === 0) {
      await closeOffscreenDocument();
    }
  });
}

export async function sendOffscreenControlMessage(
  message: OffscreenControlMessage,
): Promise<void> {
  await chrome.runtime.sendMessage(message);
}

export async function startOffscreenHeartbeat(
  intervalMs = 20_000,
): Promise<void> {
  await sendOffscreenControlMessage({
    type: "OFFSCREEN_START_HEARTBEAT",
    payload: { intervalMs },
  });
}

export async function stopOffscreenHeartbeat(): Promise<void> {
  try {
    await sendOffscreenControlMessage({ type: "OFFSCREEN_STOP_HEARTBEAT" });
  } catch (error: unknown) {
    if (!(error instanceof Error) || !isNotFoundError(error)) {
      const message = getErrorMessage(error);
      if (!message.includes("Receiving end does not exist")) throw error;
    }
  }
}
