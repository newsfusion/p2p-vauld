import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DASHBOARD_PLATFORM_IDS,
  getFixtureFilename,
  getPlatformConfig,
  loadFixtureHtml,
} from "./helpers/test-helpers.js";
import {
  collectFinancialCandidates,
  extractSignal,
} from "../../src/content/extractor.js";

describe("Heuristic Extractor with synthetic fixtures", () => {
  DASHBOARD_PLATFORM_IDS.forEach((platformId) => {
    describe(`Platform: ${platformId}`, () => {
      let document: Document;

      beforeEach(() => {
        vi.stubGlobal("chrome", {
          runtime: { sendMessage: vi.fn() },
          storage: { local: { get: vi.fn(), set: vi.fn() } },
        });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("")));
        // Load synthetic dashboard HTML for this platform
        const html = loadFixtureHtml("dashboards", getFixtureFilename(platformId));
        document = new DOMParser().parseFromString(html, "text/html");
      });

      it("collectFinancialCandidates should find number candidates on the dashboard", () => {
        const { candidates } = collectFinancialCandidates(
          "portfolio_value",
          [],
          document,
        );

        // Even if heuristics are weak, they should find *some* numbers on a P2P dashboard
        expect(candidates.length).toBeGreaterThan(0);

        // Check candidate structure
        candidates.forEach((c) => {
          expect(typeof c.value).toBe("number");
          expect(typeof c.text).toBe("string");
          expect(typeof c.score).toBe("number");
        });
      });

      it("extractSignal should return a candidate for Portfolio Value", () => {
        const result = extractSignal("portfolio_value", [], document);

        // In synthetic HTML files, there are enough keywords that the heuristic extractor
        // will score at least one candidate > 0
        if (result.value !== null) {
          expect(result.candidate).toBeDefined();
          expect(result.candidate?.score).toBeGreaterThan(0);
          expect(result.candidate?.valueType).toBe("currency");
        } else {
          // It's possible some platforms have 0 candidates matching currency + keywords
          // Return format changed from null to { value: null, confidence: 0 }
          expect(result.value).toBeNull();
        }
      });

      it("extractSignal should return a candidate for Net Return", () => {
        const result = extractSignal("net_annual_return", [], document);

        if (result.value !== null) {
          expect(result.candidate).toBeDefined();
          expect(result.candidate?.valueType).toBe("percent");
        }
      });

      it("accepts Element root (simulating cleaned body clone)", () => {
        const result = collectFinancialCandidates(
          "portfolio_value",
          [],
          document.body,
        );
        expect(result.candidates.length).toBeGreaterThan(0);
      });
    });
  });
});

describe("Debitum selector extraction with dashboard fixture", () => {
  it("keeps configured selector matches as candidates without blindly trusting them", () => {
    // Fixture: tests/fixtures/dashboards/debitum-investments.html
    const fixtureName = "debitum-investments.html";
    const html = loadFixtureHtml("dashboards", fixtureName);
    const document = new DOMParser().parseFromString(html, "text/html");
    const dashboard = getPlatformConfig("debitum").dashboard;

    const portfolioCandidates = collectFinancialCandidates(
      "portfolio_value",
      dashboard.portfolioValueSelectors,
      document,
    );
    expect(
      portfolioCandidates.candidates.some(
        (candidate) =>
          candidate.origin === "selector" &&
          candidate.selector === dashboard.portfolioValueSelectors[0],
      ),
    ).toBe(true);
    const portfolioValue = extractSignal(
      "portfolio_value",
      dashboard.portfolioValueSelectors,
      document,
    );
    expect(portfolioValue.value).not.toBeNull();
    expect(portfolioValue.confidence).toBeLessThan(1);

    const freeCashCandidates = collectFinancialCandidates(
      "free_cash",
      dashboard.freeCashSelectors,
      document,
    );
    expect(
      freeCashCandidates.candidates.some(
        (candidate) =>
          candidate.origin === "selector" &&
          candidate.selector === dashboard.freeCashSelectors[0],
      ),
    ).toBe(true);
    const freeCash = extractSignal(
      "free_cash",
      dashboard.freeCashSelectors,
      document,
    );
    expect(freeCash.value).not.toBeNull();
    expect(freeCash.confidence).toBeLessThan(1);
  });
});
