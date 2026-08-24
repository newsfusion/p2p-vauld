import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DASHBOARD_PLATFORM_IDS,
  getFixtureFilename,
  loadFixtureHtml,
  createMockLanguageModel,
} from "./helpers/test-helpers.js";
import {
  scanForAnchors,
  scanForAnchorsAsync,
  deduplicateAndFilter,
  buildAiPrompt,
  aiExtractSignal,
} from "../../src/content/ai-extractor.js";
import {
  getVisibleTextTree,
  textTreeToString,
  countTextNodes,
} from "../../src/content/text-tree.js";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";

vi.mock("../../src/content/ai-shared.js", () => ({
  checkAiAvailability: async () => ({ status: "available" }),
  createAiSession: async () => ({
    prompt: async () => '{"value":1234.56,"currency":"EUR"}',
    destroy: () => {},
  }),
  promptWithResponseConstraintFallback: async (
    session: { prompt: (input: string, options?: object) => Promise<string> },
    input: string,
    responseConstraint?: object,
  ) => session.prompt(input, responseConstraint ? { responseConstraint } : undefined),
}));

describe("AI Extractor with synthetic fixtures", () => {
  beforeEach(() => {
    // Mock fetch to prevent happy-dom from trying to download external CSS/JS
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("")));
  });

  DASHBOARD_PLATFORM_IDS.forEach((platformId) => {
    describe(`Platform: ${platformId}`, () => {
      let document: Document;
      let platformConfig: any;

      beforeEach(() => {
        // Load synthetic dashboard HTML for this platform
        const html = loadFixtureHtml("dashboards", getFixtureFilename(platformId));
        document = new DOMParser().parseFromString(html, "text/html");
        // Find platform config
        platformConfig = getPlatformCatalog().find((p) => p.id === platformId);
      });

      it("scanForAnchors should find relevant anchor elements", () => {
        const anchors = scanForAnchors(document);

        // Ensure it finds at least *some* anchors on a synthetic dashboard
        expect(anchors.length).toBeGreaterThan(0);

        // Most platforms will have Portfolio Value and Free Cash somewhere
        // We just ensure the structure of the returned objects is correct and they have text
        anchors.forEach((a) => {
          expect(typeof a.rawText).toBe("string");
          expect(a.rawText.trim().length).toBeGreaterThan(0);
        });
      });

      it("deduplicateAndFilter should reduce the number of anchors within token budget", () => {
        const rawAnchors = scanForAnchors(document);

        const filtered = deduplicateAndFilter(rawAnchors, [
          "portfolio",
          "value",
          "total",
          "balance",
        ]);

        // It should either reduce the count or keep it the same if it's already small
        expect(filtered.length).toBeLessThanOrEqual(rawAnchors.length);

        // Every filtered item should have a generated selector and cleaned text
        filtered.forEach((item) => {
          expect(typeof item.rawText).toBe("string");
        });
      });

      it("scanForAnchors accepts Element root", () => {
        const anchors = scanForAnchors(document.body);
        expect(anchors.length).toBeGreaterThan(0);
      });

      it("buildAiPrompt should construct a valid prompt", () => {
        const rawAnchors = scanForAnchors(document);
        const filtered = deduplicateAndFilter(rawAnchors, [
          "portfolio",
          "value",
        ]);

        const prompt = buildAiPrompt(filtered, "portfolio_value", [
          "portfolio",
          "value",
          "total",
        ]);
        expect(prompt).toContain("portfolio_value");

        // The prompt should contain JSON structure if there are anchors
        if (filtered.length > 0) {
          expect(prompt).toContain(filtered[0]!.rawText.substring(0, 10)); // At least part of the text
        }
      });

      it("text tree from fixture contains financial text", () => {
        const tree = getVisibleTextTree(document.body, { skipVisibilityCheck: true });
        expect(tree).not.toBeNull();

        const serialized = textTreeToString(tree);
        const nodeCount = countTextNodes(tree);

        // Synthetic dashboards should have meaningful text content
        expect(nodeCount).toBeGreaterThan(5);
        // Text tree should be reasonable size (not enormous)
        expect(serialized.json.length).toBeLessThan(100_000);
        // Should contain at least some numbers (financial data)
        expect(serialized.json).toMatch(/\d/);
        // Whatever pruning did, the AI must never receive broken JSON
        expect(() => JSON.parse(serialized.json)).not.toThrow();
      });

      it("aiExtractSignal should successfully run the end-to-end pipeline with mock AI", async () => {
        // We do NOT want to simulate background proxying here; we explicitly want to test the native AI fallback.
        // The beforeEach block already removed chrome.runtime.

        const result = await aiExtractSignal(
          "portfolio_value",
          ["portfolio", "value", "balance"],
          document,
        );
        // It's possible the pipeline returns no_candidates and skips AI if the dashboard HTML is completely unparseable
        // but for synthetic dashboards, it should find candidates.
        if (result === null) {
          // If null, it means deduplicateAndFilter returned 0 items.
          // We assert this explicitly.
          const anchors = scanForAnchors(document);
          const filtered = deduplicateAndFilter(anchors, [
            "portfolio",
            "value",
            "balance",
          ]);
          expect(filtered.length).toBe(0);
        } else {
          expect(result.success).toBe(true);
          expect(result.candidate).toBeDefined();
          expect(result.candidate?.value).toBe(1234.56);
        }
      });
    });
  });
});

describe("AI Extractor large DOM scanning", () => {
  it("chunked async scan finds anchors inside large DOMs", async () => {
    const document = new DOMParser().parseFromString(
      `<main>${Array.from(
        { length: 1200 },
        (_, index) =>
          `<section><span>Row ${index}</span><span>${index === 1137 ? "Available funds € 987.65" : "No balance here"}</span></section>`,
      ).join("")}</main>`,
      "text/html",
    );

    const anchors = await scanForAnchorsAsync(document);

    expect(anchors.some((anchor) => anchor.value === 987.65)).toBe(true);
    expect(
      anchors.every((anchor) => anchor.contextBubble.length <= 200),
    ).toBe(true);
  });
});
