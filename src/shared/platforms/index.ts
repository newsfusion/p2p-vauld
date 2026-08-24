import {
  PLATFORM_IDS,
  type PlatformCatalogEntry,
  type PlatformDescriptor,
  type PlatformId,
} from "../types/index.js";
import catalogJson from "./platform-catalog.json";
import { getConnectorStrategy } from "./connector-strategies.js";
import { applyDemoCatalogOverrides } from "../demo.js";

const PLATFORM_ID_SET = new Set<string>(PLATFORM_IDS);

function isPlatformId(value: string): value is PlatformId {
  return PLATFORM_ID_SET.has(value);
}

const catalog: PlatformCatalogEntry[] = catalogJson.map((entry) => {
  if (!isPlatformId(entry.id)) {
    throw new Error(`Unknown platform id in catalog: ${entry.id}`);
  }
  const strategy = getConnectorStrategy(entry.strategy);

  return {
    ...entry,
    id: entry.id,
    strategy: strategy.id as PlatformDescriptor["strategy"],
  };
});

const platformIdTypeCheck: PlatformId[] = catalog.map((platform) => platform.id);
void platformIdTypeCheck;

export function getPlatformCatalog(): PlatformCatalogEntry[] {
  return applyDemoCatalogOverrides(catalog);
}

export function listEnabledPlatforms(): PlatformDescriptor[] {
  return catalog.filter((p) => p.enabled);
}

export function getPlatformById(id: PlatformId): PlatformCatalogEntry | undefined {
  return catalog.find((p) => p.id === id);
}

export function getPlatformByDomain(domain: string): PlatformCatalogEntry | undefined {
  return catalog.find((p) =>
    p.domains.some((d) => domain === d || domain.endsWith(`.${d}`))
  );
}
