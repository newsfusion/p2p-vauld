import { describe, expect, it } from "vitest";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";
import { PLATFORM_IDS } from "../../src/shared/types/index.js";
import {
  getPlatformMetadata,
  getPlatformMetadataByConnectorId,
  type PlatformMetadataEntry,
} from "../../src/shared/platforms/metadata.js";

const GROUPS = new Set(["invested", "extended"]);
const NEW_EU_PLATFORM_IDS = [
  "goparity",
  "wiwin",
  "bettervest",
  "dagobertinvest",
  "rendity",
] as const;
const NEW_EU_PLATFORM_CONNECTOR_OVERRIDES = new Map<string, {
  domains: string[];
  entryUrl: string;
}>([
  [
    "goparity",
    {
      domains: ["goparity.com", "www.goparity.com", "app.goparity.com"],
      entryUrl: "https://app.goparity.com/login",
    },
  ],
  [
    "wiwin",
    {
      domains: ["wiwin.de", "wiwin-invest.de"],
      entryUrl: "https://wiwin-invest.de/login",
    },
  ],
  [
    "bettervest",
    {
      domains: ["bettervest.com", "www.bettervest.com"],
      entryUrl: "https://www.bettervest.com/wp-login.php",
    },
  ],
  [
    "dagobertinvest",
    {
      domains: ["dagobertinvest.com", "www.dagobertinvest.com"],
      entryUrl: "https://www.dagobertinvest.com/login",
    },
  ],
  [
    "rendity",
    {
      domains: ["rendity.com"],
      entryUrl: "https://rendity.com/en/login",
    },
  ],
]);
const TUNED_CONNECTOR_IDS = new Set([
  "mintos",
  "bondora_go_grow",
  "peerberry",
  "robocash",
  "twino",
  "estateguru",
  "debitum",
  "esketit",
  "viainvest",
  "nectaro",
  "afranga",
  "asterra_estate",
  "devon",
  "ff_forest",
  "ventus_energy",
  "indemo",
  "inrento",
  "crowdpear",
  "income_marketplace",
  "lande",
  "capitalia",
  "fintown",
  "monefit_smartsaver",
  "mypeak_finance",
  "triple_dragon",
  "insoil_finance",
  "crowdestor",
  "lendermarket",
  "swaper",
  "iuvo_group",
  "kviku_finance",
  "neo_finance",
  "finbee",
  "axia_funder",
  "loanch",
  "savy",
  "quanloop",
  "bergfurst",
  "exporo",
  "stock_estate",
  "shojin",
  "crowdedhero",
  "hive5",
  "lonvest",
  "landex",
  "nibble",
  "modena",
  "profitus",
  "nordstreet",
  "linked_finance",
  "letsinvest",
]);

function getHostname(value: string): string {
  return new URL(value).hostname.replace(/^www\./, "");
}

function getConnectorId(entry: PlatformMetadataEntry): string {
  return entry.connectorPlatformId ?? entry.id;
}

function hasKnownDomainMatch(
  metadata: PlatformMetadataEntry[],
  domains: string[],
): boolean {
  return metadata.some((entry) => {
    const host = getHostname(entry.websiteUrl);
    return domains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  });
}

