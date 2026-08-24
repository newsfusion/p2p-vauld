import { expect, test } from "@playwright/test";
import { openMockedDashboard, sentMessageTypes } from "../fixtures/dashboard-mock.js";

async function emitSync(page: import("@playwright/test").Page, payload: Record<string, unknown>): Promise<void> {
  await page.evaluate((eventPayload) => {
    (window as Window & { __p2pE2e?: { emit: (message: unknown) => void } }).__p2pE2e?.emit({
      type: "SYNC_PROGRESS",
      payload: eventPayload,
    });
  }, payload);
}

const metric = {
  platformId: "mintos",
  fetchedAt: "2026-06-08T10:00:00.000Z",
  platformValue: 1000,
  freeCash: 25,
  currency: "EUR",
  confidence: 0.9,
  netAnnualReturnPct: 8.5,
};

test.describe("Sync and recovery manual flows", () => {
  test("shows configured platform row, history, single sync, and cancel all", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      metrics: [metric],
      credentials: [{ platformId: "mintos" }, { platformId: "peerberry" }],
    });

    await expect(page.getByText("Mintos")).toBeVisible();
    await expect(page.getByText("1.000,00").first()).toBeVisible();
    await page.getByLabel("Toggle change history for Mintos").click();
    await expect(page.getByTestId("history-edit-2026-06-08")).toBeAttached();

    await page.getByRole("button", { name: /^Sync$/ }).first().click();
    await expect(page.getByText("Starting sync...").first()).toBeVisible();
    await emitSync(page, { type: "sync_cancelled", runId: "single-sync" });
    await expect(page.getByTestId("platform-table-sync-all")).toBeEnabled();

    await page.getByTestId("platform-table-sync-all").click();
    await expect(page.getByText("Cancel all")).toBeVisible();
    await page.getByText("Cancel all").click();
    await expect.poll(async () => await sentMessageTypes(page)).toContain("CANCEL_SYNC_ALL");
  });

  test("queues another platform during an active sync and cancels queued rows", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      credentials: [
        { platformId: "mintos" },
        { platformId: "peerberry" },
        { platformId: "debitum" },
      ],
      syncRun: {
        runId: "active-run",
        state: "running",
        platformProgress: { mintos: "running" },
      },
    });

    const peerberryRow = page.getByRole("row", { name: /PeerBerry/ });
    await expect(peerberryRow.getByRole("button", { name: "Sync" })).toBeEnabled();
    await peerberryRow.getByRole("button", { name: "Sync" }).click();
    await expect(peerberryRow.getByText("In Queue #1")).toBeVisible();

    await emitSync(page, {
      type: "platform_start",
      platformId: "peerberry",
      runId: "active-run",
    });
    await expect(page.getByText("In Queue #1")).toHaveCount(0);
    await emitSync(page, {
      type: "platform_done",
      platformId: "peerberry",
      runId: "active-run",
    });

    const debitumRow = page.getByRole("row", { name: /Debitum/ });
    await debitumRow.getByRole("button", { name: "Sync" }).click();
    await expect(debitumRow.getByText("In Queue #1")).toBeVisible();
    await page.getByTitle("Cancel Debitum").click();

    expect(await sentMessageTypes(page)).toContain("CANCEL_SYNC_PLATFORM");
  });

  test("routes failed login update action to Settings without deleting existing values", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      metrics: [],
      credentials: [{ platformId: "mintos" }],
    });
    await emitSync(page, {
      type: "platform_error",
      platformId: "mintos",
      runId: "run-1",
      state: "failed_login",
      message: "Login form fields not found",
    });

    await expect(page.getByText("Login failed")).toBeVisible();
    await expect(
      page.getByText("Couldn't find the login form on the page."),
    ).toBeVisible();
    await expect(
      page.getByText(/Safe Mode was turned on automatically/i),
    ).toBeVisible();
    await page.getByRole("button", { name: "Update" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("handles 2FA and captcha manual action submit and cancel flows", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      credentials: [{ platformId: "mintos" }, { platformId: "peerberry" }],
    });

    await emitSync(page, {
      type: "manual_action_required",
      platformId: "mintos",
      platformName: "Mintos",
      runId: "run-2fa",
      requestId: "manual-2fa",
      actionType: "2fa",
      expiresAt: "2026-06-08T10:05:00.000Z",
      message: "Enter the test 2FA code.",
    });
    await expect(page.getByRole("heading", { name: "Two-Factor Authentication" })).toBeVisible();
    await page.getByLabel("2FA / Security Code").fill("123456");
    await page.getByRole("button", { name: "Submit Code" }).click();
    await expect(page.getByRole("heading", { name: "Two-Factor Authentication" })).toBeHidden();

    await emitSync(page, {
      type: "manual_action_required",
      platformId: "peerberry",
      platformName: "PeerBerry",
      runId: "run-captcha",
      requestId: "manual-captcha",
      actionType: "captcha",
      expiresAt: "2026-06-08T10:05:00.000Z",
      message: "Solve the captcha in the opened tab.",
    });
    await expect(page.getByRole("heading", { name: "Security Verification" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel Sync", exact: true }).click();
    await expect.poll(async () => await sentMessageTypes(page)).toContain("CANCEL_SYNC_PLATFORM");
  });

  test("keeps last-known values visible for captcha, timeout, and extraction failures", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      metrics: [metric],
      credentials: [{ platformId: "mintos" }],
    });

    await emitSync(page, {
      type: "platform_error",
      platformId: "mintos",
      runId: "run-captcha",
      state: "failed_captcha",
    });
    await expect(page.getByText("1.000,00").first()).toBeVisible();

    await emitSync(page, {
      type: "platform_error",
      platformId: "mintos",
      runId: "run-timeout",
      state: "failed_timeout",
    });
    await expect(page.getByText("1.000,00").first()).toBeVisible();

    await emitSync(page, {
      type: "platform_error",
      platformId: "mintos",
      runId: "run-extract",
      state: "failed_extract",
    });
    await expect(page.getByRole("heading", { name: "Enable Safe Mode?" })).toBeVisible();
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(page.getByRole("heading", { name: "Enable Safe Mode?" })).toBeHidden();

    await emitSync(page, {
      type: "platform_error",
      platformId: "mintos",
      runId: "run-extract-2",
      state: "failed_extract",
    });
    await page.getByRole("button", { name: "Enable Safe Mode" }).click();
    await expect.poll(async () => await sentMessageTypes(page)).toContain("UPDATE_PLATFORM_MODES");
  });

  test("resolves extraction choice modal and clears it on sync cancellation", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      credentials: [{ platformId: "mintos" }],
    });

    await emitSync(page, {
      type: "extraction_choice_required",
      platformId: "mintos",
      platformName: "Mintos",
      runId: "run-choice",
      requestId: "choice-1",
      signalKey: "portfolio_value",
      expiresAt: "2026-06-08T10:05:00.000Z",
      candidates: [
        {
          candidateId: "candidate-1",
          value: 1000,
          valueType: "currency",
          selector: ".portfolio",
          score: 0.8,
          context: "Portfolio Value",
          text: "EUR 1,000.00",
        },
      ],
    });
    await expect(page.getByRole("heading", { name: "Select Portfolio Value" })).toBeVisible();
    await page.getByRole("button", { name: "Use this value" }).click();
    await expect(page.getByRole("heading", { name: "Select Portfolio Value" })).toBeHidden();
    expect(await sentMessageTypes(page)).toContain("RESOLVE_EXTRACTION_CHOICE");

    await emitSync(page, {
      type: "extraction_choice_required",
      platformId: "mintos",
      platformName: "Mintos",
      runId: "run-choice-expire",
      requestId: "choice-2",
      signalKey: "free_cash",
      expiresAt: "2026-06-08T10:05:00.000Z",
      candidates: [
        {
          candidateId: "candidate-2",
          value: 25,
          valueType: "currency",
          selector: ".cash",
          score: 0.7,
          context: "Free Cash",
          text: "EUR 25.00",
        },
      ],
    });
    await expect(page.getByRole("heading", { name: "Select Free Cash" })).toBeVisible();
    await emitSync(page, { type: "sync_cancelled", runId: "run-choice-expire" });
    await expect(page.getByRole("heading", { name: "Select Free Cash" })).toBeHidden();
  });

  test("hydrates persisted running sync state and keeps metrics after reload", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      metrics: [metric],
      credentials: [{ platformId: "mintos" }],
      syncRun: {
        runId: "persisted-run",
        state: "running",
        platformProgress: { mintos: "running" },
      },
    });

    await expect(page.getByText("1.000,00").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("1.000,00").first()).toBeVisible();
  });
});
