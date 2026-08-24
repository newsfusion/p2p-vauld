/**
 * AI-powered login field detection using Chrome's built-in Prompt API (Gemini Nano).
 * Scans visible form elements, sends descriptions to AI for classification,
 * and tags detected fields with data-p2p-field attributes.
 *
 * Falls back to selector-based detection (in login.ts) if AI is unavailable.
 */

import type { AiLoginFieldLog } from "../shared/types/index.js";
import type { DetectLoginFieldsResponse } from "../shared/messages.js";
import {
  checkAiAvailability,
  createAiSession,
  promptWithResponseConstraintFallback,
} from "./ai-shared.js";
import { isVisible } from "./login.js";
import { describeElement } from "../shared/describe-element.js";
import { getErrorMessage } from "../shared/error-utils.js";
import { generateStableLoginSelectors } from "./login-selectors.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FormCandidate {
  index: number;
  tagName: string;
  type: string | null;
  name: string | null;
  id: string | null;
  placeholder: string | null;
  autocomplete: string | null;
  ariaLabel: string | null;
  labelText: string | null;
  nearbyText: string;
  buttonText: string | null;
  element: Element;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_CANDIDATES = 30;
const MAX_FIELD_DESC_LENGTH = 120;

const SYSTEM_PROMPT =
  "You are a login form analyzer. You receive a numbered list of form fields from a web page. " +
  "Your job: identify which field is the username/email input, password input, submit button, and OTP/2FA input (if present). " +
  "Return the index numbers of each identified field. " +
  "If a field type is not present on the page, use -1. " +
  "Return ONLY the JSON object.";

const NSHOT_EXAMPLES: Array<{ role: "user" | "assistant"; content: string }> = [
  {
    role: "user",
    content:
      "Fields:\n0. input type=email name=email placeholder='Email address' (label: Email)\n1. input type=password name=password placeholder='Password' (label: Password)\n2. button 'Sign In' (inside form)\n3. a 'Forgot password?'\n\nIdentify the login form fields.",
  },
  {
    role: "assistant",
    content: '{"username": 0, "password": 1, "submit": 2, "otp": -1}',
  },
  {
    role: "user",
    content:
      "Fields:\n0. input type=text name=login placeholder='Username or email'\n1. input type=password name=pass\n2. input type=text name=otp_code placeholder='Enter 2FA code' autocomplete=one-time-code\n3. button 'Log in'\n\nIdentify the login form fields.",
  },
  {
    role: "assistant",
    content: '{"username": 0, "password": 1, "submit": 3, "otp": 2}',
  },
];

const FIELD_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    username: { type: "integer" },
    password: { type: "integer" },
    submit: { type: "integer" },
    otp: { type: "integer" },
  },
  required: ["username", "password", "submit", "otp"],
};

// ─── DOM Scanning ────────────────────────────────────────────────────────────

export function getAssociatedLabel(el: Element): string | null {
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return (label.textContent ?? "").trim() || null;
  }
  const wrapping = el.closest("label");
  if (wrapping) return (wrapping.textContent ?? "").trim() || null;
  return null;
}

export function getNearbyText(el: Element): string {
  const parts: string[] = [];

  const prev = el.previousElementSibling;
  if (prev) {
    const text = (prev.textContent ?? "").trim();
    if (text && text.length <= 80) parts.push(text);
  }

  const parent = el.parentElement;
  if (parent) {
    // Get parent text excluding child input values
    const clone = parent.cloneNode(true) as Element;
    for (const input of clone.querySelectorAll("input, select, textarea")) {
      input.remove();
    }
    const text = (clone.textContent ?? "").trim().slice(0, 80);
    if (text) parts.push(text);
  }

  return parts.join(" ").trim();
}

const CANDIDATE_SELECTOR =
  'input:not([type="hidden"]), select, textarea, button, [role="button"], input[type="submit"]';

export function scanFormCandidates(root: Document | Element): FormCandidate[] {
  const elements = Array.from(root.querySelectorAll(CANDIDATE_SELECTOR));
  const candidates: FormCandidate[] = [];

  for (const el of elements) {
    if (candidates.length >= MAX_CANDIDATES) break;
    if (!isVisible(el)) continue;

    const tagName = el.tagName.toLowerCase();
    const isInput = el instanceof HTMLInputElement;
    const isSelect = el instanceof HTMLSelectElement;
    const isTextarea = el instanceof HTMLTextAreaElement;
    const isButton = el instanceof HTMLButtonElement;

    candidates.push({
      index: candidates.length,
      tagName,
      type: isInput ? el.type : null,
      name:
        isInput || isSelect || isTextarea || isButton ? el.name || null : null,
      id: el.id || null,
      placeholder: isInput || isTextarea ? el.placeholder || null : null,
      autocomplete: el.getAttribute("autocomplete") || null,
      ariaLabel: el.getAttribute("aria-label") || null,
      labelText: getAssociatedLabel(el),
      nearbyText: getNearbyText(el),
      buttonText:
        isButton || el.getAttribute("role") === "button"
          ? (el.textContent ?? "").trim() || null
          : null,
      element: el,
    });
  }

  return candidates;
}

