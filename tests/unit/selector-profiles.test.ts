import { afterEach, describe, expect, it, vi } from "vitest";
import { db, getSelectorProfiles } from "../../src/shared/db/index.js";
import type { SelectorProfile } from "../../src/shared/types/index.js";

function profile(overrides: Partial<SelectorProfile> = {}): SelectorProfile {
  return {
    platformId: "mintos",
    signalKey: "portfolio_value",
    selector: "#balance",
    confidence: 1,
    source: "user",
    learnedAt: "2026-07-18T10:00:00.000Z",
    failureCount: 0,
    ...overrides,
  };
}

function mockStoredProfiles(profiles: SelectorProfile[]): void {
  vi.spyOn(db.selectorProfiles, "where").mockReturnValue({
    between: () => ({
      filter: (predicate: (entry: SelectorProfile) => boolean) => ({
        toArray: async () => profiles.filter(predicate),
      }),
    }),
  } as never);
}

describe("selector profiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a user choice even after repeated failures", async () => {
    const userProfile = profile({ failureCount: 7 });
    mockStoredProfiles([userProfile]);

    await expect(getSelectorProfiles("mintos")).resolves.toEqual([userProfile]);
  });

  it("drops auto-learned profiles after three failures", async () => {
    const auto = profile({
      signalKey: "free_cash",
      selector: "#cash",
      source: "auto",
      failureCount: 3,
    });
    const stillTrusted = profile({ source: "auto", failureCount: 2 });
    mockStoredProfiles([auto, stillTrusted]);

    await expect(getSelectorProfiles("mintos")).resolves.toEqual([stillTrusted]);
  });

  it("treats a profile without an explicit source as a user choice", async () => {
    const legacy: SelectorProfile = {
      platformId: "mintos",
      signalKey: "portfolio_value",
      selector: "#legacy-balance",
      confidence: 1,
      learnedAt: "2026-05-02T10:00:00.000Z",
      failureCount: 5,
    };
    mockStoredProfiles([legacy]);

    await expect(getSelectorProfiles("mintos")).resolves.toEqual([legacy]);
  });
});
