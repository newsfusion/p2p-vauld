import type {
  GeminiDownloadProgress,
  GeminiStatus,
} from "../types/index.js";
import {
  getPromptApiLanguageModel,
  PROMPT_API_TEXT_LANGUAGE_OPTIONS,
} from "./provider.js";
import { getErrorMessage } from "../error-utils.js";

interface GeminiStatusMessage {
  type: "GEMINI_STATUS_CHANGED";
  payload: { status: GeminiStatus };
}

interface GeminiProgressMessage {
  type: "GEMINI_DOWNLOAD_PROGRESS";
  payload: GeminiDownloadProgress;
}

interface GeminiDownloadFailedMessage {
  type: "GEMINI_DOWNLOAD_FAILED";
  payload: { error: string };
}

type GeminiBroadcastMessage =
  | GeminiStatusMessage
  | GeminiProgressMessage
  | GeminiDownloadFailedMessage;

export interface TriggerGeminiDownloadOptions {
  onProgress?: (progress: GeminiDownloadProgress) => void;
  onStatusChange?: (status: GeminiStatus) => void;
  onError?: (error: string) => void;
  broadcast?: boolean;
}

export interface TriggerGeminiDownloadResult {
  status: GeminiStatus;
  error?: string;
}

function normalizeGeminiStatus(value: unknown): GeminiStatus {
  switch (value) {
    case "available":
    case "downloadable":
    case "downloading":
    case "unavailable":
      return value;
    default:
      return "unavailable";
  }
}

function safeBroadcast(message: GeminiBroadcastMessage): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  try {
    const result = chrome.runtime.sendMessage(message);
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      (result as Promise<unknown>).catch(() => {});
    }
  } catch {
    // Ignore broadcast failures (e.g. no listener attached)
  }
}

function emitStatus(
  status: GeminiStatus,
  options: TriggerGeminiDownloadOptions,
): void {
  options.onStatusChange?.(status);
  if (options.broadcast) {
    safeBroadcast({
      type: "GEMINI_STATUS_CHANGED",
      payload: { status },
    });
  }
}

function emitProgress(
  progress: GeminiDownloadProgress,
  options: TriggerGeminiDownloadOptions,
): void {
  options.onProgress?.(progress);
  if (options.broadcast) {
    safeBroadcast({
      type: "GEMINI_DOWNLOAD_PROGRESS",
      payload: progress,
    });
  }
}

function extractProgress(event: Event): GeminiDownloadProgress | null {
  const raw = event as Event & { loaded?: unknown; total?: unknown };
  if (typeof raw.loaded !== "number") {
    return null;
  }
  if (!Number.isFinite(raw.loaded)) {
    return null;
  }

  if (typeof raw.total !== "number") {
    return {
      loaded: Math.min(1, Math.max(0, raw.loaded)),
      total: 1,
    };
  }

  if (!Number.isFinite(raw.total)) {
    return null;
  }

  if (raw.total <= 0) {
    return null;
  }
  return {
    loaded: Math.max(0, raw.loaded),
    total: raw.total,
  };
}

export async function checkGeminiAvailability(): Promise<{ status: GeminiStatus }> {
  const languageModel = getPromptApiLanguageModel();
  if (!languageModel) {
    return { status: "api_not_supported" };
  }

  try {
    const status = await languageModel.availability(
      PROMPT_API_TEXT_LANGUAGE_OPTIONS,
    );
    return { status: normalizeGeminiStatus(status) };
  } catch {
    return { status: "unavailable" };
  }
}

export async function triggerGeminiDownload(
  options: TriggerGeminiDownloadOptions = {},
): Promise<TriggerGeminiDownloadResult> {
  const languageModel = getPromptApiLanguageModel();
  if (!languageModel) {
    const status: GeminiStatus = "api_not_supported";
    emitStatus(status, options);
    return { status };
  }

  emitStatus("downloading", options);

  try {
    const session = await languageModel.create({
      ...PROMPT_API_TEXT_LANGUAGE_OPTIONS,
      monitor: (monitor: EventTarget) => {
        monitor.addEventListener("downloadprogress", (event: Event) => {
          const progress = extractProgress(event);
          if (!progress) return;
          emitProgress(progress, options);
        });
      },
    });

    session.destroy();

    const { status } = await checkGeminiAvailability();
    emitStatus(status, options);
    return { status };
  } catch (err) {
    const error = getErrorMessage(err);
    options.onError?.(error);

    if (options.broadcast) {
      safeBroadcast({
        type: "GEMINI_DOWNLOAD_FAILED",
        payload: { error },
      });
    }

    const { status } = await checkGeminiAvailability();
    emitStatus(status, options);
    return { status, error };
  }
}
