import { expect, test } from "@playwright/test";
import { build } from "vite";
import { dirname, join } from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import catalog from "../../src/shared/platforms/platform-catalog.json" with { type: "json" };
import expectedManifest from "../fixtures/dashboards/expected-values.json" with { type: "json" };
import { dashboardFixture } from "../fixtures/platform-html-bundle.js";
import type { FinancialSignalKey, PlatformId } from "../../src/shared/types/index.js";
import {
  assertConfidenceRatchet,
  createConfidenceRecorder,
  isUpdateMode,
  type ConfidenceManifestEntry,
  type SignalExpectation,
} from "./confidence-ratchet.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_PATH = join(__dirname, "../fixtures/extractor-bundle.js");
const EXPECTED_MANIFEST_PATH = join(
  __dirname,
  "../fixtures/dashboards/expected-values.json",
);
const manifest = expectedManifest as ConfidenceManifestEntry[];
const recorder = createConfidenceRecorder("synthetic connector fixtures");

const FIXTURE_NAMES: Partial<Record<PlatformId, string>> = {
  mintos: "mintos.html",
  debitum: "debitum-investments.html",
  estateguru: "estateguru-com.html",
  income_marketplace: "income-marketplace.html",
  indemo: "indemo.html",
  peerberry: "peerberry.html",
  triple_dragon: "triple-dragon.html",
};

function loadFixtureHtml(platformId: PlatformId): string {
  return dashboardFixture(platformId).html;
}

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
        fileName: () => "extractor-bundle.js",
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

function selectorsFor(platformId: PlatformId, signalKey: FinancialSignalKey): string[] {
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
  recorder.writeUpdatedManifest(manifest, EXPECTED_MANIFEST_PATH);
});

test.describe("connector fixture manifest", () => {
  for (const item of manifest) {
    test(`${item.platformId} fixture has a catalog entry and generated HTML`, () => {
      expect(catalogEntry(item.platformId)).toBeTruthy();
      expect(item.fixture).toBe(FIXTURE_NAMES[item.platformId]);
      expect(loadFixtureHtml(item.platformId)).toContain("<html");
    });
  }
});

test.describe("real extractor bundle", () => {
  for (const item of manifest) {
    for (const [signalKey, expectation] of Object.entries(item.signals) as Array<
      [FinancialSignalKey, SignalExpectation]
    >) {
      test(`${item.platformId} extracts ${signalKey} with the production extractor`, async ({
        page,
      }, testInfo) => {
        await page.setContent(loadFixtureHtml(item.platformId));
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
