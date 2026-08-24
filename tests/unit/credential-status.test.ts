import { describe, expect, it } from "vitest";
import { toCredentialStatusEntry } from "../../src/shared/db/index.js";
import type { StoredCredentials } from "../../src/shared/types/index.js";

describe("credential status projection", () => {
  it("exposes modes and the persisted login error without encrypted blobs", () => {
    const credentials: StoredCredentials = {
      platformId: "mintos",
      encryptedUsername: { iv: "iv", ciphertext: "username" },
      encryptedPassword: { iv: "iv", ciphertext: "password" },
      createdAt: "2026-08-17T08:00:00.000Z",
      updatedAt: "2026-08-17T09:00:00.000Z",
      safeModeEnabled: true,
      stealthModeEnabled: true,
      consecutiveLoginFailureCount: 2,
      lastLoginError: "Login rejected — invalid credentials",
    };

    expect(toCredentialStatusEntry(credentials)).toEqual({
      platformId: "mintos",
      safeModeEnabled: true,
      stealthModeEnabled: true,
      lastLoginError: "Login rejected — invalid credentials",
    });
  });
});
