import { afterEach, describe, expect, it, vi } from "vitest";
import {
  db,
  getLoginSelectorProfiles,
  markLoginSelectorFailures,
} from "../../src/shared/db/index.js";
import type { LoginSelectorProfile } from "../../src/shared/types/index.js";

describe("login selector profiles", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ignores cached login selector profiles after two failures", async () => {
    const active: LoginSelectorProfile = {
      platformId: "mintos",
      fieldRole: "username",
      selector: "#active-user",
      confidence: 1,
      source: "ai",
      learnedAt: "2026-06-08T10:00:00.000Z",
      failureCount: 1,
    };
    const exhausted: LoginSelectorProfile = {
      platformId: "mintos",
      fieldRole: "password",
      selector: "#stale-pass",
      confidence: 1,
      source: "ai",
      learnedAt: "2026-06-08T10:00:00.000Z",
      failureCount: 2,
    };

    vi.spyOn(db.loginSelectorProfiles, "where").mockReturnValue({
      between: () => ({
        filter: (predicate: (profile: LoginSelectorProfile) => boolean) => ({
          toArray: async () => [active, exhausted].filter(predicate),
        }),
      }),
    } as never);

    await expect(getLoginSelectorProfiles("mintos")).resolves.toEqual([active]);
  });

  it("increments failures only for stored roles on the requested platform", async () => {
    const username: LoginSelectorProfile = {
      platformId: "mintos",
      fieldRole: "username",
      selector: "#active-user",
      confidence: 1,
      source: "ai",
      learnedAt: "2026-06-08T10:00:00.000Z",
      failureCount: 1,
    };
    const put = vi.fn(async () => undefined);
    vi.spyOn(db, "transaction").mockImplementation(
      (async (...args: unknown[]) => {
        const callback = args.at(-1) as () => Promise<void>;
        return callback();
      }) as never,
    );
    vi.spyOn(db.loginSelectorProfiles, "get").mockImplementation(
      (async (key: [string, string]) =>
        key[0] === "mintos" && key[1] === "username"
          ? username
          : undefined) as never,
    );
    vi.spyOn(db.loginSelectorProfiles, "put").mockImplementation(put as never);

    await markLoginSelectorFailures("mintos", ["username", "password"]);

    expect(put).toHaveBeenCalledWith({
      ...username,
      failureCount: 2,
    });
    expect(put).toHaveBeenCalledTimes(1);
  });
});
