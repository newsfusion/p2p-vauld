import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkGeminiAvailability,
  triggerGeminiDownload,
} from "../../src/shared/ai/gemini.js";
import { PROMPT_API_TEXT_LANGUAGE_OPTIONS } from "../../src/shared/ai/provider.js";

function setLanguageModel(value: unknown): void {
  (globalThis as Record<string, unknown>).LanguageModel = value;
}

function setWindowAiLanguageModel(value: unknown): void {
  (globalThis as Record<string, unknown>).ai = { languageModel: value };
}

describe("gemini shared utility", () => {
  const sendMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    sendMessage.mockClear();
    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        sendMessage,
      },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).LanguageModel;
    delete (globalThis as Record<string, unknown>).ai;
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it("returns api_not_supported when LanguageModel is undefined", async () => {
    const result = await checkGeminiAvailability();
    expect(result.status).toBe("api_not_supported");
  });

  it("normalizes unknown availability values to unavailable", async () => {
    const availability = vi.fn().mockResolvedValue("unexpected-status");
    setLanguageModel({
      availability,
    });

    const result = await checkGeminiAvailability();
    expect(result.status).toBe("unavailable");
    expect(availability).toHaveBeenCalledWith(PROMPT_API_TEXT_LANGUAGE_OPTIONS);
  });

  it("prefers window.ai.languageModel when available", async () => {
    const availability = vi.fn().mockResolvedValue("available");
    setWindowAiLanguageModel({
      availability,
      create: vi.fn(),
    });

    const result = await checkGeminiAvailability();
    expect(result.status).toBe("available");
    expect(availability).toHaveBeenCalledWith(PROMPT_API_TEXT_LANGUAGE_OPTIONS);
  });

  it("triggers download and emits progress + final status", async () => {
    const destroy = vi.fn();
    const create = vi.fn().mockImplementation(async (options?: { monitor?: (monitor: EventTarget) => void }) => {
      const monitor = {
        addEventListener: (type: string, listener: (event: Event) => void) => {
          if (type !== "downloadprogress") return;
          listener({ loaded: 40, total: 100 } as unknown as Event);
        },
      };
      options?.monitor?.(monitor as unknown as EventTarget);
      return { destroy };
    });

    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create,
    });

    const onProgress = vi.fn();
    const onStatusChange = vi.fn();

    const result = await triggerGeminiDownload({
      broadcast: true,
      onProgress,
      onStatusChange,
    });

    expect(result.status).toBe("available");
    expect(result.error).toBeUndefined();
    expect(destroy).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining(PROMPT_API_TEXT_LANGUAGE_OPTIONS),
    );
    expect(onProgress).toHaveBeenCalledWith({ loaded: 40, total: 100 });
    expect(onStatusChange).toHaveBeenNthCalledWith(1, "downloading");
    expect(onStatusChange).toHaveBeenLastCalledWith("available");

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "GEMINI_DOWNLOAD_PROGRESS" }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "GEMINI_STATUS_CHANGED" }),
    );
  });

  it("normalizes fractional download progress without a total", async () => {
    const destroy = vi.fn();

    setLanguageModel({
      availability: vi.fn().mockResolvedValue("available"),
      create: vi.fn().mockImplementation(async (options?: { monitor?: (monitor: EventTarget) => void }) => {
        const monitor = {
          addEventListener: (type: string, listener: (event: Event) => void) => {
            if (type !== "downloadprogress") return;
            listener({ loaded: 0.42 } as unknown as Event);
          },
        };
        options?.monitor?.(monitor as unknown as EventTarget);
        return { destroy };
      }),
    });

    const onProgress = vi.fn();

    const result = await triggerGeminiDownload({
      broadcast: true,
      onProgress,
    });

    expect(result.status).toBe("available");
    expect(onProgress).toHaveBeenCalledWith({ loaded: 0.42, total: 1 });
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "GEMINI_DOWNLOAD_PROGRESS",
        payload: { loaded: 0.42, total: 1 },
      }),
    );
  });

  it("emits failure and fallback status when create throws", async () => {
    setLanguageModel({
      availability: vi.fn().mockResolvedValue("downloadable"),
      create: vi.fn().mockRejectedValue(new Error("download failed")),
    });

    const onError = vi.fn();
    const onStatusChange = vi.fn();

    const result = await triggerGeminiDownload({
      broadcast: true,
      onError,
      onStatusChange,
    });

    expect(result.status).toBe("downloadable");
    expect(result.error).toBe("download failed");
    expect(onError).toHaveBeenCalledWith("download failed");
    expect(onStatusChange).toHaveBeenNthCalledWith(1, "downloading");
    expect(onStatusChange).toHaveBeenLastCalledWith("downloadable");

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "GEMINI_DOWNLOAD_FAILED" }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "GEMINI_STATUS_CHANGED" }),
    );
  });
});
