import type { FinancialSignalKey } from "../types/index.js";

export type StrictExtractionSignalKey = "portfolio_value" | "free_cash";

const CURRENCY_CODES = ["EUR", "USD", "GBP", "PLN", "CZK", "SEK", "NOK"];

export function isStrictExtractionSignalKey(
  signalKey: FinancialSignalKey,
): signalKey is StrictExtractionSignalKey {
  return signalKey === "portfolio_value" || signalKey === "free_cash";
}

/** Thrown when a serialized tree is not valid JSON. */
export class InvalidTextTreeError extends Error {
  constructor() {
    super("invalid_text_tree_json");
    this.name = "InvalidTextTreeError";
  }
}

/**
 * Flattens and cleans the tree to save tokens for Gemini Nano.
 *
 * Invalid JSON used to be forwarded verbatim, which silently fed Gemini the
 * mid-structure remains of the old `slice()` truncation. The serializer now
 * guarantees valid JSON, so invalid input is a real defect and must surface.
 */
export function prepareTreeForAI(treeOrSerializedTree: unknown): string {
  if (typeof treeOrSerializedTree === "string") {
    const trimmed = treeOrSerializedTree.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new InvalidTextTreeError();
    }
    return JSON.stringify(parsed).replace(/\s+/g, " ").trim();
  }

  const serialized = JSON.stringify(treeOrSerializedTree);
  if (typeof serialized !== "string") {
    return "null";
  }
  return serialized.replace(/\s+/g, " ").trim();
}

function metricSchemaLabel(signalKey: StrictExtractionSignalKey): string {
  return signalKey === "portfolio_value"
    ? '{"portfolio_value": number, "currency": string}'
    : '{"free_cash": number, "currency": string}';
}

function metricAliases(signalKey: StrictExtractionSignalKey): string {
  if (signalKey === "portfolio_value") {
    return "portfolio, account value, total value, invested, balance, Kontowert, Gesamtwert";
  }
  return "free cash, available cash, available funds, uninvested cash, wallet, Verfügbar, Verfügbare Mittel";
}

function metricInstructions(signalKey: StrictExtractionSignalKey): string {
  if (signalKey === "portfolio_value") {
    return [
      "- Extract the total value of the P2P portfolio or the total account balance/investments.",
      "- This is typically the LARGEST financial amount on the dashboard.",
      "- CRITICAL: Do NOT confuse this with 'free cash', 'available funds', 'wallet balance', or uninvested money.",
      "- If multiple values are present, look for labels like 'Total Value', 'Portfolio', 'Account Balance', 'Gesamtwert', or 'Investiert'."
    ].join("\n");
  }
  return [
    "- Extract the uninvested cash / available funds / free cash in the account.",
    "- This represents money ready to be invested or withdrawn (often labeled as 'Available', 'Free Cash', 'Wallet', 'Verfügbar', or 'Mittel').",
    "- This is typically a SMALLER portion of the total value.",
    "- CRITICAL: Do NOT extract the total portfolio value / total investments / total account balance.",
    "- If multiple values are present, do NOT select the largest total portfolio value."
  ].join("\n");
}

export function buildStrictExtractionPrompt(input: {
  signalKey: StrictExtractionSignalKey;
  preparedTree: string;
  keywords: string[];
}): string {
  const schema = metricSchemaLabel(input.signalKey);
  return [
    "### ROLE",
    "You are a financial data extractor for P2P lending dashboards.",
    "",
    "### GOAL",
    `Extract exactly one value for "${input.signalKey}".`,
    "",
    "### CRITICAL_INSTRUCTIONS",
    metricInstructions(input.signalKey),
    "",
    "### SEARCH_HINTS",
    metricAliases(input.signalKey),
    `Keywords: ${input.keywords.join(", ")}`,
    "",
    "### INPUT_TEXT_TREE",
    input.preparedTree,
    "",
    "### OUTPUT",
    `Return ONLY valid JSON with this exact schema: ${schema}`,
    "No markdown. No explanation. No additional keys.",
  ].join("\n");
}

export function buildStrictResponseSchema(signalKey: StrictExtractionSignalKey): {
  type: "object";
  properties: Record<string, unknown>;
  required: string[];
} {
  return {
    type: "object",
    properties: {
      [signalKey]: { type: "number" },
      currency: { type: "string", enum: CURRENCY_CODES },
    },
    required: [signalKey, "currency"],
  };
}

function parseJsonCandidate(candidate: string): unknown {
  return JSON.parse(candidate.trim());
}

function parseFromCodeFence(raw: string): unknown {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!fenceMatch?.[1]) {
    throw new Error("no_code_fence_json");
  }
  return parseJsonCandidate(fenceMatch[1]);
}

function parseFromObjectSlice(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no_json_object");
  }
  return parseJsonCandidate(raw.slice(start, end + 1));
}

function extractNumericValue(
  parsed: Record<string, unknown>,
  signalKey: StrictExtractionSignalKey,
): number | null {
  const strictValue = parsed[signalKey];
  if (typeof strictValue === "number" && Number.isFinite(strictValue)) {
    return strictValue;
  }

  const legacyValue = parsed.value;
  if (typeof legacyValue === "number" && Number.isFinite(legacyValue)) {
    return legacyValue;
  }

  return null;
}

function extractCurrency(parsed: Record<string, unknown>): string {
  if (typeof parsed.currency === "string" && parsed.currency.trim()) {
    return parsed.currency.trim().toUpperCase();
  }
  return "EUR";
}

export function parseStrictExtractionResponse(
  rawResponse: string,
  signalKey: StrictExtractionSignalKey,
): { value: number; currency: string } | { error: string } {
  let parsed: unknown;

  try {
    parsed = parseJsonCandidate(rawResponse);
  } catch {
    try {
      parsed = parseFromCodeFence(rawResponse);
    } catch {
      try {
        parsed = parseFromObjectSlice(rawResponse);
      } catch {
        return { error: "invalid_json" };
      }
    }
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { error: "invalid_json_object" };
  }

  const parsedObj = parsed as Record<string, unknown>;
  const value = extractNumericValue(parsedObj, signalKey);
  if (value === null) {
    return { error: "missing_value_field" };
  }

  return {
    value,
    currency: extractCurrency(parsedObj),
  };
}
