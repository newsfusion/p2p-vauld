/**
 * Prompt API provider resolver.
 * Prefers the modern window.ai language model API and falls back
 * to the legacy LanguageModel global when needed.
 */

export function getPromptApiLanguageModel():
  | LanguageModelConstructor
  | undefined {
  const aiProvider = (
    globalThis as { ai?: { languageModel?: LanguageModelConstructor } }
  ).ai?.languageModel;
  if (aiProvider) return aiProvider;

  if (typeof LanguageModel !== "undefined") {
    return LanguageModel;
  }

  return undefined;
}

export const PROMPT_API_TEXT_LANGUAGE_OPTIONS = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
} as const;
