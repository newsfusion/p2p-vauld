import { describe, expect, it } from "vitest";
import {
  computeConfidence,
  countAgreementEvidence,
} from "../../src/shared/scoring.js";

describe("confidence scoring", () => {
  it("caps lone-candidate confidence below the auto-select threshold", () => {
    const confidence = computeConfidence({
      topScore: 5.5,
      secondScore: null,
      candidateCount: 1,
      agreementCount: 1,
    });

    expect(confidence).toBeLessThan(0.85);
  });

  it("rewards independent agreement without returning perfect confidence", () => {
    const confidence = computeConfidence({
      topScore: 5.5,
      secondScore: 2.1,
      candidateCount: 4,
      agreementCount: 2,
    });

    expect(confidence).toBeGreaterThanOrEqual(0.85);
    expect(confidence).toBeLessThan(1);
  });

  it("demotes suspicious plausibility even when score evidence is strong", () => {
    const confidence = computeConfidence({
      topScore: 6,
      secondScore: 1,
      candidateCount: 3,
      agreementCount: 2,
      plausibility: "suspicious",
    });

    expect(confidence).toBeLessThan(0.72);
  });
});

describe("agreement evidence counting", () => {
  it("counts a selector-origin candidate as independent catalog evidence", () => {
    const evidence = countAgreementEvidence(
      [{ value: 1000, origin: "selector" }],
      1000,
    );

    expect(evidence).toBe(2);
  });

  it("keeps heuristic-only matches as one evidence source", () => {
    const evidence = countAgreementEvidence(
      [{ value: 1000, origin: "heuristic" }],
      1000,
    );

    expect(evidence).toBe(1);
  });

  it("counts selector, heuristic, and Gemini support as three sources", () => {
    const evidence = countAgreementEvidence(
      [
        { value: 1000, origin: "selector" },
        { value: 1000.002, origin: "heuristic", geminiSupported: true },
      ],
      1000,
    );

    expect(evidence).toBe(3);
  });
});
