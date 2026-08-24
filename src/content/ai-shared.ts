/**
 * Shared LanguageModel utilities for AI-powered features.
 * Used by both ai-extractor.ts (financial data extraction) and ai-login.ts (login field detection).
 */

import type { GeminiStatus } from "../shared/types/index.js";
import {
  checkGeminiAvailability,
} from "../shared/ai/gemini.js";
import {
  getPromptApiLanguageModel,
  PROMPT_API_TEXT_LANGUAGE_OPTIONS,
} from "../shared/ai/provider.js";

export interface AiPromptSession {
  prompt: (
    input: string,
    options?: { responseConstraint?: object },
  ) => Promise<string>;
}

// ─── Availability Check ──────────────────────────────────────────────────────

export async function checkAiAvailability(): Promise<{ status: GeminiStatus }> {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    return chrome.runtime.sendMessage({ type: "PROXY_CHECK_AI" });
  }
  return checkGeminiAvailability();
}

export async function createAiSession(
  systemPrompt: string,
  examples: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AiPromptSession & {
  destroy: () => void;
}> {
  if (
    typeof chrome === "undefined" ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== "function"
  ) {
    const languageModel = getPromptApiLanguageModel();
    if (!languageModel) {
      throw new Error("LanguageModel not available");
    }

    const session = await languageModel.create({
      ...PROMPT_API_TEXT_LANGUAGE_OPTIONS,
      initialPrompts: [{ role: "system", content: systemPrompt }, ...examples],
      temperature: 0.1,
      topK: 3,
    });

    return {
      prompt: (input, options) => {
        if (options?.responseConstraint) {
          return session.prompt(input, {
            responseConstraint: options.responseConstraint,
          });
        }
        return session.prompt(input);
      },
      destroy: () => {
        session.destroy();
      },
    };
  }

  return {
    prompt: async (
      input: string,
      options?: { responseConstraint?: object },
    ) => {
      const response = await chrome.runtime.sendMessage({
        type: "PROXY_AI_PROMPT",
        payload: { systemPrompt, examples, input, options },
      });
      if (response && response.error) {
        throw new Error(response.error);
      }
      return response.text;
    },
    destroy: () => {},
  };
}

export async function promptWithResponseConstraintFallback(
  session: AiPromptSession,
  input: string,
  responseConstraint?: object,
): Promise<string> {
  if (!responseConstraint) {
    return session.prompt(input);
  }

  try {
    return await session.prompt(input, { responseConstraint });
  } catch {
    return session.prompt(input);
  }
}
