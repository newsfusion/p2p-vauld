/**
 * AI-powered financial data extraction using Chrome's built-in Prompt API (Gemini Nano).
 * Fallback for when heuristic extraction produces low-confidence results.
 * Runs inside content script — has direct DOM access and LanguageModel global.
 */

import type {
  FinancialSignalKey,
  ExtractionCandidate,
  AiExtractionLog,
} from "../shared/types/index.js";
import type { AiExtractResponse } from "../shared/messages.js";
import { parseLocalizedNumber } from "./extractor.js";
import { getErrorMessage } from "../shared/error-utils.js";
import {
  checkAiAvailability,
  createAiSession,
  promptWithResponseConstraintFallback,
} from "./ai-shared.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AnchorSnippet {
  rawText: string;
  value: number;
  contextBubble: string;
  valueType: "currency" | "percent" | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CURRENCY_REGEX =
  /[€$£]\s*[\d.,]+|[\d.,]+\s*[€$£%]|\d{1,3}([.,]\d{3})*([.,]\d{1,2})?\s*(EUR|USD|GBP|PLN|CZK|SEK|NOK)/gi;
const MAX_SNIPPET_LENGTH = 200;
const MAX_BUBBLE_LEVELS = 3;
const MAX_TOKEN_BUDGET = 800;
const CHARS_PER_TOKEN = 4;
const IGNORED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
const MAX_ELEMENTS = 6000;
const SCAN_BATCH_SIZE = 250;
const MAX_TEXT_CHILDREN_FOR_FULL_TEXT = 4;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    value: { type: "number" },
    currency: {
      type: "string",
      enum: ["EUR", "USD", "GBP", "PLN", "CZK", "SEK", "NOK"],
    },
  },
  required: ["value", "currency"],
};

const SYSTEM_PROMPT =
  "You are a financial data extractor for P2P lending platform dashboards. " +
  "You receive text snippets from a dashboard page. Each snippet contains a financial value and its surrounding label text. " +
  "Your job: identify the correct value for the requested metric. " +
  "Return ONLY the JSON object. Do not add explanations.";

const NSHOT_EXAMPLES: Array<{ role: "user" | "assistant"; content: string }> = [
  {
    role: "user",
    content:
      'Snippets:\n1. "Account value €12,345.67" (context: Portfolio Overview)\n2. "Available funds €1,234.56" (context: Available to invest)\n\nExtract: portfolio_value',
  },
  { role: "assistant", content: '{"value": 12345.67, "currency": "EUR"}' },
  {
    role: "user",
    content:
      'Snippets:\n1. "Available: €807.83" (context: Verfügbare Mittel)\n2. "Total invested €24,500.00" (context: Portfolio)\n\nExtract: free_cash',
  },
  { role: "assistant", content: '{"value": 807.83, "currency": "EUR"}' },
];

// ─── DOM Preprocessing ───────────────────────────────────────────────────────

function detectSnippetValueType(text: string): "currency" | "percent" | null {
  if (/%/.test(text)) return "percent";
  if (/[€$£]|\b(eur|usd|gbp|pln|czk|sek|nok)\b/i.test(text)) return "currency";
  return null;
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function getOwnTextSnippet(el: Element, maxLength = 120): string {
  const parts: string[] = [];
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) {
      const text = compactWhitespace(node.textContent ?? "");
      if (text) parts.push(text);
    }
    if (parts.join(" ").length >= maxLength) break;
  }
  return compactWhitespace(parts.join(" ")).slice(0, maxLength);
}

function getElementSearchText(el: Element): string {
  if (el.childElementCount <= MAX_TEXT_CHILDREN_FOR_FULL_TEXT) {
    return compactWhitespace(el.textContent ?? "");
  }

  const ownText = getOwnTextSnippet(el, 500);
  if (ownText) return ownText;

  return compactWhitespace(
    `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`,
  );
}

function getContextText(el: Element): string {
  if (el.childElementCount <= MAX_TEXT_CHILDREN_FOR_FULL_TEXT) {
    return compactWhitespace(el.textContent ?? "").slice(0, 120);
  }
  return getOwnTextSnippet(el);
}

