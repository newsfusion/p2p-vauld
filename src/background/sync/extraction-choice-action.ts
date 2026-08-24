import type {
  ExtractionCandidate,
  ExtractionChoiceRequest,
  ExtractionChoiceSignalKey,
  PlatformCatalogEntry,
  SyncEvent,
} from "../../shared/types/index.js";
import { createLogger } from "../../shared/logger.js";
import { getErrorMessage } from "../../shared/error-utils.js";
import { CancelledError, throwIfAborted } from "./cancellation.js";
import { RUNTIME_NAMES } from "../../shared/runtime-names.js";

export const PENDING_CHOICE_SESSION_KEY = RUNTIME_NAMES.pendingChoice;
const log = createLogger("extraction-choice-action");

export class ExtractionChoiceTimeoutError extends Error {
  constructor(message = "Extraction choice timeout") {
    super(message);
    this.name = "ExtractionChoiceTimeoutError";
  }
}

interface PendingExtractionChoice {
  resolve: (candidateId: string) => void;
}

const pendingChoices = new Map<string, PendingExtractionChoice>();

export async function persistPendingExtractionChoice(
  request: ExtractionChoiceRequest,
): Promise<void> {
  await chrome.storage.session.set({ [PENDING_CHOICE_SESSION_KEY]: request });
}

export async function clearPersistedPendingExtractionChoice(): Promise<void> {
  await chrome.storage.session.remove(PENDING_CHOICE_SESSION_KEY);
}

export async function getPersistedPendingExtractionChoice(): Promise<
  ExtractionChoiceRequest | undefined
> {
  const result = await chrome.storage.session.get(PENDING_CHOICE_SESSION_KEY);
  const choice = result[PENDING_CHOICE_SESSION_KEY] as
    | ExtractionChoiceRequest
    | undefined;
  if (!choice) return undefined;
  if (new Date(choice.expiresAt).getTime() <= Date.now()) {
    await clearPersistedPendingExtractionChoice();
    return undefined;
  }
  return choice;
}

export async function resolvePendingExtractionChoice(
  requestId: string,
  candidateId: string,
): Promise<boolean> {
  const pending = pendingChoices.get(requestId);
  if (!pending) return false;
  pendingChoices.delete(requestId);
  pending.resolve(candidateId);
  try {
    await clearPersistedPendingExtractionChoice();
  } catch (error) {
    log.warn("Failed to clear persisted extraction choice", {
      error: getErrorMessage(error),
      requestId,
    });
  }
  return true;
}

async function defaultOpenDashboard(): Promise<void> {
  const url = chrome.runtime.getURL("dashboard.html");
  const existingTabs = await chrome.tabs.query({ url: `${url}*` });
  const existing = existingTabs.find(
    (tab) => tab.id !== undefined && tab.windowId !== undefined,
  );

  if (existing?.id !== undefined && existing.windowId !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url });
}

export async function waitForExtractionChoice({
  platform,
  runId,
  signalKey,
  candidates,
  onEvent,
  timeoutMs,
  signal,
  openDashboard = defaultOpenDashboard,
}: {
  platform: PlatformCatalogEntry;
  runId: string;
  signalKey: ExtractionChoiceSignalKey;
  candidates: ExtractionCandidate[];
  onEvent: (event: SyncEvent) => void;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  openDashboard?: () => Promise<void>;
}): Promise<string> {
  const requestId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
  const choiceRequest: ExtractionChoiceRequest = {
    requestId,
    runId,
    platformId: platform.id,
    platformName: platform.name,
    signalKey,
    candidates,
    expiresAt,
  };

  await openDashboard();
  await persistPendingExtractionChoice(choiceRequest);

  onEvent({
    type: "extraction_choice_required",
    platformId: platform.id,
    platformName: platform.name,
    runId,
    requestId,
    signalKey,
    candidates,
    expiresAt,
    message: "Select the correct extracted value",
  });

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingChoices.delete(requestId);
      signal?.removeEventListener("abort", abort);
      void clearPersistedPendingExtractionChoice();
      reject(new ExtractionChoiceTimeoutError());
    }, timeoutMs);

    function abort() {
      pendingChoices.delete(requestId);
      clearTimeout(timeout);
      void clearPersistedPendingExtractionChoice();
      reject(new CancelledError("Extraction choice cancelled"));
    }

    if (signal) {
      try {
        throwIfAborted(signal);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
        return;
      }
      signal.addEventListener("abort", abort, { once: true });
    }

    pendingChoices.set(requestId, {
      resolve: (candidateId) => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        resolve(candidateId);
      },
    });
  });
}
