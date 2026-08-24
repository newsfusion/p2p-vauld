import { expect, test } from "@playwright/test";
import {
  openMockedDashboard,
  sentMessages,
  sentMessageTypes,
} from "../fixtures/dashboard-mock.js";

async function clickNav(page: import("@playwright/test").Page, name: string): Promise<void> {
  await page.getByRole("button", { name }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
}

const metrics = [
  {
    platformId: "mintos",
    fetchedAt: "2026-06-08T10:00:00.000Z",
    platformValue: 1234.56,
    freeCash: 78.9,
    currency: "EUR",
    confidence: 0.95,
    netAnnualReturnPct: 9.1,
  },
  {
    platformId: "peerberry",
    fetchedAt: "2026-06-08T10:00:00.000Z",
    platformValue: 500,
    freeCash: 20,
    currency: "EUR",
    confidence: 0.91,
    netAnnualReturnPct: 8.2,
  },
];

test.describe("Dashboard core manual flows", () => {
  test("completes invisible-key onboarding and keeps dashboard unlocked after reload", async ({
    page,
  }) => {
    await openMockedDashboard(page, { onboardingComplete: false });

    await page.getByRole("button", { name: /Use Invisible Key/ }).click();
    await expect(page.getByRole("heading", { name: "Confirm Invisible Key" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("button", { name: "Portfolio" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Portfolio" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Use Invisible Key/ })).toBeHidden();
  });

  test("shows advisory password strength and accepts a weak master password", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      onboardingComplete: false,
      unlockPassword: "x",
    });

    await page.getByRole("button", { name: /Set a Master Password/ }).click();
    await page.getByLabel("Password", { exact: true }).fill("x");
    await expect(page.getByText("Very weak")).toBeVisible();
    await page.getByLabel("Confirm Password").fill("different");
    await page.getByRole("button", { name: "Set Password" }).click();
    await expect(page.getByText("Passwords do not match.")).toBeVisible();

    await page.getByLabel("Confirm Password").fill("x");
    await page.getByRole("button", { name: "Set Password" }).click();
    await expect(page.getByRole("button", { name: "Portfolio" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Portfolio" })).toBeVisible();

    await page.getByLabel("Lock").click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByLabel("Master Password").fill("wrong-password");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText("Incorrect password")).toBeVisible();
    await page.getByLabel("Master Password").fill("x");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByRole("button", { name: "Portfolio" })).toBeVisible();
  });

  test("routes between dashboard views and shows debug tabs only while debug mode is enabled", async ({
    page,
  }) => {
    await openMockedDashboard(page);

    await clickNav(page, "Analytics");
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await clickNav(page, "Export");
    await expect(page.getByRole("heading", { exact: true, name: "Export" })).toBeVisible();
    await clickNav(page, "Settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Debug" })).toBeHidden();

    await page.getByRole("switch").first().click();
    await clickNav(page, "Debug");
    await expect(page.getByRole("heading", { name: "Debug Mode" })).toBeVisible();
    await clickNav(page, "Login Extractor");
    await expect(page.getByRole("heading", { name: "Login Extractor" })).toBeVisible();
    await clickNav(page, "Dashboard Extractor");
    await expect(page.getByRole("heading", { name: "Dashboard Extractor" })).toBeVisible();

    await clickNav(page, "Settings");
    await page.getByRole("switch").first().click();
    await expect(page.getByRole("button", { name: "Debug" })).toBeHidden();
  });

  test("persists theme choice across dashboard reload", async ({ page }) => {
    await openMockedDashboard(page);

    const themeToggle = page.getByLabel(/Toggle theme/);
    await themeToggle.click();
    await expect(page.locator("html")).toHaveClass(/light|dark/);
    const classAfterToggle = await page.locator("html").getAttribute("class");

    await page.reload();
    await expect(page.locator("html")).toHaveClass(classAfterToggle ?? "");
  });

  test("shows empty portfolio state and routes Add Platform to settings", async ({
    page,
  }) => {
    await openMockedDashboard(page, { metrics: [], credentials: [] });

    await expect(
      page.getByText("No configured platforms yet. Add login credentials in Settings."),
    ).toBeVisible();
    await expect(page.getByTestId("platform-table-sync-all")).toBeDisabled();
    await page.getByTestId("platform-table-add-platform").evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("masks portfolio and analytics financial values in privacy mode", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      metrics,
      credentials: [{ platformId: "mintos" }, { platformId: "peerberry" }],
    });

    await expect(page.getByText("1.234,56 €")).toBeVisible();
    await page.getByLabel("Toggle privacy mode").click();
    await expect(page.getByText("****,** €").first()).toBeVisible();
    await expect(page.getByText("1.234,56 €")).toBeHidden();

    await clickNav(page, "Analytics");
    await expect(page.getByText("****,** €").first()).toBeVisible();
    await expect(page.getByText("1.234,56 €")).toBeHidden();
  });

  test("shows Gemini Nano banner, opens settings card, and persists dismissal", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      geminiStatus: "unavailable",
      settings: { geminiActivationBannerDismissed: false },
    });

    await expect(page.getByText("Activate Gemini Nano for better extraction")).toBeVisible();
    await page.getByTestId("gemini-banner-open-settings").click();
    await expect(page.getByTestId("gemini-settings-card")).toBeVisible();

    await clickNav(page, "Portfolio");
    await page.getByTestId("gemini-banner-dismiss").click();
    await expect(page.getByText("Activate Gemini Nano for better extraction")).toBeHidden();
    expect(await sentMessageTypes(page)).toContain("SAVE_SETTINGS");
  });

  test("edits and deletes history entries and reflects the change in the overview", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      metrics,
      metricsHistory: [
        {
          platformId: "mintos",
          date: "2026-06-08",
          platformValue: 1234.56,
          freeCash: 78.9,
          fetchedAt: "2026-06-08T10:00:00.000Z",
          currency: "EUR",
          confidence: 0.95,
        },
        {
          platformId: "mintos",
          date: "2026-06-07",
          platformValue: 1000,
          freeCash: 50,
          fetchedAt: "2026-06-07T10:00:00.000Z",
          currency: "EUR",
          confidence: 0.95,
        },
      ],
      credentials: [{ platformId: "mintos" }],
    });

    await expect(page.getByText("1.234,56 €")).toBeVisible();

    // Expand the platform history.
    await page.getByRole("button", { name: /Toggle change history for/ }).first().click();
    await expect(page.getByTestId("history-edit-2026-06-08")).toBeVisible();
    await expect(page.getByTestId("batch-undo-7")).toBeAttached();

    // Edit the latest entry → overview reflects the new value.
    await page.getByTestId("history-edit-2026-06-08").click();
    await page.getByTestId("history-input-value-2026-06-08").fill("2000");
    await page.getByTestId("history-save-2026-06-08").click();
    await expect(page.getByText("2.000,00 €").first()).toBeVisible();

    // Delete the latest entry → overview falls back to the previous snapshot.
    await page.getByTestId("history-delete-2026-06-08").click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText("1.000,00").first()).toBeVisible();
    await expect(page.getByTestId("history-edit-2026-06-08")).toBeHidden();
  });

  test("reports a wrong latest history value and starts forced choice resync", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      metrics,
      metricsHistory: [
        {
          platformId: "mintos",
          date: "2026-06-08",
          platformValue: 1234.56,
          freeCash: 78.9,
          fetchedAt: "2026-06-08T10:00:00.000Z",
          currency: "EUR",
          confidence: 0.95,
        },
        {
          platformId: "mintos",
          date: "2026-06-07",
          platformValue: 1000,
          freeCash: 50,
          fetchedAt: "2026-06-07T10:00:00.000Z",
          currency: "EUR",
          confidence: 0.95,
        },
      ],
      credentials: [{ platformId: "mintos" }],
    });

    await page.getByRole("button", { name: /Toggle change history for/ }).first().click();
    await page.getByTestId("history-edit-2026-06-08").hover();
    await page.getByTestId("history-report-value-2026-06-08").click();

    await expect(
      page.getByRole("heading", { name: "Report wrong imported value" }),
    ).toBeVisible();
    await expect(
      page.getByText(/choose the correct Portfolio Value and Free Cash/),
    ).toBeVisible();

    await page.getByRole("button", { name: "Yes, undo and resync" }).click();

    await expect(
      page.getByRole("heading", { name: "Report wrong imported value" }),
    ).toBeHidden();

    const messages = await sentMessages(page);
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "REVERT_PLATFORM_BATCH",
        payload: { platformId: "mintos", batchId: 7 },
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "RESET_PLATFORM_SELECTORS",
        payload: { platformId: "mintos" },
      }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({
        type: "START_SYNC",
        payload: {
          platformIds: ["mintos"],
          forceExtractionChoiceForSignals: ["portfolio_value", "free_cash"],
        },
      }),
    );
  });

  test("keeps navigation usable at mobile width and exposes keyboard focus", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openMockedDashboard(page, {
      metrics,
      credentials: [{ platformId: "mintos" }, { platformId: "peerberry" }],
    });

    await expect(page.getByRole("button", { name: "Portfolio" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Analytics" })).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);

    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.keyboard.press("Enter");
  });
});
