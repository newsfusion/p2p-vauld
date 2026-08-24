import type {
  PlatformCatalogEntry,
  PlatformId,
} from "../shared/types/index.js";

interface ResolveSyncTargetsInput {
  catalog: PlatformCatalogEntry[];
  configuredPlatformIds: PlatformId[];
  disabledPlatformIds: PlatformId[];
  requestedPlatformIds?: PlatformId[];
}

export function resolveSyncTargets({
  catalog,
  configuredPlatformIds,
  disabledPlatformIds,
  requestedPlatformIds,
}: ResolveSyncTargetsInput): PlatformCatalogEntry[] {
  const disabledSet = new Set(disabledPlatformIds);
  const activeCatalog = catalog.filter(
    (platform) => platform.enabled && !disabledSet.has(platform.id),
  );

  if (requestedPlatformIds !== undefined) {
    const configuredSet = new Set(
      configuredPlatformIds.filter((id) => !disabledSet.has(id)),
    );
    const requestedSet = new Set(
      requestedPlatformIds.filter(
        (id) => !disabledSet.has(id) && configuredSet.has(id),
      ),
    );
    return activeCatalog.filter((platform) => requestedSet.has(platform.id));
  }

  const configuredSet = new Set(
    configuredPlatformIds.filter((id) => !disabledSet.has(id)),
  );
  return activeCatalog.filter((platform) => configuredSet.has(platform.id));
}
