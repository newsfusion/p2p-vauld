import { describe, expect, it } from "vitest";
import {
  describeSyncFailure,
  formatSyncFailureTooltip,
} from "../../src/shared/sync-failure.js";

describe("describeSyncFailure", () => {
  it("maps known login failures and adds a Safe Mode retry hint", () => {
    const result = describeSyncFailure(
      "failed_login",
      "Login form fields not found",
    );

    expect(result.reason).toBe("Couldn't find the login form on the page.");
    expect(result.hint).toContain("Safe Mode");
    expect(result.hint).toContain("login window will stay visible");
  });

  it("passes through unknown messages as the reason", () => {
    const result = describeSyncFailure(
      "failed_login",
      "Invalid credentials on platform page",
    );

    expect(result.reason).toBe("Invalid credentials on platform page");
    expect(result.hint).toContain("Safe Mode");
  });

  it("maps verification timeout failures", () => {
    const result = describeSyncFailure(
      "failed_login",
      "Login verification timeout — could not confirm post-login state",
    );

    expect(result.reason).toBe(
      "Login submitted but the platform never confirmed a logged-in state.",
    );
  });

  it("adds manual-action hints for 2FA and captcha failures", () => {
    expect(describeSyncFailure("failed_2fa", "2FA not solved in time").hint).toBe(
      "Open the platform and complete the manual step, then sync again.",
    );
    expect(
      describeSyncFailure("failed_captcha", "Captcha not solved in time").hint,
    ).toBe("Open the platform and complete the manual step, then sync again.");
  });

  it("includes raw details in tooltip when they differ from the friendly reason", () => {
    const tooltip = formatSyncFailureTooltip(
      describeSyncFailure("failed_login", "Login form fields not found"),
      "Login form fields not found",
    );

    expect(tooltip).toContain("Couldn't find the login form on the page.");
    expect(tooltip).toContain("Safe Mode");
  });
});
