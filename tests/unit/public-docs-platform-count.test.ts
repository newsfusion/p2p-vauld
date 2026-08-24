import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type Manifest = {
  description: string;
  version: string;
};

type PackageJson = {
  version: string;
  scripts: Record<string, string>;
};

type PlatformCatalogEntry = {
  name: string;
  enabled: boolean;
  domains: string[];
};

const PREVIOUS_RELEASE_VERSION = "0.13.2";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function readText(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf-8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readText(relativePath)) as T;
}

function getSupportedPlatformRows(readme: string): string[] {
  const tableHeader = "| Platform | Domains |";
  const tableStart = readme.indexOf(tableHeader);

  if (tableStart === -1) {
    throw new Error("README Supported Platforms table not found");
  }

  const [, separator, ...remainingLines] = readme
    .slice(tableStart)
    .split("\n")
    .map((line) => line.trim());

  if (separator !== "|---|---|") {
    throw new Error("README Supported Platforms table is malformed");
  }

  const rows: string[] = [];
  for (const line of remainingLines) {
    if (!line.startsWith("|")) break;
    rows.push(line);
  }

  return rows;
}

function getPlatformColumns(row: string): [string, string] {
  const columns = row
    .split("|")
    .map((column) => column.trim())
    .filter(Boolean);

  if (!columns[0] || !columns[1]) {
    throw new Error(`Invalid platform table row: ${row}`);
  }

  return [columns[0], columns[1]];
}

describe("public platform count documentation", () => {
  it("keeps README and manifest platform counts in sync with enabled catalog platforms", () => {
    const readme = readText("README.md");
    const manifest = readJson<Manifest>("manifest.json");
    const catalog = readJson<PlatformCatalogEntry[]>(
      "src/shared/platforms/platform-catalog.json",
    );
    const enabledPlatforms = catalog.filter((platform) => platform.enabled);
    const enabledCount = enabledPlatforms.length;

    expect(readme).toContain(
      `visualize your investments across ${enabledCount} P2P lending platforms`,
    );
    expect(readme).toContain(`**${enabledCount} P2P platforms**`);
    expect(manifest.description).toContain(`across ${enabledCount} platforms`);

    const documentedPlatforms = getSupportedPlatformRows(readme).map(
      getPlatformColumns,
    );
    const enabledPlatformRows = enabledPlatforms.map(
      (platform) => [platform.name, platform.domains.join(", ")] as const,
    );

    expect(documentedPlatforms).toEqual(enabledPlatformRows);
  });

  it("keeps extension version bumps scoped to explicit Web Store releases", () => {
    const manifest = readJson<Manifest>("manifest.json");
    const packageJson = readJson<PackageJson>("package.json");
    const agents = readText("AGENTS.md");

    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.version).not.toBe(PREVIOUS_RELEASE_VERSION);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packageJson.scripts.prebuild).toBeUndefined();
    expect(packageJson.scripts["release:webstore"]).toContain(
      "prepare-webstore-release.mjs",
    );
    expect(agents).not.toContain(
      "Change always the Version number in `manifest.json` if you make any changes.",
    );
    expect(agents).toContain(
      "Only Web Store release preparation may bump `manifest.json` version",
    );
  });

});
