import { describe, expect, it } from "vitest";
import {
  AUTO_LOCK_TIMEOUT_OPTIONS,
  normalizeAutoLockSettings,
} from "../../src/shared/auto-lock.js";
import { getPasswordStrength } from "../../src/shared/password-strength.js";

describe("auto-lock settings", () => {
  it("exposes only the supported timeout choices", () => {
    expect(AUTO_LOCK_TIMEOUT_OPTIONS).toEqual([5, 15, 30, 60]);
  });

  it("migrates the legacy disabled value without losing the preferred default", () => {
    expect(normalizeAutoLockSettings({ sessionTimeoutMinutes: 0 })).toEqual({
      autoLockEnabled: false,
      sessionTimeoutMinutes: 15,
    });
  });

  it("preserves supported legacy and current choices", () => {
    expect(normalizeAutoLockSettings({ sessionTimeoutMinutes: 30 })).toEqual({
      autoLockEnabled: true,
      sessionTimeoutMinutes: 30,
    });
    expect(
      normalizeAutoLockSettings({
        autoLockEnabled: false,
        sessionTimeoutMinutes: 60,
      }),
    ).toEqual({ autoLockEnabled: false, sessionTimeoutMinutes: 60 });
  });

  it("normalizes unsupported positive legacy values to fifteen minutes", () => {
    expect(normalizeAutoLockSettings({ sessionTimeoutMinutes: 10 })).toEqual({
      autoLockEnabled: true,
      sessionTimeoutMinutes: 15,
    });
  });
});

describe("master password strength", () => {
  it.each([
    ["x", "Very weak", 0],
    ["abcdef", "Weak", 1],
    ["abcdefghijklmn", "Fair", 2],
    ["Abcdefgh1!", "Strong", 3],
    ["Abcdefghijkl12!!", "Very strong", 4],
  ] as const)("rates %s as %s", (password, label, score) => {
    expect(getPasswordStrength(password)).toEqual({ label, score });
  });

  it.each([
    ["                  ", "Very weak", 0],
    ["pässwörterlang", "Fair", 2],
    ["aaaaaaaaaaaaaaaaaa", "Weak", 1],
  ] as const)("does not overrate %j", (password, label, score) => {
    expect(getPasswordStrength(password)).toEqual({ label, score });
  });
});
