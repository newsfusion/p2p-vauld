import type {
  AiExtractionLog,
  ExtractionCandidate,
  FinancialSignalKey,
  PlatformCatalogEntry,
} from "../../shared/types/index.js";
import type {
  CaptureHtmlResponse,
  ExtractMessage,
  ExtractResponse,
  GetTextTreeResponse,
} from "../../shared/messages.js";
import { checkGeminiAvailability } from "../../shared/ai/gemini.js";
import {
  AI_AVAILABILITY_TIMEOUT_MS,
  AI_NSHOT_EXAMPLES,
  AI_PROMPT_TIMEOUT_MS,
  AI_RESPONSE_SCHEMA,
  AI_SESSION_TIMEOUT_MS,
  AI_SIGNAL_KEYWORDS,
  AI_SYSTEM_PROMPT,
  AI_TIMEOUT_COOLDOWN_MS,
} from "../../shared/ai/constants.js";
import {
  buildStrictExtractionPrompt,
  buildStrictResponseSchema,
  isStrictExtractionSignalKey,
  parseStrictExtractionResponse,
  prepareTreeForAI,
} from "../../shared/ai/extraction.js";
import {
  getPromptApiLanguageModel,
  PROMPT_API_TEXT_LANGUAGE_OPTIONS,
} from "../../shared/ai/provider.js";
import { getErrorMessage } from "../../shared/error-utils.js";
import {
  computeConfidence,
  countAgreementEvidence,
} from "../../shared/scoring.js";
import { sendToTabWithTimeout } from "./content-messaging.js";
import type { ExtractSignalResult, PlatformLogger } from "./debug-logger.js";

const EXTRACT_MESSAGE_TIMEOUT_MS = 30_000;
const CAPTURE_HTML_TIMEOUT_MS = 15_000;
const GET_TEXT_TREE_TIMEOUT_MS = 15_000;
let aiTimeoutCooldownUntil = 0;

export type AiTextTreeExtractionResult =
  | { ok: true; value: number; currency: string; aiLog: AiExtractionLog }
  | { ok: false; aiLog: AiExtractionLog };

class AiOperationTimeoutError extends Error {
  constructor(operation: string) {
    super(`Gemini Nano ${operation} timed out`);
    this.name = "AiOperationTimeoutError";
  }
}