// ─── Prompt Construction ─────────────────────────────────────────────────────

export function describeCandidate(c: FormCandidate): string {
  const parts: string[] = [`${c.index}. ${c.tagName}`];

  if (c.type) parts.push(`type=${c.type}`);
  if (c.name) parts.push(`name=${c.name}`);
  if (c.placeholder) parts.push(`placeholder='${c.placeholder}'`);
  if (c.autocomplete) parts.push(`autocomplete=${c.autocomplete}`);
  if (c.labelText) parts.push(`(label: ${c.labelText})`);
  if (c.buttonText) parts.push(`'${c.buttonText}'`);
  if (c.nearbyText) parts.push(`-- ${c.nearbyText}`);

  const desc = parts.join(" ");
  return desc.length > MAX_FIELD_DESC_LENGTH
    ? desc.slice(0, MAX_FIELD_DESC_LENGTH - 3) + "..."
    : desc;
}

export function buildFieldDetectionPrompt(candidates: FormCandidate[]): string {
  const lines = candidates.map((c) => describeCandidate(c));
  return `Fields:\n${lines.join("\n")}\n\nIdentify the login form fields.`;
}

// ─── Response Parsing ────────────────────────────────────────────────────────

interface DetectedFields {
  username?: Element;
  password?: Element;
  submit?: Element;
  otp?: Element;
}

export function parseFieldDetectionResponse(
  raw: string,
  candidates: FormCandidate[],
): DetectedFields | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "invalid_json" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { error: "invalid_response_type" };
  }

  const response = parsed as Record<string, unknown>;
  const roles = ["username", "password", "submit", "otp"] as const;
  const fields: DetectedFields = {};
  const usedIndices = new Set<number>();

  for (const role of roles) {
    const index = response[role];
    if (typeof index !== "number" || !Number.isInteger(index)) continue;
    if (index === -1) continue;
    if (index < 0 || index >= candidates.length) continue;

    if (usedIndices.has(index)) {
      return { error: "duplicate_index" };
    }
    usedIndices.add(index);
    fields[role] = candidates[index]!.element;
  }

  // Username and password are mandatory
  if (!fields.username || !fields.password) {
    return { error: "missing_required_fields" };
  }

  return fields;
}

// ─── Field Tagging ───────────────────────────────────────────────────────────

export function tagDetectedFields(fields: DetectedFields): void {
  // Clear any existing tags
  for (const el of document.querySelectorAll("[data-p2p-field]")) {
    el.removeAttribute("data-p2p-field");
  }

  const roles = ["username", "password", "submit", "otp"] as const;
  for (const role of roles) {
    const el = fields[role];
    if (el) el.setAttribute("data-p2p-field", role);
  }
}

// ─── Top-Level Entry Point ───────────────────────────────────────────────────

export async function detectLoginFields(
  root: Document | Element = document,
): Promise<DetectLoginFieldsResponse> {
  const startTime = Date.now();
  const aiLog: AiLoginFieldLog = { available: false };

  // Step 1: Check AI availability
  const { status } = await checkAiAvailability();
  aiLog.available = status === "available";
  if (status !== "available") {
    aiLog.reason = status;
    return { detected: false, aiLog };
  }

  // Step 2: Scan form candidates
  const candidates = scanFormCandidates(root);
  aiLog.candidateCount = candidates.length;

  if (candidates.length === 0) {
    aiLog.reason = "no_candidates";
    aiLog.durationMs = Date.now() - startTime;
    return { detected: false, aiLog };
  }

  // Step 3: Build prompt
  const prompt = buildFieldDetectionPrompt(candidates);
  aiLog.promptText = prompt;

  // Step 4: Query AI
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
      FIELD_RESPONSE_SCHEMA,
    );
    aiLog.rawResponse = rawResponse;

    // Step 5: Parse and validate
    const result = parseFieldDetectionResponse(rawResponse, candidates);

    if ("error" in result) {
      aiLog.error = result.error;
      aiLog.durationMs = Date.now() - startTime;
      return { detected: false, aiLog, error: result.error };
    }

    // Step 6: Tag elements
    tagDetectedFields(result);

    // Build field selector map for response
    const fields: DetectLoginFieldsResponse["fields"] = {};
    const fieldElements: DetectLoginFieldsResponse["fieldElements"] = {};
    const stableSelectors = generateStableLoginSelectors(result);
    const roles = ["username", "password", "submit", "otp"] as const;
    const parsed = JSON.parse(rawResponse) as Record<string, number>;
    for (const role of roles) {
      if (result[role]) {
        const idx = parsed[role] ?? -1;
        aiLog.detectedFields = aiLog.detectedFields ?? {};
        aiLog.detectedFields[role] = idx;
        fields[role] = `[data-p2p-field="${role}"]`;
        fieldElements[role] = describeElement(result[role]!);
      }
    }

    aiLog.durationMs = Date.now() - startTime;
    return { detected: true, fields, stableSelectors, fieldElements, aiLog };
  } catch (err) {
    aiLog.error = getErrorMessage(err);
    aiLog.durationMs = Date.now() - startTime;
    return { detected: false, aiLog, error: aiLog.error };
  } finally {
    session?.destroy();
  }
}
