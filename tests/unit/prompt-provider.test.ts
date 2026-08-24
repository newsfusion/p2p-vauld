import { afterEach, describe, expect, it } from "vitest";
import { getPromptApiLanguageModel } from "../../src/shared/ai/provider.js";

describe("Prompt API provider resolver", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).ai;
    delete (globalThis as Record<string, unknown>).LanguageModel;
  });

  it("prefers window.ai.languageModel over LanguageModel", () => {
    const aiProvider = {
      availability: async () => "available" as const,
      create: async () =>
        ({
          prompt: async () => "",
          promptStreaming: () => new ReadableStream<string>(),
          countPromptTokens: async () => 0,
          maxTokens: 1024,
          tokensSoFar: 0,
          tokensLeft: 1024,
          destroy: () => {},
        }) as LanguageModelSession,
    };
    const legacyProvider = {
      availability: async () => "unavailable" as const,
      create: async () => {
        throw new Error("not used");
      },
    };
    (globalThis as Record<string, unknown>).ai = { languageModel: aiProvider };
    (globalThis as Record<string, unknown>).LanguageModel = legacyProvider;

    expect(getPromptApiLanguageModel()).toBe(aiProvider);
  });

  it("falls back to LanguageModel when window.ai is unavailable", () => {
    const legacyProvider = {
      availability: async () => "available" as const,
      create: async () =>
        ({
          prompt: async () => "",
          promptStreaming: () => new ReadableStream<string>(),
          countPromptTokens: async () => 0,
          maxTokens: 1024,
          tokensSoFar: 0,
          tokensLeft: 1024,
          destroy: () => {},
        }) as LanguageModelSession,
    };
    (globalThis as Record<string, unknown>).LanguageModel = legacyProvider;

    expect(getPromptApiLanguageModel()).toBe(legacyProvider);
  });

  it("returns undefined when no provider exists", () => {
    expect(getPromptApiLanguageModel()).toBeUndefined();
  });
});