describe("platform metadata catalog", () => {
  it("contains normalized verified entries with stable unique ids", () => {
    const metadata = getPlatformMetadata();
    const ids = new Set<string>();

    expect(metadata.length).toBeGreaterThan(40);

    for (const entry of metadata) {
      expect(entry.id).toMatch(/^[a-z0-9]+(?:_[a-z0-9]+)*$/);
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);

      expect(entry.name.trim()).toBe(entry.name);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(GROUPS.has(entry.group)).toBe(true);
      expect(entry.websiteUrl).toMatch(/^https:\/\//);
      expect(entry.expectedReturn === null || entry.expectedReturn.length > 0).toBe(true);
      expect(entry.country === null || entry.country.length > 0).toBe(true);
      expect(entry.assetType === null || entry.assetType.length > 0).toBe(true);
      expect(entry.notes === null || entry.notes.length > 0).toBe(true);
      expect(entry.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Object.hasOwn(entry, "iconUrl")).toBe(false);
    }
  });

  it("omits source entries that do not have verifiable official URLs", () => {
    const ids = getPlatformMetadata().map((entry) => entry.id);

    expect(ids).not.toContain("quicko");
    expect(ids).not.toContain("lendiball");
    expect(ids).not.toContain("decamel");
    expect(ids).not.toContain("brickfy");
  });

  it("includes the selected EU and DACH platform additions", () => {
    const metadataIds = new Set(getPlatformMetadata().map((entry) => entry.id));
    const catalogIds = new Set(getPlatformCatalog().map((entry) => entry.id));
    const platformIds = new Set<string>(PLATFORM_IDS);

    for (const platformId of NEW_EU_PLATFORM_IDS) {
      expect(metadataIds.has(platformId), `${platformId} metadata`).toBe(true);
      expect(catalogIds.has(platformId), `${platformId} catalog`).toBe(true);
      expect(platformIds.has(platformId), `${platformId} PlatformId`).toBe(true);
    }
  });

  it("links every sync connector to metadata by connector id or known domain", () => {
    const metadata = getPlatformMetadata();

    for (const connector of getPlatformCatalog()) {
      const linked = getPlatformMetadataByConnectorId(connector.id);
      const matchedByDomain = hasKnownDomainMatch(metadata, connector.domains);

      expect(linked !== undefined || matchedByDomain).toBe(true);
    }
  });

  it("maps every metadata platform to exactly one enabled catalog connector", () => {
    const metadata = getPlatformMetadata();
    const catalog = getPlatformCatalog();
    const catalogById = new Map<string, (typeof catalog)[number]>(
      catalog.map((entry) => [entry.id, entry]),
    );
    const expectedConnectorIds = metadata.map(getConnectorId);

    expect(new Set(expectedConnectorIds).size).toBe(metadata.length);
    expect(catalog).toHaveLength(metadata.length);

    for (const entry of metadata) {
      const connectorId = getConnectorId(entry);
      const catalogEntry = catalogById.get(connectorId);

      expect(catalogEntry).toBeDefined();
      expect(catalogEntry?.enabled).toBe(true);
      expect(catalogEntry?.strategy).toBe("universal");
      expect(catalogEntry?.name).toBe(entry.name);
    }
  });

  it("keeps every catalog connector id in the PlatformId contract", () => {
    const platformIds = new Set<string>(PLATFORM_IDS);

    for (const connector of getPlatformCatalog()) {
      expect(platformIds.has(connector.id)).toBe(true);
    }
  });

  it("scaffolds metadata-only platforms with generic universal login and heuristic dashboard extraction", () => {
    const metadataByConnectorId = new Map(
      getPlatformMetadata().map((entry) => [getConnectorId(entry), entry]),
    );

    for (const connector of getPlatformCatalog()) {
      if (TUNED_CONNECTOR_IDS.has(connector.id)) continue;

      const metadata = metadataByConnectorId.get(connector.id);
      const override = NEW_EU_PLATFORM_CONNECTOR_OVERRIDES.get(connector.id);
      expect(metadata).toBeDefined();
      expect(connector.domains).toEqual(
        override?.domains ?? [getHostname(metadata!.websiteUrl)],
      );
      expect(connector.login.entryUrl).toBe(
        override?.entryUrl ?? metadata!.websiteUrl,
      );
      expect(connector.login.usernameSelectors).toContain('input[type="email"]');
      expect(connector.login.passwordSelectors).toContain('input[type="password"]');
      expect(connector.login.submitSelectors).toContain('button[type="submit"]');
      expect(connector.login.otpSelectors).toContain(
        'input[autocomplete="one-time-code"]',
      );
      expect(connector.login.postLoginIndicators.some((indicator) =>
        indicator.startsWith("text=/"),
      )).toBe(true);
      expect(connector.dashboard.portfolioValueSelectors).toEqual([]);
      expect(connector.dashboard.freeCashSelectors).toEqual([]);
      expect(connector.dashboard.netAnnualReturnSelectors).toEqual([]);
    }
  });
});
