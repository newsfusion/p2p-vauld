import {
  getPlatformById,
  getPlatformCatalog,
} from "../../../src/shared/platforms/index.js";
import {
  PLATFORM_IDS as CANONICAL_PLATFORM_IDS,
  type PlatformCatalogEntry,
  type PlatformId,
} from "../../../src/shared/types/index.js";
import {
  dashboardFixture as getSyntheticDashboardFixture,
  loginFixture as getSyntheticLoginFixture,
} from "../../fixtures/platform-html-bundle.js";

const FIXTURE_PLATFORM_IDS = [
  "mintos",
  "debitum",
  "estateguru",
  "income_marketplace",
  "indemo",
  "peerberry",
  "triple_dragon",
] as const satisfies readonly PlatformId[];

type FixturePlatformId = (typeof FIXTURE_PLATFORM_IDS)[number];

export const PLATFORM_IDS: PlatformId[] = [...FIXTURE_PLATFORM_IDS];
export const DASHBOARD_PLATFORM_IDS: PlatformId[] = [...FIXTURE_PLATFORM_IDS];

const FIXTURE_NAMES: Record<FixturePlatformId, string> = {
  mintos: "mintos.html",
  debitum: "debitum-investments.html",
  estateguru: "estateguru-com.html",
  income_marketplace: "income-marketplace.html",
  indemo: "indemo.html",
  peerberry: "peerberry.html",
  triple_dragon: "triple-dragon.html",
};

export function getFixtureFilename(platformId: PlatformId): string {
  const fixtureName = FIXTURE_NAMES[platformId as FixturePlatformId];
  if (!fixtureName) {
    throw new Error(`No fixture filename for ${platformId}`);
  }
  return fixtureName;
}

export function getPlatformConfig(platformId: PlatformId): PlatformCatalogEntry {
  const platform = getPlatformById(platformId);
  if (!platform) {
    throw new Error(`Unknown platform id: ${platformId}`);
  }
  return platform;
}

export function createMockLanguageModel(response = "{}") {
  return {
    create: async () => ({
      prompt: async () => response,
      destroy: () => {},
    }),
  };
}

export function loadFixtureHtml(
  kind: "dashboards" | "logins",
  filename: string,
): string {
  const platformId = platformIdFromFilename(filename);
  return kind === "dashboards"
    ? getSyntheticDashboardFixture(platformId).html
    : getSyntheticLoginFixture(platformId).html;
}

function platformIdFromFilename(filename: string): PlatformId {
  const entry = Object.entries(FIXTURE_NAMES).find(
    ([, fixtureName]) => fixtureName === filename,
  );
  if (entry) return entry[0] as PlatformId;

  const normalized = filename
    .replace(/\.html$/u, "")
    .replace(/-/gu, "_");
  const platform = getPlatformCatalog().find((item) => item.id === normalized);
  if (!platform) {
    throw new Error(`No fixture mapping for ${filename}`);
  }
  return platform.id;
}
