import { describe, expect, it } from "vitest";
import {
  createCandidateFingerprint,
  GEMINI_ONLY_SELECTOR,
  resolveExtractionChoice,
} from "../../src/shared/extraction-choice.js";
import type {
  ExtractionCandidate,
  SelectorProfile,
} from "../../src/shared/types/index.js";

function candidate(
  overrides: Partial<ExtractionCandidate> = {},
): ExtractionCandidate {
  return {
    selector: ".amount",
    text: "€ 1,000.00",
    value: 1000,
    score: 4.5,
    valueType: "currency",
    context: "Account Balance € 1,000.00",
    ...overrides,
  };
}

describe("extraction choice resolution", () => {
  it("reuses a stored user choice in safe mode instead of prompting again", () => {
    const chosen = candidate({
      selector: ".balance",
      value: 1000,
      context: "Account Balance € 1,000.00",
      score: 3.4,
    });
    const competing = candidate({
      selector: ".invested",
      value: 2000,
      context: "Invested € 2,000.00",
      score: 3.9,
    });
    const stored: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: chosen.selector,
      fingerprint: createCandidateFingerprint("portfolio_value", chosen),
      confidence: 1,
      source: "user",
      learnedAt: "2026-07-18T10:00:00.000Z",
    };

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [competing, chosen],
      storedProfile: stored,
      safeMode: true,
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("stored");
    expect(result.value).toBe(1000);
  });

  it("falls back to the stored selector when the fingerprint label changed", () => {
    const chosen = candidate({
      selector: ".balance",
      value: 1250,
      context: "Account Balance (updated wording) € 1,250.00",
      score: 3.1,
    });
    const stored: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: ".balance",
      fingerprint: "portfolio_value|.balance|account balance",
      confidence: 1,
      source: "user",
      learnedAt: "2026-07-18T10:00:00.000Z",
    };

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [chosen],
      storedProfile: stored,
      safeMode: true,
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("stored");
  });

  it("uses a stored user choice before Gemini recommendations", () => {
    const storedCandidate = candidate({
      selector: ".balance",
      value: 1000,
      context: "Account Balance € 1,000.00",
      score: 3.2,
    });
    const geminiCandidate = candidate({
      selector: ".money",
      value: 2000,
      context: "Account Money € 2,000.00",
      score: 4.8,
    });
    const stored: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: storedCandidate.selector,
      fingerprint: createCandidateFingerprint("portfolio_value", storedCandidate),
      confidence: 1,
      learnedAt: "2026-05-18T10:00:00.000Z",
    };

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [geminiCandidate, storedCandidate],
      storedProfile: stored,
      gemini: { value: 2000, currency: "EUR" },
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("stored");
    expect(result.candidate?.selector).toBe(".balance");
  });

  it("requires user choice when an auto selector fingerprint no longer matches", () => {
    const currentCandidate = candidate({
      selector: ".balance",
      value: 3000,
      context: "Account Money € 3,000.00",
      score: 4.4,
    });
    const stored: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: ".balance",
      fingerprint: "portfolio_value|.balance|account balance",
      confidence: 1,
      source: "auto",
      learnedAt: "2026-05-18T10:00:00.000Z",
    };

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [currentCandidate],
      storedProfile: stored,
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") {
      throw new Error("Expected choice_required");
    }
    expect(result.candidates[0]?.selector).toBe(".balance");
  });

  it("uses a legacy stored user selector without a source when the fingerprint text changes", () => {
    const currentCandidate = candidate({
      selector: ".balance",
      value: 1250,
      context: "Portfolio total € 1,250.00",
      score: 4.4,
    });
    const stored: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: ".balance",
      fingerprint: "portfolio_value|.balance|account balance",
      confidence: 1,
      learnedAt: "2026-05-18T10:00:00.000Z",
    };

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [currentCandidate],
      storedProfile: stored,
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("stored");
    expect(result.candidate.selector).toBe(".balance");
    expect(result.value).toBe(1250);
  });

  it("uses a stored user selector when the fingerprint text changes", () => {
    const currentCandidate = candidate({
      selector: ".balance",
      value: 1250,
      context: "Portfolio total € 1,250.00",
      score: 4.4,
    });
    const stored: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: ".balance",
      fingerprint: "portfolio_value|.balance|account balance",
      confidence: 1,
      source: "user",
      learnedAt: "2026-05-18T10:00:00.000Z",
    };

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [currentCandidate],
      storedProfile: stored,
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("stored");
    expect(result.candidate.selector).toBe(".balance");
    expect(result.value).toBe(1250);
  });

  it("prefers a unique DOM candidate supported by Gemini", () => {
    const domMatch = candidate({
      selector: ".account-balance",
      value: 1234.56,
      context: "Account Balance € 1,234.56",
      score: 3.1,
    });
    const other = candidate({
      selector: ".account-money",
      value: 999,
      context: "Account Money € 999.00",
      score: 4.7,
    });

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [other, domMatch],
      gemini: { value: 1234.56, currency: "EUR" },
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("gemini_supported");
    expect(result.candidate?.selector).toBe(".account-balance");
    expect(result.candidate?.geminiSupported).toBe(true);
  });

  it("uses Gemini-only values for the current run without a persistable candidate", () => {
    const result = resolveExtractionChoice({
      signalKey: "free_cash",
      candidates: [],
      gemini: { value: 807.83, currency: "EUR" },
    });

    expect(result.kind).toBe("gemini_only");
    if (result.kind !== "gemini_only") throw new Error("Expected gemini_only");
    expect(result.value).toBe(807.83);
    expect(result.candidate).toBeUndefined();
  });

  it("forces a manual choice before stored or automatic selection", () => {
    const storedCandidate = candidate({
      selector: ".stored-balance",
      value: 1000,
      score: 5,
      origin: "selector",
    });
    const otherCandidate = candidate({
      selector: ".other-balance",
      value: 1200,
      score: 4.5,
      origin: "heuristic",
    });
    const stored: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: storedCandidate.selector,
      fingerprint: createCandidateFingerprint("portfolio_value", storedCandidate),
      confidence: 1,
      learnedAt: "2026-05-18T10:00:00.000Z",
    };

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [storedCandidate, otherCandidate],
      storedProfile: stored,
      forceChoice: true,
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") {
      throw new Error("Expected choice_required");
    }
    expect(result.candidates.map((entry) => entry.selector)).toEqual([
      ".stored-balance",
      ".other-balance",
    ]);
  });

  it("keeps forced choices limited to manually selectable DOM candidates", () => {
    const result = resolveExtractionChoice({
      signalKey: "free_cash",
      candidates: [
        candidate({ selector: ".cash-a", value: 50, score: 5 }),
        candidate({ selector: ".cash-b", value: 75, score: 4 }),
      ],
      gemini: { value: 125, currency: "EUR" },
      forceChoice: true,
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") {
      throw new Error("Expected choice_required");
    }
    expect(result.candidates.map((entry) => entry.selector)).toEqual([
      ".cash-a",
      ".cash-b",
    ]);
    expect(result.candidates.every((entry) => !entry.geminiSupported)).toBe(true);
  });

  it("does not turn a Gemini-only result into a forced manual choice", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [],
      gemini: { value: 2500, currency: "EUR" },
      forceChoice: true,
    });

    expect(result.kind).toBe("missing");
  });

  it("auto-selects the highest-scored DOM candidate when Gemini matches multiple values", () => {
    const first = candidate({
      selector: ".summary-balance",
      value: 1000,
      context: "Account Balance € 1,000.00",
      score: 4.4,
    });
    const second = candidate({
      selector: ".header-balance",
      value: 1000,
      context: "Account Balance € 1,000.00",
      score: 4.3,
    });

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [first, second],
      gemini: { value: 1000, currency: "EUR" },
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("gemini_supported");
    expect(result.candidate?.selector).toBe(".summary-balance");
    expect(result.candidate?.geminiSupported).toBe(true);
  });

  it("auto-selects one representative when Gemini-matching candidates tie on value", () => {
    const first = candidate({
      selector: ".summary-balance",
      value: 1000,
      context: "Account Balance € 1,000.00",
      score: 4.4,
    });
    const second = candidate({
      selector: ".header-balance",
      value: 1000,
      context: "Account Balance € 1,000.00",
      score: 4.4,
    });

    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [first, second],
      gemini: { value: 1000, currency: "EUR" },
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("gemini_supported");
    expect(result.candidate.selector).toBe(".summary-balance");
    expect(result.candidate.geminiSupported).toBe(true);
  });

  it("requires user choice when two high scoring DOM candidates are close", () => {
    const result = resolveExtractionChoice({
      signalKey: "free_cash",
      candidates: [
        candidate({ selector: ".cash-a", value: 50, score: 4.2 }),
        candidate({ selector: ".cash-b", value: 75, score: 3.6 }),
      ],
    });

    expect(result.kind).toBe("choice_required");
  });

  it("requires user choice when Gemini conflicts with DOM candidates", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [
        candidate({ selector: ".balance-a", value: 1000, score: 4.4 }),
        candidate({ selector: ".balance-b", value: 1200, score: 4.0 }),
      ],
      gemini: { value: 1500, currency: "EUR" },
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") {
      throw new Error("Expected choice_required");
    }
    expect(result.candidates[0]?.selector).toBe(GEMINI_ONLY_SELECTOR);
    expect(result.candidates[0]?.value).toBe(1500);
    expect(result.candidates.slice(1).map((c) => c.selector)).toEqual([
      ".balance-a",
      ".balance-b",
    ]);
  });

  it("shows only one choice per numeric value when Gemini conflicts", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [
        candidate({ selector: ".balance-a", value: 1000, score: 4.4 }),
        candidate({ selector: ".balance-b", value: 1000.002, score: 4.0 }),
        candidate({ selector: ".balance-c", value: 1200, score: 3.7 }),
      ],
      gemini: { value: 1500, currency: "EUR" },
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") {
      throw new Error("Expected choice_required");
    }
    expect(result.candidates.map((c) => c.value)).toEqual([1500, 1000, 1200]);
    expect(result.candidates.map((c) => c.selector)).toEqual([
      GEMINI_ONLY_SELECTOR,
      ".balance-a",
      ".balance-c",
    ]);
  });

  it("auto-selects with a warning when strong selector agreement beats Gemini disagreement", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [
        candidate({
          selector: ".catalog-total",
          value: 1000,
          score: 5.0,
          origin: "selector",
        }),
        candidate({
          selector: ".heuristic-total",
          value: 1000.002,
          score: 4.5,
          origin: "heuristic",
        }),
      ],
      gemini: { value: 1500, currency: "EUR" },
      safeMode: false,
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("selector_supported");
    expect(result.warnings).toEqual(["gemini_disagreement"]);
  });

  it("requires user choice when Gemini conflicts even if a DOM candidate scores strongly", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [
        candidate({ selector: ".balance-a", value: 1000, score: 5.0 }),
        candidate({ selector: ".balance-b", value: 1200, score: 2.0 }),
      ],
      gemini: { value: 1500, currency: "EUR" },
      safeMode: false,
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") throw new Error("Expected choice_required");
    expect(result.candidates[0]?.selector).toBe(GEMINI_ONLY_SELECTOR);
  });

  it("auto-selects only when selector and heuristic origins agree on the value", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [
        candidate({ selector: ".selector-total", value: 1000, score: 5.2, origin: "selector" }),
        candidate({ selector: ".heuristic-total", value: 1000.002, score: 4.4, origin: "heuristic" }),
        candidate({ selector: ".other", value: 500, score: 1.8, origin: "heuristic" }),
      ],
      safeMode: false,
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("selector_supported");
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(result.confidence).toBeLessThan(1);
  });

  it("auto-selects a high-confidence catalog selector even without a heuristic twin", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [
        candidate({
          selector: ".catalog-total",
          value: 1000,
          score: 5.2,
          origin: "selector",
        }),
        candidate({
          selector: ".other",
          value: 500,
          score: 1.8,
          origin: "heuristic",
        }),
      ],
      safeMode: false,
    });

    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") throw new Error("Expected selected");
    expect(result.source).toBe("selector_supported");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("requires user choice for a lone portfolio heuristic candidate", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [
        candidate({
          selector: ".summary-total",
          value: 1000,
          score: 4.8,
          origin: "heuristic",
        }),
      ],
      safeMode: false,
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") {
      throw new Error("Expected choice_required");
    }
    expect(result.candidates[0]?.selector).toBe(".summary-total");
  });

  it("does not bypass Gemini conflicts when confidence is >= 70% but safeMode is true", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [
        candidate({ selector: ".balance-a", value: 1000, score: 5.0 }),
        candidate({ selector: ".balance-b", value: 1200, score: 2.0 }),
      ],
      gemini: { value: 1500, currency: "EUR" },
      safeMode: true,
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") throw new Error("Expected choice_required");
    expect(result.candidates[0]?.selector).toBe(GEMINI_ONLY_SELECTOR);
  });

  it("does not auto-select a lone low-score heuristic candidate against Gemini", () => {
    const result = resolveExtractionChoice({
      signalKey: "portfolio_value",
      candidates: [candidate({ selector: ".balance-a", value: 1000, score: 2.5 })],
      gemini: { value: 1500, currency: "EUR" },
      safeMode: false,
    });

    expect(result.kind).toBe("choice_required");
    if (result.kind !== "choice_required") throw new Error("Expected choice_required");
    expect(result.candidates[0]?.selector).toBe(GEMINI_ONLY_SELECTOR);
  });

  it("shows only one equal zero-value candidate to the user", () => {
    const available = candidate({
      selector:
        'section[aria-label="Account overview"] > div.summary-row:nth-of-type(1) > div:nth-of-type(1)',
      text: "€ 0.00",
      value: 0,
      score: 4.4,
      context: "Available for investment € 0.00",
      origin: "heuristic",
    });
    const invested = candidate({
      selector:
        'section[aria-label="Account overview"] > div.summary-row:nth-of-type(2) > div:nth-of-type(1)',
      text: "€ 0.00",
      value: 0,
      score: 4.4,
      context: "Invested funds € 0.00",
      origin: "heuristic",
    });

    const firstRun = resolveExtractionChoice({
      signalKey: "free_cash",
      candidates: [available, invested],
      safeMode: false,
    });

    expect(firstRun.kind).toBe("choice_required");
    if (firstRun.kind !== "choice_required") {
      throw new Error("Expected choice_required");
    }
    expect(firstRun.candidates).toHaveLength(1);
    expect(firstRun.candidates[0]?.selector).toBe(available.selector);

    const selected = firstRun.candidates[0]!;
    if (!selected.fingerprint) throw new Error("Expected candidate fingerprint");
    const stored: SelectorProfile = {
      platformId: "peerberry",
      signalKey: "free_cash",
      selector: selected.selector,
      fingerprint: selected.fingerprint,
      confidence: 1,
      source: "user",
      learnedAt: "2026-06-16T10:00:00.000Z",
    };
    const secondRun = resolveExtractionChoice({
      signalKey: "free_cash",
      candidates: [available, invested],
      storedProfile: stored,
      safeMode: false,
    });

    expect(secondRun.kind).toBe("selected");
    if (secondRun.kind !== "selected") throw new Error("Expected selected");
    expect(secondRun.source).toBe("stored");
    expect(secondRun.value).toBe(0);
    expect(secondRun.candidate.selector).toBe(selected.selector);
  });
});
