import { describe, expect, it } from "vitest";
import {
  DEMO_PLATFORM_IDS,
  applyDemoCatalogOverrides,
  getDemoCredentialStatus,
  normalizeDemoBaseUrl,
} from "../../src/shared/demo.js";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";
import { resolveSyncTargets } from "../../src/background/sync-targets.js";
import {
  DEMO_CLOCK_STORAGE_KEY,
  getDemoClockBaseIso,
  getDemoCumulativeDays,
  createDemoTimestampProvider,
  getDemoFetchedAt,
  getDemoStepDays,
  getDemoTodayUtcStart,
  reserveNextDemoSyncIndex,
  type DemoClockStorage,
} from "../../src/background/demo-clock.js";
import type { PlatformId } from "../../src/shared/types/index.js";

describe("demo mode", () => {
  it("rewrites demo platform URLs and leaves non-demo platforms intact", () => {
    const catalog = getPlatformCatalog();
    const demoCatalog = applyDemoCatalogOverrides(catalog, {
      enabled: true,
      baseUrl: "http://localhost:4180/",
    });

    const mintos = demoCatalog.find((platform) => platform.id === "mintos");
    const nonDemo = demoCatalog.find((platform) => platform.id === "afranga");
    const originalNonDemo = catalog.find((platform) => platform.id === "afranga");

    expect(mintos?.login.entryUrl).toBe(
      "http://localhost:4180/demo/mintos/login",
    );
    expect(mintos?.domains).toContain("localhost");
    expect(mintos?.domains).toContain("127.0.0.1");
    expect(mintos?.login.postLoginIndicators).toContain(
      "text=/demo authenticated|portfolio value|available funds|free cash|dashboard/i",
    );

    expect(nonDemo?.login.entryUrl).toBe(
      "http://localhost:4180/demo/afranga/login",
    );
    expect(nonDemo?.login.entryUrl).not.toBe(originalNonDemo?.login.entryUrl);
  });

  it("does not rewrite catalog when demo mode is disabled", () => {
    const catalog = getPlatformCatalog();
    const demoCatalog = applyDemoCatalogOverrides(catalog, { enabled: false });

    expect(demoCatalog).toBe(catalog);
  });

  it("normalizes demo base URL", () => {
    expect(normalizeDemoBaseUrl("http://localhost:4180///")).toBe(
      "http://localhost:4180",
    );
  });

  it("resolves the ten virtual demo platforms as sync targets", () => {
    const targets = resolveSyncTargets({
      catalog: applyDemoCatalogOverrides(getPlatformCatalog(), {
        enabled: true,
      }),
      configuredPlatformIds: [...DEMO_PLATFORM_IDS],
      disabledPlatformIds: [],
    });

    expect(targets.map((platform) => platform.id)).toEqual([
      ...DEMO_PLATFORM_IDS,
    ]);
  });

  it("exposes virtual demo credential status without encrypted blobs", () => {
    const credentials = getDemoCredentialStatus(["afranga", "indemo"]);

    expect(credentials.map((entry) => entry.platformId)).toEqual([
      "afranga",
      "indemo",
    ]);
    expect(credentials).toHaveLength(2);
    expect(credentials[0]).toEqual({
      platformId: "afranga",
      safeModeEnabled: false,
      stealthModeEnabled: false,
    });
    expect(Object.keys(credentials[0] ?? {})).not.toContain(
      "encryptedUsername",
    );
  });

  it("increments demo clock once per sync and creates per-platform minute offsets", async () => {
    const state: Record<string, unknown> = {};
    const now = new Date("2026-05-14T10:05:30.000Z");
    const storage: DemoClockStorage = {
      get: async (key) => ({ [key]: state[key] }),
      set: async (items) => {
        Object.assign(state, items);
      },
    };

    const firstIndex = await reserveNextDemoSyncIndex(storage);
    const secondIndex = await reserveNextDemoSyncIndex(storage);

    expect(firstIndex).toBe(0);
    expect(secondIndex).toBe(1);
    expect(state[DEMO_CLOCK_STORAGE_KEY]).toBe(2);
    const baseIso = getDemoClockBaseIso(now);
    expect(baseIso).toBe("2025-05-14T00:00:00.000Z");

    expect(getDemoFetchedAt(firstIndex, 0, baseIso, now)).toBe(
      "2025-05-14T00:00:00.000Z",
    );
    expect(getDemoFetchedAt(firstIndex, 1, baseIso, now)).toBe(
      "2025-05-14T00:01:00.000Z",
    );

    const secondSyncAt = getDemoFetchedAt(secondIndex, 0, baseIso, now);
    const secondSyncDayDelta =
      (Date.parse(secondSyncAt) - Date.parse(baseIso)) / (24 * 60 * 60 * 1000);
    expect(secondSyncDayDelta).toBeGreaterThanOrEqual(14);
    expect(secondSyncDayDelta).toBeLessThanOrEqual(34);
  });

  it("returns one stable timestamp per platform for a sync run", () => {
    const now = new Date("2026-05-14T10:05:30.000Z");
    const baseIso = getDemoClockBaseIso(now);
    const provider = createDemoTimestampProvider(3, [
      "mintos",
      "peerberry",
    ] as PlatformId[], baseIso, now);

    expect(provider("mintos")).toBe(
      getDemoFetchedAt(3, 0, baseIso, now),
    );
    expect(provider("peerberry")).toBe(
      getDemoFetchedAt(3, 1, baseIso, now),
    );
  });

  it("uses deterministic 14..34 day jump sequence", () => {
    const steps = [0, 1, 2, 3, 4, 5].map((index) => getDemoStepDays(index));
    expect(steps).toEqual([25, 21, 17, 34, 30, 26]);
    for (const step of steps) {
      expect(step).toBeGreaterThanOrEqual(14);
      expect(step).toBeLessThanOrEqual(34);
    }
    expect(getDemoCumulativeDays(0)).toBe(0);
    expect(getDemoCumulativeDays(1)).toBe(25);
    expect(getDemoCumulativeDays(3)).toBe(63);
  });

  it("memoizes cumulative day totals in provided cache", () => {
    const cache = new Map<number, number>([[0, 0]]);

    expect(getDemoCumulativeDays(5, cache)).toBe(127);
    expect(cache.get(3)).toBe(63);
    expect(cache.get(5)).toBe(127);
    expect(getDemoCumulativeDays(3, cache)).toBe(63);
  });

  it("clamps demo timestamps to today and never creates future values", () => {
    const now = new Date("2026-05-14T10:05:30.000Z");
    const todayStart = getDemoTodayUtcStart(now);
    const baseIso = getDemoClockBaseIso(now);

    let lastTs = 0;
    for (let syncIndex = 0; syncIndex < 80; syncIndex += 1) {
      const iso = getDemoFetchedAt(syncIndex, 9, baseIso, now);
      const ts = Date.parse(iso);
      expect(ts).toBeLessThanOrEqual(now.getTime());
      expect(ts).toBeGreaterThanOrEqual(lastTs);
      lastTs = ts;
    }

    expect(getDemoFetchedAt(80, 9999, baseIso, now)).toBe(
      "2026-05-14T10:05:00.000Z",
    );
    expect(
      Date.parse(getDemoFetchedAt(80, 9999, baseIso, now)),
    ).toBeGreaterThanOrEqual(todayStart.getTime());
  });
});
