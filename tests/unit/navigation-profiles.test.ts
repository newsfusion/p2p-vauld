import { afterEach, describe, expect, it, vi } from "vitest";
import {
  db,
  learnNavigationProfile,
  markNavigationFailure,
} from "../../src/shared/db/index.js";
import type { NavigationProfile } from "../../src/shared/types/index.js";

function profile(overrides: Partial<NavigationProfile> = {}): NavigationProfile {
  return {
    platformId: "mintos",
    url: "https://mintos.com/en/overview",
    source: "auto",
    confidence: 0.9,
    learnedAt: "2026-07-18T10:00:00.000Z",
    failureCount: 0,
    ...overrides,
  };
}

function mockStored(existing: NavigationProfile | undefined): {
  get: ReturnType<typeof vi.spyOn>;
  put: ReturnType<typeof vi.spyOn>;
  update: ReturnType<typeof vi.spyOn>;
  remove: ReturnType<typeof vi.spyOn>;
} {
  return {
    get: vi.spyOn(db.navigationProfiles, "get").mockResolvedValue(existing as never),
    put: vi.spyOn(db.navigationProfiles, "put").mockResolvedValue("mintos" as never),
    update: vi.spyOn(db.navigationProfiles, "update").mockResolvedValue(1 as never),
    remove: vi.spyOn(db.navigationProfiles, "delete").mockResolvedValue(undefined as never),
  };
}

describe("navigation profiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores a newly learned page", async () => {
    const spies = mockStored(undefined);

    await learnNavigationProfile(profile());

    expect(spies.put).toHaveBeenCalledWith(
      expect.objectContaining({
        platformId: "mintos",
        url: "https://mintos.com/en/overview",
        source: "auto",
        failureCount: 0,
      }),
    );
  });

  it("does not let an automatic guess overwrite a page the user confirmed", async () => {
    const spies = mockStored(
      profile({ source: "user", url: "https://mintos.com/en/konto" }),
    );

    await learnNavigationProfile(profile({ source: "auto" }));

    expect(spies.put).not.toHaveBeenCalled();
  });

  it("lets an automatic guess replace a user page that keeps failing", async () => {
    const spies = mockStored(
      profile({ source: "user", url: "https://mintos.com/en/konto", failureCount: 3 }),
    );

    await learnNavigationProfile(
      profile({ source: "auto", url: "https://mintos.com/en/overview" }),
    );

    expect(spies.put).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://mintos.com/en/overview" }),
    );
  });

  it("resets the failure count when a page works again", async () => {
    const spies = mockStored(profile({ failureCount: 2 }));

    await learnNavigationProfile(profile({ failureCount: 2 }));

    expect(spies.put).toHaveBeenCalledWith(
      expect.objectContaining({ failureCount: 0 }),
    );
  });

  it("counts a failure without dropping the page yet", async () => {
    const spies = mockStored(profile({ failureCount: 1 }));

    await markNavigationFailure("mintos");

    expect(spies.update).toHaveBeenCalledWith("mintos", { failureCount: 2 });
    expect(spies.remove).not.toHaveBeenCalled();
  });

  // Unlike a selector profile, a stored URL is invisible in the UI, so the user
  // has no way to clear a stale one themselves.
  it("drops a failing page after three failures regardless of source", async () => {
    const spies = mockStored(profile({ source: "user", failureCount: 2 }));

    await markNavigationFailure("mintos");

    expect(spies.remove).toHaveBeenCalledWith("mintos");
    expect(spies.update).not.toHaveBeenCalled();
  });

  it("ignores a failure for a platform with no stored page", async () => {
    const spies = mockStored(undefined);

    await markNavigationFailure("mintos");

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.remove).not.toHaveBeenCalled();
  });
});
