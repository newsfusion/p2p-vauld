import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEMO_LOCAL_MATCH_PATTERNS,
  transformExtensionManifest,
} from "../../src/shared/manifest-transform.js";

type Manifest = {
  permissions: string[];
  host_permissions: string[];
  content_scripts: Array<{ matches: string[] }>;
};

type PlatformCatalogEntry = {
  id: string;
  domains: string[];
  login: {
    entryUrl: string;
  };
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function readJson<T>(relativePath: string): T {
  const absolutePath = join(repoRoot, relativePath);
  const raw = readFileSync(absolutePath, "utf-8");
  return JSON.parse(raw) as T;
}

function getExpectedHostPatterns(catalog: PlatformCatalogEntry[]): string[] {
  const hosts = new Set<string>();

  for (const platform of catalog) {
    for (const domain of platform.domains) {
      hosts.add(domain);
    }

    hosts.add(new URL(platform.login.entryUrl).host);
  }

  return [...hosts].map((host) => `https://${host}/*`).sort();
}

function getSortedUniquePatterns(patterns: string[]): string[] {
  return [...new Set(patterns)].sort();
}

function expectExactHostCoverage(
  actualPatterns: string[],
  expectedPatterns: string[],
): void {
  expect(getSortedUniquePatterns(actualPatterns)).toEqual(expectedPatterns);
}

function expectNoWildcardSubdomains(patterns: string[]): void {
  for (const pattern of patterns) {
    expect(pattern).not.toContain("://*.");
  }
}

function allManifestMatches(manifest: Manifest): string[] {
  return manifest.content_scripts.flatMap((script) => script.matches);
}

function expectNoDemoLocalPatterns(patterns: string[]): void {
  for (const pattern of DEMO_LOCAL_MATCH_PATTERNS) {
    expect(patterns).not.toContain(pattern);
  }
}

describe("manifest domain permissions", () => {
  it("grants the Chrome favicon permission for dynamic platform icons", () => {
    const manifest = readJson<Manifest>("manifest.json");

    expect(manifest.permissions).toContain("favicon");
  });

  it("keeps demo localhost access out of the base manifest", () => {
    const manifest = readJson<Manifest>("manifest.json");

    expectNoDemoLocalPatterns(manifest.host_permissions);
    expectNoDemoLocalPatterns(allManifestMatches(manifest));
  });

  it("keeps production manifest output free of demo localhost access", () => {
    const manifest = readJson<Manifest>("manifest.json");
    const transformed = transformExtensionManifest(
      {
        ...manifest,
        host_permissions: [
          ...DEMO_LOCAL_MATCH_PATTERNS,
          ...manifest.host_permissions,
        ],
        content_scripts: manifest.content_scripts.map((script) => ({
          ...script,
          matches: [...DEMO_LOCAL_MATCH_PATTERNS, ...script.matches],
        })),
      },
      false,
    );

    expectNoDemoLocalPatterns(transformed.host_permissions);
    expectNoDemoLocalPatterns(allManifestMatches(transformed));
  });

  it("adds demo localhost access only for demo manifest output", () => {
    const manifest = readJson<Manifest>("manifest.json");
    const transformed = transformExtensionManifest(manifest, true);

    expect(transformed.host_permissions).toEqual([...DEMO_LOCAL_MATCH_PATTERNS]);
    expect(allManifestMatches(transformed)).toEqual([
      ...DEMO_LOCAL_MATCH_PATTERNS,
    ]);
  });

  it("uses least-privilege exact hosts for all catalog navigation targets", () => {
    const manifest = readJson<Manifest>("manifest.json");
    const catalog = readJson<PlatformCatalogEntry[]>(
      "src/shared/platforms/platform-catalog.json"
    );
    const expectedPatterns = getExpectedHostPatterns(catalog);
    const matches = allManifestMatches(manifest);

    expectExactHostCoverage(manifest.host_permissions, expectedPatterns);
    expectExactHostCoverage(matches, expectedPatterns);
    expectNoWildcardSubdomains(manifest.host_permissions);
    expectNoWildcardSubdomains(matches);
  });
});
