import { expect, test } from "@playwright/test";
import { build } from "vite";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import catalog from "../../src/shared/platforms/platform-catalog.json" with { type: "json" };
import type {
  FinancialSignalKey,
  PlatformId,
} from "../../src/shared/types/index.js";
import { dashboardFixture } from "../fixtures/platform-html-bundle.js";
import confidenceManifest from "../fixtures/dashboards/confidence-baselines.json" with { type: "json" };
import {
  assertConfidenceRatchet,
  createConfidenceRecorder,
  isUpdateMode,
  type ConfidenceManifestEntry,
  type SignalExpectation,
} from "./confidence-ratchet.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(
  __dirname,
  "../fixtures/extractor-bundle.confidence.js",
);
const CONFIDENCE_MANIFEST_PATH = join(
  __dirname,
  "../fixtures/dashboards/confidence-baselines.json",
);

const manifest = confidenceManifest as ConfidenceManifestEntry[];
const recorder = createConfidenceRecorder("synthetic dashboard fixtures");

test.setTimeout(60_000);

async function buildExtractorBundle(): Promise<void> {
  await build({
    logLevel: "silent",
    configFile: false,
    build: {
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: join(__dirname, "../fixtures/extractor-test-entry.ts"),
        name: "p2pExtractorBundle",
        formats: ["iife"],
        fileName: () => "extractor-bundle.confidence.js",
      },
      outDir: join(__dirname, "../fixtures"),
    },
  });
}

function catalogEntry(platformId: PlatformId) {
  const entry = catalog.find((platform) => platform.id === platformId);
  if (!entry) throw new Error(`Missing catalog entry for ${platformId}`);
  return entry;
}

function selectorsFor(
  platformId: PlatformId,
  signalKey: FinancialSignalKey,
): string[] {
  const entry = catalogEntry(platformId);
  switch (signalKey) {
    case "portfolio_value":
      return entry.dashboard.portfolioValueSelectors;
    case "free_cash":
      return entry.dashboard.freeCashSelectors;
    case "net_annual_return":
      return entry.dashboard.netAnnualReturnSelectors;
  }
}

function keywordsFor(platformId: PlatformId) {
  return catalogEntry(platformId).dashboard.keywords ?? {};
}

function excludeKeywordsFor(platformId: PlatformId) {
  return catalogEntry(platformId).dashboard.excludeKeywords ?? {};
}

test.beforeAll(async () => {
  await buildExtractorBundle();
});

test.afterAll(() => {
  recorder.printSummary();
  recorder.writeUpdatedManifest(manifest, CONFIDENCE_MANIFEST_PATH);
});

test.describe("synthetic dashboard confidence baselines", () => {
  for (const item of manifest) {
    test(`${item.platformId} fixture has a catalog entry and synthetic HTML`, () => {
      expect(catalogEntry(item.platformId)).toBeTruthy();
      const fixture = dashboardFixture(item.platformId);
      expect(item.fixture).toBe(fixture.fileName);
      expect(fixture.html).toContain("<html");
    });

    for (const [signalKey, expectation] of Object.entries(item.signals) as Array<
      [FinancialSignalKey, SignalExpectation]
    >) {
      test(`${item.platformId} ratchets ${signalKey} confidence on saved HTML`, async ({
        page,
      }, testInfo) => {
        await page.setContent(dashboardFixture(item.platformId).html, {
          waitUntil: "domcontentloaded",
        });
        await page.addScriptTag({ content: readFileSync(BUNDLE_PATH, "utf8") });

        const result = await page.evaluate(
          ({ key, selectors, keywords, excludeKeywords }) =>
            window.p2pExtractor.extractSignal(
              key,
              selectors,
              keywords,
              excludeKeywords,
            ),
          {
            key: signalKey,
            selectors: selectorsFor(item.platformId, signalKey),
            keywords: keywordsFor(item.platformId),
            excludeKeywords: excludeKeywordsFor(item.platformId),
          },
        );

        recorder.record(item.platformId, signalKey, expectation, result);
        if (!isUpdateMode()) {
          assertConfidenceRatchet(testInfo, result, expectation);
        }
      });
    }
  }
});
