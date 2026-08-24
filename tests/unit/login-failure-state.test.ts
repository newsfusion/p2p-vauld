import { describe, expect, it } from "vitest";
import {
  clearStoredLoginError,
  credentialReplacementLoginMetadata,
  mergeLoginFailure,
  mergeLoginSuccess,
  mergeLoginSyncStarted,
  recordStoredLoginFailure,
  resetStoredLoginFailureCount,
} from "../../src/background/login-failure-state.js";
import { mergeCredentialModeUpdate } from "../../src/background/platform-modes.js";
import type { StoredCredentials } from "../../src/shared/types/index.js";

const baseCredentials: StoredCredentials = {
  platformId: "mintos",
  encryptedUsername: { iv: "user-iv", ciphertext: "encrypted-user" },
  encryptedPassword: { iv: "pass-iv", ciphertext: "encrypted-pass" },
  createdAt: "2026-08-17T08:00:00.000Z",
  updatedAt: "2026-08-17T08:00:00.000Z",
  safeModeEnabled: false,
  stealthModeEnabled: false,
};

describe("login failure credential metadata", () => {
  it("records the first failure without enabling stealth", () => {
    const updated = mergeLoginFailure(
      baseCredentials,
      "  Login form fields not found  ",
      "2026-08-17T09:00:00.000Z",
    );

    expect(updated).toMatchObject({
      consecutiveLoginFailureCount: 1,
      lastLoginError: "Login form fields not found",
      safeModeEnabled: true,
      stealthModeEnabled: false,
    });
    expect(updated.encryptedUsername).toBe(baseCredentials.encryptedUsername);
    expect(updated.encryptedPassword).toBe(baseCredentials.encryptedPassword);
  });

  it("enables stealth on the second consecutive failure", () => {
    const updated = mergeLoginFailure(
      { ...baseCredentials, consecutiveLoginFailureCount: 1 },
      "Invalid credentials",
      "2026-08-17T09:00:00.000Z",
    );

    expect(updated.consecutiveLoginFailureCount).toBe(2);
    expect(updated.stealthModeEnabled).toBe(true);
  });

  it("normalizes and caps persisted user-facing errors", () => {
    const updated = mergeLoginFailure(
      baseCredentials,
      `Login failed\n${"x".repeat(600)}`,
      "2026-08-17T09:00:00.000Z",
    );

    expect(updated.lastLoginError).not.toContain("\n");
    expect(updated.lastLoginError).toHaveLength(500);
  });

  it("resets the counter after a confirmed login without disabling stealth", () => {
    const updated = mergeLoginSuccess(
      {
        ...baseCredentials,
        consecutiveLoginFailureCount: 2,
        stealthModeEnabled: true,
      },
      "2026-08-17T09:00:00.000Z",
    );

    expect(updated.consecutiveLoginFailureCount).toBe(0);
    expect(updated.stealthModeEnabled).toBe(true);
  });

  it("clears only the persisted error when the platform sync starts", () => {
    const updated = mergeLoginSyncStarted(
      {
        ...baseCredentials,
        consecutiveLoginFailureCount: 1,
        lastLoginError: "Login failed",
      },
      "2026-08-17T09:00:00.000Z",
    );

    expect(updated.lastLoginError).toBeUndefined();
    expect(updated.consecutiveLoginFailureCount).toBe(1);
  });

  it("resets the counter when stealth is manually disabled", () => {
    const updated = mergeCredentialModeUpdate(
      {
        ...baseCredentials,
        consecutiveLoginFailureCount: 2,
        lastLoginError: "Login failed",
        stealthModeEnabled: true,
      },
      { stealthModeEnabled: false },
      "2026-08-17T09:00:00.000Z",
    );

    expect(updated.stealthModeEnabled).toBe(false);
    expect(updated.consecutiveLoginFailureCount).toBe(0);
    expect(updated.lastLoginError).toBe("Login failed");
  });

  it("preserves the visible error but resets the counter for new credentials", () => {
    expect(
      credentialReplacementLoginMetadata({
        ...baseCredentials,
        consecutiveLoginFailureCount: 2,
        lastLoginError: "Login failed",
      }),
    ).toEqual({
      consecutiveLoginFailureCount: 0,
      lastLoginError: "Login failed",
    });
  });

  it("updates the latest stored credential snapshot", async () => {
    const latest = {
      ...baseCredentials,
      encryptedUsername: { iv: "latest-iv", ciphertext: "latest-user" },
      consecutiveLoginFailureCount: 1,
    };
    let saved: StoredCredentials | undefined;
    const storage = {
      getCredentials: async () => latest,
      saveCredentials: async (credentials: StoredCredentials) => {
        saved = credentials;
      },
    };

    await recordStoredLoginFailure(
      "mintos",
      "Invalid credentials",
      storage,
      "2026-08-17T09:00:00.000Z",
    );

    expect(saved?.encryptedUsername).toBe(latest.encryptedUsername);
    expect(saved?.consecutiveLoginFailureCount).toBe(2);
    expect(saved?.stealthModeEnabled).toBe(true);
  });

  it("clears errors and resets counters through storage helpers", async () => {
    let current: StoredCredentials = {
      ...baseCredentials,
      consecutiveLoginFailureCount: 1,
      lastLoginError: "Login failed",
    };
    const storage = {
      getCredentials: async () => current,
      saveCredentials: async (credentials: StoredCredentials) => {
        current = credentials;
      },
    };

    await clearStoredLoginError("mintos", storage, "2026-08-17T09:00:00.000Z");
    expect(current.lastLoginError).toBeUndefined();
    expect(current.consecutiveLoginFailureCount).toBe(1);

    await resetStoredLoginFailureCount(
      "mintos",
      storage,
      "2026-08-17T09:05:00.000Z",
    );
    expect(current.consecutiveLoginFailureCount).toBe(0);
  });
});
