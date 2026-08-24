import { describe, expect, it } from "vitest";
import {
  mergeCredentialModeUpdate,
  updateStoredPlatformModes,
} from "../../src/background/platform-modes.js";
import {
  resolveExecutionModes,
  resolveLoginMessageTimeoutMs,
  resolveSafeModeTimeoutMs,
} from "../../src/background/sync.js";
import type {
  PlatformCatalogEntry,
  StoredCredentials,
} from "../../src/shared/types/index.js";

const encryptedBlob = { iv: "iv", ciphertext: "ciphertext" };

const baseStored: StoredCredentials = {
  platformId: "mintos",
  encryptedUsername: encryptedBlob,
  encryptedPassword: encryptedBlob,
  createdAt: "2026-05-18T10:00:00.000Z",
  updatedAt: "2026-05-18T10:00:00.000Z",
};

function platformWithSafeMode(
  safeMode?: boolean,
): PlatformCatalogEntry {
  return {
    id: "mintos",
    name: "Mintos",
    enabled: true,
    strategy: "universal",
    domains: ["mintos.com"],
    login: {
      entryUrl: "https://example.test/login",
      usernameSelectors: [],
      passwordSelectors: [],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      ...(safeMode === undefined ? {} : { safeMode }),
    },
    dashboard: {
      portfolioValueSelectors: [],
      freeCashSelectors: [],
      netAnnualReturnSelectors: [],
    },
  };
}

describe("sync execution mode resolution", () => {
  it("defaults safe mode off and falls back to global stealth mode", () => {
    expect(
      resolveExecutionModes(baseStored, platformWithSafeMode(undefined), true),
    ).toEqual({
      safeMode: false,
      stealthMode: true,
    });
  });

  it("uses the platform safe mode default when credentials have no override", () => {
    expect(
      resolveExecutionModes(baseStored, platformWithSafeMode(true), false),
    ).toEqual({
      safeMode: true,
      stealthMode: false,
    });
  });

  it("respects explicit false overrides", () => {
    expect(
      resolveExecutionModes(
        {
          ...baseStored,
          safeModeEnabled: false,
          stealthModeEnabled: false,
        },
        platformWithSafeMode(true),
        true,
      ),
    ).toEqual({
      safeMode: false,
      stealthMode: false,
    });
  });
});

describe("safe mode page-load timeout resolution", () => {
  it("keeps the base timeout when safe mode is disabled", () => {
    expect(resolveSafeModeTimeoutMs(15_000, false)).toBe(15_000);
  });

  it("doubles the base timeout when safe mode is enabled", () => {
    expect(resolveSafeModeTimeoutMs(15_000, true)).toBe(30_000);
  });
});

describe("stealth login timeout resolution", () => {
  it("keeps the base timeout outside stealth mode", () => {
    expect(resolveLoginMessageTimeoutMs(15_000, false, "ab", "cd")).toBe(15_000);
  });

  it("budgets for paced characters and field pauses", () => {
    expect(resolveLoginMessageTimeoutMs(15_000, true, "ab", "cd")).toBe(16_610);
  });

  it("caps the timeout at 45 seconds", () => {
    expect(resolveLoginMessageTimeoutMs(15_000, true, "x".repeat(1_000), "y")).toBe(
      45_000,
    );
  });
});

describe("platform mode updates", () => {
  it("updates mode flags without changing encrypted credential blobs", () => {
    const updated = mergeCredentialModeUpdate(
      {
        ...baseStored,
        safeModeEnabled: false,
        stealthModeEnabled: true,
      },
      { safeModeEnabled: true },
      "2026-05-19T09:00:00.000Z",
    );

    expect(updated.encryptedUsername).toBe(baseStored.encryptedUsername);
    expect(updated.encryptedPassword).toBe(baseStored.encryptedPassword);
    expect(updated.safeModeEnabled).toBe(true);
    expect(updated.stealthModeEnabled).toBe(true);
    expect(updated.updatedAt).toBe("2026-05-19T09:00:00.000Z");
  });

  it("fails when mode update targets a platform without credentials", async () => {
    await expect(
      updateStoredPlatformModes(
        "mintos",
        { safeModeEnabled: true },
        {
          getCredentials: async () => undefined,
          saveCredentials: async () => undefined,
        },
      ),
    ).rejects.toThrow("Credentials not found for platform");
  });
});