async function withAiTimeout<T>(
  operation: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new AiOperationTimeoutError(operation)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function startAiTimeoutCooldown(): void {
  aiTimeoutCooldownUntil = Math.max(
    aiTimeoutCooldownUntil,
    Date.now() + AI_TIMEOUT_COOLDOWN_MS,
  );
}

export function signalSelectors(
  platform: PlatformCatalogEntry,
  key: FinancialSignalKey,
): string[] {
  switch (key) {
    case "portfolio_value":
      return platform.dashboard.portfolioValueSelectors;
    case "free_cash":
      return platform.dashboard.freeCashSelectors;
    case "net_annual_return":
      return platform.dashboard.netAnnualReturnSelectors;
  }
}

export async function extractSignalFromTab(
  tabId: number,
  platform: PlatformCatalogEntry,
  key: FinancialSignalKey,
  options: { fresh?: boolean; selectors?: string[]; selectorOnly?: boolean } = {},
): Promise<ExtractSignalResult> {
  const msg: ExtractMessage = {
    type: "EXTRACT",
    payload: {
      signalKey: key,
      selectors: options.selectors ?? signalSelectors(platform, key),
      ...(platform.dashboard.keywords ? { keywords: platform.dashboard.keywords } : {}),
      ...(platform.dashboard.excludeKeywords
        ? { excludeKeywords: platform.dashboard.excludeKeywords }
        : {}),
      ...(options.fresh ? { fresh: true } : {}),
      ...(options.selectorOnly ? { selectorOnly: true } : {}),
    },
  };
  let response: ExtractResponse;
  try {
    response = await sendToTabWithTimeout<ExtractResponse>(
      tabId,
      msg,
      EXTRACT_MESSAGE_TIMEOUT_MS,
    );
  } catch (err) {
    const errMsg = getErrorMessage(err);
    throw new Error(`Extraction failed for ${key}: ${errMsg}`, { cause: err });
  }
  const allCandidates = response.candidates ?? [];
  const elementsScanned = response.elementsScanned ?? 0;

  if (!response.success || !allCandidates.length) {
    return { value: null, confidence: 0, allCandidates, elementsScanned };
  }

  const top = allCandidates[0];
  if (!top)
    return { value: null, confidence: 0, allCandidates, elementsScanned };

  const second = allCandidates.find(
    (candidate) => Math.abs(candidate.value - top.value) > 0.005,
  );
  const confidence = computeConfidence({
    topScore: top.score,
    secondScore: second?.score ?? null,
    candidateCount: allCandidates.length,
    agreementCount: countAgreementEvidence(allCandidates, top.value),
  });

  return {
    value: top.value,
    confidence,
    candidate: top,
    allCandidates,
    elementsScanned,
  };
}

export async function capturePageHtml(
  tabId: number,
  log: PlatformLogger,
): Promise<string | undefined> {
  try {
    log("Capturing page HTML (cleaned)", `tabId=${tabId}`);
    const response = await sendToTabWithTimeout<CaptureHtmlResponse>(
      tabId,
      {
        type: "CAPTURE_HTML",
      },
      CAPTURE_HTML_TIMEOUT_MS,
    );
    const stats = response.cleanupStats;
    if (stats) {
      log(
        "Page HTML captured",
        `raw=${stats.rawLength.toLocaleString()} chars → cleaned=${stats.cleanedLength.toLocaleString()} chars (${stats.reductionPct}% reduction, ${stats.elementsRemoved} elements removed)`,
      );
    } else {
      log("Page HTML captured", `${response.html.length.toLocaleString()} chars`);
    }
    return response.html;
  } catch (err) {
    log(
      "Failed to capture page HTML",
      getErrorMessage(err),
      "warn",
    );
    return undefined;
  }
}

export interface FetchedTextTree {
  textTree: string;
  truncated: boolean;
  nodeCount?: number | undefined;
}

export async function getTextTreeFromTab(
  tabId: number,
): Promise<FetchedTextTree> {
  const response = await sendToTabWithTimeout<GetTextTreeResponse>(
    tabId,
    {
      type: "GET_TEXT_TREE",
    },
    GET_TEXT_TREE_TIMEOUT_MS,
  );
  if (!response.success || !response.textTree) {
    throw new Error(response.error ?? "Failed to get text tree");
  }
  return {
    textTree: response.textTree,
    truncated: response.truncated === true,
    nodeCount: response.nodeCount,
  };
}

export async function aiExtractSignalFromTextTree(
  textTree: string,
  signalKey: FinancialSignalKey,
  options: { truncated?: boolean } = {},
): Promise<AiTextTreeExtractionResult> {
  const startTime = Date.now();
  const aiLog: AiExtractionLog = { available: false };
  if (options.truncated !== undefined) {
    aiLog.textTreeTruncated = options.truncated;
  }

  if (aiTimeoutCooldownUntil > startTime) {
    aiLog.reason = "unavailable";
    aiLog.error = "cooldown_after_timeout";
    aiLog.durationMs = Date.now() - startTime;
    return { ok: false, aiLog };
  }

  let status: Awaited<ReturnType<typeof checkGeminiAvailability>>["status"];
  try {
    ({ status } = await withAiTimeout(
      "availability check",
      checkGeminiAvailability(),
      AI_AVAILABILITY_TIMEOUT_MS,
    ));
  } catch (err) {
    if (err instanceof AiOperationTimeoutError) {
      startAiTimeoutCooldown();
    }
    aiLog.error = getErrorMessage(err);
    aiLog.durationMs = Date.now() - startTime;
    return { ok: false, aiLog };
  }

  aiLog.available = status === "available";
  if (status !== "available") {
    aiLog.reason = status;
    aiLog.durationMs = Date.now() - startTime;
    return { ok: false, aiLog };
  }

  const keywords = AI_SIGNAL_KEYWORDS[signalKey];
  let preparedTree: string;
  try {
    preparedTree = prepareTreeForAI(textTree);
  } catch (err) {
    // The serializer guarantees valid JSON, so this is a defect worth seeing
    // rather than something to paper over by forwarding broken input.
    aiLog.error = getErrorMessage(err);
    aiLog.durationMs = Date.now() - startTime;
    return { ok: false, aiLog };
  }

  if (!preparedTree || preparedTree === "null" || preparedTree === "[]") {
    aiLog.error = "empty_text_tree";
    aiLog.durationMs = Date.now() - startTime;
    return { ok: false, aiLog };
  }

  const prompt = isStrictExtractionSignalKey(signalKey)
    ? buildStrictExtractionPrompt({
        signalKey,
        preparedTree,
        keywords,
      })
    : `Text tree: ${preparedTree}\n\nExtract: ${signalKey}\nKeywords: ${keywords.join(", ")}`;
  aiLog.promptText = prompt;
  aiLog.promptChars = prompt.length;
  aiLog.estimatedTokens = Math.ceil(prompt.length / 4);

  const languageModel = getPromptApiLanguageModel();
  if (!languageModel) {
    aiLog.error = "LanguageModel not available";
    aiLog.durationMs = Date.now() - startTime;
    return { ok: false, aiLog };
  }

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
    session = await withAiTimeout(
      "session creation",
      languageModel.create({
        ...PROMPT_API_TEXT_LANGUAGE_OPTIONS,
        initialPrompts: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          ...AI_NSHOT_EXAMPLES,
        ],
        temperature: 0.1,
        topK: 3,
      }),
      AI_SESSION_TIMEOUT_MS,
    );

    let rawResponse: string;
    const responseSchema = isStrictExtractionSignalKey(signalKey)
      ? buildStrictResponseSchema(signalKey)
      : AI_RESPONSE_SCHEMA;
    try {
      rawResponse = await withAiTimeout(
        "prompt",
        session.prompt(prompt, {
          responseConstraint: responseSchema,
        }),
        AI_PROMPT_TIMEOUT_MS,
      );
    } catch (err) {
      if (err instanceof AiOperationTimeoutError) throw err;
      rawResponse = await withAiTimeout(
        "prompt",
        session.prompt(prompt),
        AI_PROMPT_TIMEOUT_MS,
      );
    }

    aiLog.rawResponse = rawResponse;
    aiLog.durationMs = Date.now() - startTime;

    if (isStrictExtractionSignalKey(signalKey)) {
      const parsed = parseStrictExtractionResponse(rawResponse, signalKey);
      if ("error" in parsed) {
        aiLog.error = parsed.error;
        return { ok: false, aiLog };
      }
      aiLog.parsedValue = parsed.value;
      aiLog.parsedCurrency = parsed.currency;
      return {
        ok: true,
        value: parsed.value,
        currency: parsed.currency,
        aiLog,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      aiLog.error = "invalid_json";
      return { ok: false, aiLog };
    }

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("value" in parsed) ||
      typeof (parsed as Record<string, unknown>).value !== "number"
    ) {
      aiLog.error = "missing_value_field";
      return { ok: false, aiLog };
    }

    const result = parsed as { value: number; currency?: string };
    if (!Number.isFinite(result.value)) {
      aiLog.error = "invalid_value";
      return { ok: false, aiLog };
    }

    aiLog.parsedValue = result.value;
    aiLog.parsedCurrency =
      typeof result.currency === "string" ? result.currency : "EUR";

    return {
      ok: true,
      value: result.value,
      currency: aiLog.parsedCurrency,
      aiLog,
    };
  } catch (err) {
    if (err instanceof AiOperationTimeoutError) {
      startAiTimeoutCooldown();
    }
    aiLog.error = getErrorMessage(err);
    aiLog.durationMs = Date.now() - startTime;
    return { ok: false, aiLog };
  } finally {
    session?.destroy();
  }
}

export function buildAiExtractedSignal(
  value: number,
  currency: string,
): ExtractSignalResult {
  const candidate: ExtractionCandidate = {
    selector: "ai-extracted",
    text: `${value}`,
    value,
    score: 10,
    valueType: "currency",
    context: `AI-extracted (${currency})`,
  };

  return {
    value,
    confidence: 1.0,
    candidate,
    allCandidates: [],
    elementsScanned: 0,
  };
}
