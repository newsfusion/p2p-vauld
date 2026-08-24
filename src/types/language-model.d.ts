/** Ambient type declaration for Chrome's built-in Prompt API (Chrome 138+). */

interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: object }): Promise<string>;
  promptStreaming(input: string, options?: { responseConstraint?: object }): ReadableStream<string>;
  countPromptTokens(input: string): Promise<number>;
  maxTokens: number;
  tokensSoFar: number;
  tokensLeft: number;
  destroy(): void;
}

interface LanguageModelConstructor {
  availability(options?: Record<string, unknown>): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
  create(options?: {
    expectedInputs?: readonly { type: 'text'; languages: readonly string[] }[];
    expectedOutputs?: readonly { type: 'text'; languages: readonly string[] }[];
    initialPrompts?: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature?: number;
    topK?: number;
    monitor?: (monitor: EventTarget) => void;
  }): Promise<LanguageModelSession>;
}

interface WindowAiNamespace {
  languageModel?: LanguageModelConstructor;
}

interface Window {
  ai?: WindowAiNamespace;
}

// eslint-disable-next-line no-var
declare var LanguageModel: LanguageModelConstructor | undefined;
// eslint-disable-next-line no-var
declare var ai: WindowAiNamespace | undefined;
