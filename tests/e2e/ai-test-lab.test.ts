import { test, expect } from "@playwright/test";
import { openMockedDashboard } from "./fixtures/dashboard-mock.js";

test.describe("AI Test Lab Panel", () => {
  test.beforeEach(async ({ page }) => {
    await openMockedDashboard(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("switch").first().click();
  });

  test("should render AI Test Lab with inline logs after running extraction test", async ({
    page,
  }) => {
    // 1. Click the AI Test Lab navigation button
    await page.getByRole("button", { name: /AI Test Lab/i }).click();

    // 2. Verify panel is open
    await expect(page.locator("h2", { hasText: "Extractor Test" })).toBeVisible();

    // 3. Find the Mintos platform card
    const mintosCard = page.locator(".glass-card", { hasText: "Mintos" });
    await expect(mintosCard).toBeVisible();

    // 4. Click Extractor button
    const runExtractorBtn = mintosCard.getByRole("button", { name: /^Test$/i }).first();
    await runExtractorBtn.click();

    // 5. Wait for inline log output to appear (no separate tabs)
    await expect(mintosCard.locator("text=Extractor Result")).toBeVisible({
      timeout: 10000,
    });

    // 6. Verify rich log entries appear inline
    await expect(mintosCard.locator("text=Loaded HTML fixture")).toBeVisible();
    await expect(mintosCard.locator("text=HTML cleanup")).toBeVisible();
    await expect(mintosCard.locator("text=Parsed HTML into DOM")).toBeVisible();
    await expect(mintosCard.locator("text=portfolio_value")).toBeVisible();
  });
});