export function buildContextBubble(
  el: Element,
  maxLevels: number = MAX_BUBBLE_LEVELS,
): string {
  const parts: string[] = [];

  // Element's own aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) parts.push(ariaLabel.trim());

  // Previous sibling text
  const prev = el.previousElementSibling;
  if (prev) {
    const prevText = getContextText(prev);
    if (prevText && prevText.length <= 120) parts.push(prevText);
  }

  // Traverse up parent chain
  let current: Element | null = el;
  for (let level = 0; level < maxLevels && current?.parentElement; level++) {
    current = current.parentElement;

    const parentAria = current.getAttribute("aria-label");
    if (parentAria) parts.push(parentAria.trim());

    const parentText = getContextText(current);
    if (parentText) parts.push(parentText);

    // Parent's previous sibling
    const parentPrev = current.previousElementSibling;
    if (parentPrev) {
      const parentPrevText = getContextText(parentPrev);
      if (parentPrevText && parentPrevText.length <= 120)
        parts.push(parentPrevText);
    }
  }

  // Deduplicate, join, truncate
  const unique = [...new Set(parts.filter(Boolean))];
  const joined = compactWhitespace(unique.join(" "));
  return joined.slice(0, MAX_SNIPPET_LENGTH);
}

function shouldSkipElement(el: Element): boolean {
  return (
    IGNORED_TAGS.has(el.tagName) ||
    el.getAttribute("aria-hidden") === "true" ||
    el.hasAttribute("hidden") ||
    el.closest('[aria-hidden="true"], [hidden]') !== null
  );
}

function snippetFromElement(el: Element): AnchorSnippet | null {
  if (shouldSkipElement(el)) return null;

  const text = getElementSearchText(el);
  if (!text || text.length > 500) return null;

  CURRENCY_REGEX.lastIndex = 0;
  if (!CURRENCY_REGEX.test(text)) return null;

  const value = parseLocalizedNumber(text);
  if (value === null) return null;

  return {
    rawText: text.slice(0, MAX_SNIPPET_LENGTH),
    value,
    contextBubble: buildContextBubble(el),
    valueType: detectSnippetValueType(text),
  };
}

function getScanElements(root: Document | Element): NodeListOf<Element> {
  const selector = root instanceof Document ? "body *" : "*";
  return root.querySelectorAll(selector);
}

export function scanForAnchors(root: Document | Element): AnchorSnippet[] {
  const snippets: AnchorSnippet[] = [];
  const elements = getScanElements(root);
  const elementCount = Math.min(elements.length, MAX_ELEMENTS);

  for (let index = 0; index < elementCount; index++) {
    const snippet = snippetFromElement(elements[index]!);
    if (snippet) snippets.push(snippet);
  }

  return snippets;
}

