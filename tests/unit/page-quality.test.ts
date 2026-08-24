import { describe, expect, it } from "vitest";
import { isWellEvidenced, pageQualityScore } from "../../src/shared/page-quality";
import type { ExtractionCandidate } from "../../src/shared/types/index";

function candidate(overrides: Partial<ExtractionCandidate> = {}): ExtractionCandidate {
  return {
    selector: ".value",
    text: "€1.234,56",
    value: 1234.56,
    score: 4,
    origin: "heuristic",
    keywordHits: 1,
    ...overrides,
  };
}

describe("isWellEvidenced", () => {
  it("rejects a null value", () => {
    expect(isWellEvidenced({ value: null })).toBe(false);
  });

  it("rejects when there is no candidate at all", () => {
    expect(isWellEvidenced({ value: 1234.56 })).toBe(false);
  });

  it("accepts a keyword-labelled heuristic candidate", () => {
    expect(
      isWellEvidenced({ value: 1234.56, candidate: candidate() }),
    ).toBe(true);
  });

  it("accepts a platform selector candidate without keyword hits", () => {
    expect(
      isWellEvidenced({
        value: 1234.56,
        candidate: candidate({ origin: "selector", keywordHits: 0 }),
      }),
    ).toBe(true);
  });

  it("accepts a stored-profile candidate", () => {
    expect(
      isWellEvidenced({
        value: 1234.56,
        candidate: candidate({ source: "stored", keywordHits: 0, origin: "heuristic" }),
      }),
    ).toBe(true);
  });

  // The Debitum regression: an investments list yields currency-typed candidates
  // scoring 2.4 (type match +2, magnitude +0.4) with zero keyword hits.
  it("rejects an unlabelled currency value from an investments list", () => {
    expect(
      isWellEvidenced({
        value: 30,
        candidate: candidate({ score: 2.4, keywordHits: 0, text: "€30.00" }),
      }),
    ).toBe(false);
  });

  it("rejects a keyword hit that still scores below the auto-select bar", () => {
    expect(
      isWellEvidenced({
        value: 1234.56,
        candidate: candidate({ score: 2.9, keywordHits: 1 }),
      }),
    ).toBe(false);
  });

  it("falls back to the top of allCandidates when no winner is given", () => {
    expect(
      isWellEvidenced({ value: 1234.56, allCandidates: [candidate()] }),
    ).toBe(true);
  });
});

describe("pageQualityScore", () => {
  const overviewPage = {
    portfolio: { value: 12000, candidate: candidate({ score: 5, keywordHits: 2 }) },
    freeCash: { value: 35.55, candidate: candidate({ score: 4, keywordHits: 1 }) },
  };
  const investmentsListPage = {
    portfolio: { value: 30, candidate: candidate({ score: 2.4, keywordHits: 0 }) },
    freeCash: { value: 28.97, candidate: candidate({ score: 2.4, keywordHits: 0 }) },
  };
  const emptyPage = { portfolio: { value: null }, freeCash: { value: null } };

  it("ranks an overview page above an investments list", () => {
    expect(pageQualityScore(overviewPage)).toBeGreaterThan(
      pageQualityScore(investmentsListPage),
    );
  });

  it("ranks an investments list above a page with nothing on it", () => {
    expect(pageQualityScore(investmentsListPage)).toBeGreaterThan(
      pageQualityScore(emptyPage),
    );
  });

  it("scores an empty page at zero", () => {
    expect(pageQualityScore(emptyPage)).toBe(0);
  });

  it("penalises contradicting signals", () => {
    const clean = pageQualityScore(overviewPage);
    const contradicting = pageQualityScore({
      ...overviewPage,
      warnings: ["free_cash_exceeds_portfolio"],
    });
    expect(contradicting).toBeLessThan(clean);
  });

  it("weights the portfolio value above free cash", () => {
    const portfolioOnly = pageQualityScore({
      portfolio: { value: 12000, candidate: candidate({ score: 5 }) },
      freeCash: { value: null },
    });
    const freeCashOnly = pageQualityScore({
      portfolio: { value: null },
      freeCash: { value: 35.55, candidate: candidate({ score: 5 }) },
    });
    expect(portfolioOnly).toBeGreaterThan(freeCashOnly);
  });
});
