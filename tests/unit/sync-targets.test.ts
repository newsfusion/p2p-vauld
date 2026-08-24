import { describe, expect, it } from "vitest";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";
import { resolveSyncTargets } from "../../src/background/sync-targets.js";
import type { PlatformId } from "../../src/shared/types/index.js";

describe("resolveSyncTargets", () => {
  it("excludes disabled platforms from sync-all selection", () => {
    const targets = resolveSyncTargets({
      catalog: getPlatformCatalog(),
      configuredPlatformIds: ["mintos", "peerberry"] as PlatformId[],
      disabledPlatformIds: ["peerberry"] as PlatformId[],
    });

    expect(targets.map((platform) => platform.id)).toEqual(["mintos"]);
  });

  it("returns empty when all configured platforms are disabled", () => {
    const targets = resolveSyncTargets({
      catalog: getPlatformCatalog(),
      configuredPlatformIds: ["mintos"] as PlatformId[],
      disabledPlatformIds: ["mintos"] as PlatformId[],
    });

    expect(targets).toEqual([]);
  });

  it("filters disabled platforms from an explicit platform selection", () => {
    const targets = resolveSyncTargets({
      catalog: getPlatformCatalog(),
      configuredPlatformIds: ["mintos", "peerberry"] as PlatformId[],
      disabledPlatformIds: ["mintos"] as PlatformId[],
      requestedPlatformIds: ["mintos", "peerberry"] as PlatformId[],
    });

    expect(targets.map((platform) => platform.id)).toEqual(["peerberry"]);
  });

  it("returns only the explicitly requested configured platform", () => {
    const targets = resolveSyncTargets({
      catalog: getPlatformCatalog(),
      configuredPlatformIds: ["mintos", "peerberry"] as PlatformId[],
      disabledPlatformIds: [] as PlatformId[],
      requestedPlatformIds: ["mintos"] as PlatformId[],
    });

    expect(targets.map((platform) => platform.id)).toEqual(["mintos"]);
  });

  it("ignores explicit requested platforms without configured credentials", () => {
    const targets = resolveSyncTargets({
      catalog: getPlatformCatalog(),
      configuredPlatformIds: ["mintos"] as PlatformId[],
      disabledPlatformIds: [] as PlatformId[],
      requestedPlatformIds: ["peerberry"] as PlatformId[],
    });

    expect(targets).toEqual([]);
  });
});