async function yieldToUiThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    if ("requestIdleCallback" in globalThis) {
      globalThis.requestIdleCallback(() => resolve(), { timeout: 50 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

export async function scanForAnchorsAsync(
  root: Document | Element,
): Promise<AnchorSnippet[]> {
  const snippets: AnchorSnippet[] = [];
  const elements = getScanElements(root);
  const elementCount = Math.min(elements.length, MAX_ELEMENTS);

  for (let index = 0; index < elementCount; index++) {
    const snippet = snippetFromElement(elements[index]!);
    if (snippet) snippets.push(snippet);

    if ((index + 1) % SCAN_BATCH_SIZE === 0) {
      await yieldToUiThread();
    }
  }

  return snippets;
}

// ─── Filtering & Prompt Construction ─────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function deduplicateAndFilter(
  snippets: AnchorSnippet[],
  keywords: string[],
): AnchorSnippet[] {
  // Deduplicate by contextBubble
  const seen = new Set<string>();
  const unique: AnchorSnippet[] = [];
  for (const s of snippets) {
    if (seen.has(s.contextBubble)) continue;
    seen.add(s.contextBubble);
    // Remove zero/negative values
    if (s.value <= 0) continue;
    unique.push(s);
  }

  // Sort: keyword-matching snippets first
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  unique.sort((a, b) => {
    const aMatch = lowerKeywords.some((k) =>
      a.contextBubble.toLowerCase().includes(k),
    )
      ? 1
      : 0;
    const bMatch = lowerKeywords.some((k) =>
      b.contextBubble.toLowerCase().includes(k),
    )
      ? 1
      : 0;
    return bMatch - aMatch;
  });

  // Truncate to fit token budget
  const result: AnchorSnippet[] = [];
  let tokenCount = 0;
  for (const s of unique) {
    const snippetTokens = estimateTokens(
      `"${s.rawText}" (context: ${s.contextBubble})`,
    );
    if (tokenCount + snippetTokens > MAX_TOKEN_BUDGET) break;
    tokenCount += snippetTokens;
    result.push(s);
  }

  return result;
}

export function buildAiPrompt(
  snippets: AnchorSnippet[],
  signalKey: FinancialSignalKey,
  keywords: string[],
): string {
  const lines = snippets.map(
    (s, i) => `${i + 1}. "${s.rawText}" (context: ${s.contextBubble})`,
  );

  return `Snippets:\n${lines.join("\n")}\n\nExtract: ${signalKey}\nKeywords: ${keywords.join(", ")}`;
}

// ─── LanguageModel Wrapper ───────────────────────────────────────────────────

export { checkAiAvailability };

export async function queryLanguageModel(
  prompt: string,
  _signalKey: FinancialSignalKey,
): Promise<
  { value: number; currency: string } | { error: string; rawResponse?: string }
> {
  let session:
    | {
        prompt: (
          input: string,
          options?: { responseConstraint?: object },
        ) => Promise<string>;
        destroy: () => void;
      }
    | undefined;
  try {
    session = await createAiSession(SYSTEM_PROMPT, NSHOT_EXAMPLES);

    const rawResponse = await promptWithResponseConstraintFallback(
      session,
      prompt,
      RESPONSE_SCHEMA,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      return { error: "invalid_json", rawResponse };
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("value" in parsed) ||
      typeof (parsed as Record<string, unknown>).value !== "number"
    ) {
      return { error: "missing_value_field", rawResponse };
    }

    const result = parsed as { value: number; currency?: string };
    if (!Number.isFinite(result.value)) {
      return { error: "invalid_value", rawResponse };
    }

    return {
      value: result.value,
      currency: typeof result.currency === "string" ? result.currency : "EUR",
    };
  } catch (err) {
    return { error: getErrorMessage(err) };
  } finally {
    session?.destroy();
  }
}

// ─── Top-level entry point ───────────────────────────────────────────────────

export async function aiExtractSignal(
  signalKey: FinancialSignalKey,
  labels: string[],
  root: Document | Element = document,
): Promise<AiExtractResponse> {
  const startTime = Date.now();
  const aiLog: AiExtractionLog = { available: false };

  // Step 1: Check availability
  const { status } = await checkAiAvailability();
  aiLog.available = status === "available";
  if (status !== "available") {
    aiLog.reason = status;
    return { success: false, aiLog };
  }

  // Step 2: Scan for anchors
  const anchors = await scanForAnchorsAsync(root);
  aiLog.snippetCount = anchors.length;

  if (anchors.length === 0) {
    aiLog.error = "no_anchors_found";
    aiLog.durationMs = Date.now() - startTime;
    return {
      success: false,
      aiLog,
      error: "No currency/number anchors found on page",
    };
  }

  // Step 3: Deduplicate and filter
  const filtered = deduplicateAndFilter(anchors, labels);

  if (filtered.length === 0) {
    aiLog.error = "all_snippets_filtered";
    aiLog.durationMs = Date.now() - startTime;
    return { success: false, aiLog, error: "All snippets filtered out" };
  }

  // Step 4: Build prompt
  const prompt = buildAiPrompt(filtered, signalKey, labels);
  aiLog.promptText = prompt;
  aiLog.estimatedTokens = estimateTokens(prompt);

  // Step 5: Query AI
  const aiResult = await queryLanguageModel(prompt, signalKey);
  aiLog.durationMs = Date.now() - startTime;

  if ("error" in aiResult) {
    aiLog.error = aiResult.error;
    if (aiResult.rawResponse) aiLog.rawResponse = aiResult.rawResponse;
    return { success: false, aiLog, error: aiResult.error };
  }

  // Step 6: Build ExtractionCandidate
  aiLog.parsedValue = aiResult.value;
  aiLog.parsedCurrency = aiResult.currency;
  aiLog.rawResponse = JSON.stringify(aiResult);

  const candidate: ExtractionCandidate = {
    selector: "ai-extracted",
    text: `${aiResult.value}`,
    value: aiResult.value,
    score: 10,
    valueType: signalKey === "net_annual_return" ? "percent" : "currency",
    context: `AI-extracted (${aiResult.currency})`,
  };

  return { success: true, candidate, aiLog };
}
