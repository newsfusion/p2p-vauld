/**
 * Shared Gemini Nano extraction constants.
 *
 * These live in `shared/` because three contexts need the exact same values:
 * the content script (relevance-based tree pruning), the background sync
 * orchestrator (live extraction), and the dashboard extractor panel (debug).
 * The panel previously kept byte-for-byte copies with a diverging session
 * timeout, which meant it no longer predicted live behaviour.
 */

import type { FinancialSignalKey } from "../types/index.js";

export const AI_SIGNAL_KEYWORDS: Record<FinancialSignalKey, string[]> = {
  portfolio_value: [
    "portfolio",
    "account value",
    "total value",
    "invested",
    "balance",
    "Kontowert",
    "Gesamtwert",
  ],
  free_cash: [
    "available",
    "free cash",
    "uninvested",
    "funds",
    "Verfügbar",
    "Verfügbare Mittel",
  ],
  net_annual_return: [
    "annual return",
    "net return",
    "yield",
    "interest rate",
    "Rendite",
    "Jahresrendite",
  ],
};

/** Flat, deduplicated keyword list used by signal-agnostic tree pruning. */
export const AI_ALL_SIGNAL_KEYWORDS: string[] = Array.from(
  new Set(Object.values(AI_SIGNAL_KEYWORDS).flat()),
);

export const AI_RESPONSE_SCHEMA = {
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

export const AI_SYSTEM_PROMPT =
  "You are a financial data extractor for P2P lending platform dashboards. " +
  "You receive a text tree representing the visible content of a dashboard page. " +
  "Your job: identify the correct value for the requested metric. " +
  "Return ONLY the JSON object. Do not add explanations.";

export const AI_NSHOT_EXAMPLES: Array<{
  role: "user" | "assistant";
  content: string;
}> = [
  {
    role: "user",
    content:
      '### GOAL\nExtract exactly one value for "portfolio_value".\n\n### INPUT_TEXT_TREE\n["Portfolio Overview",["Account value","€12,345.67"],["Available funds","€1,234.56"]]\n\n### OUTPUT\nReturn ONLY valid JSON with this exact schema: {"portfolio_value": number, "currency": string}',
  },
  {
    role: "assistant",
    content: '{"portfolio_value":12345.67,"currency":"EUR"}',
  },
  {
    role: "user",
    content:
      '### GOAL\nExtract exactly one value for "free_cash".\n\n### INPUT_TEXT_TREE\n["Dashboard",["Verfügbare Mittel","€807.83"],["Total invested","€24,500.00"]]\n\n### OUTPUT\nReturn ONLY valid JSON with this exact schema: {"free_cash": number, "currency": string}',
  },
  { role: "assistant", content: '{"free_cash":807.83,"currency":"EUR"}' },
];

export const AI_AVAILABILITY_TIMEOUT_MS = 5_000;
export const AI_SESSION_TIMEOUT_MS = 15_000;
export const AI_PROMPT_TIMEOUT_MS = 12_000;
export const AI_TIMEOUT_COOLDOWN_MS = 60_000;
