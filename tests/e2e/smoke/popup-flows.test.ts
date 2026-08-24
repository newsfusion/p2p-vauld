import { expect, test } from "@playwright/test";
import { openMockedPopup, sentMessageTypes } from "../fixtures/dashboard-mock.js";

test.describe("Popup manual flows", () => {
  test("unlocks locked popup and toggles password visibility", async ({ page }) => {
    await openMockedPopup(page, {
      locked: true,
      hasMasterPassword: true,
      unlockPassword: "correct-password",
    });

    await expect(page.getByText("Enter your master password to unlock.")).toBeVisible();
    const password = page.getByPlaceholder("Master password");
    await password.fill("wrong-password");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText("Incorrect password")).toBeVisible();

    await page.getByLabel("Show password").click();
    await expect(password).toHaveAttribute("type", "text");
    await password.fill("correct-password");
    await page.getByRole("button", { name: "Unlock" }).click();
    await expect(page.getByText("Portfolio Value")).toBeVisible();
  });

  test("shows unlocked summary, starts refresh all, and sends cancel", async ({
    page,
  }) => {
    await openMockedPopup(page, {
      metrics: [
        {
          platformId: "mintos",
          fetchedAt: "2026-06-08T10:00:00.000Z",
          platformValue: 1200,
          freeCash: 50,
          currency: "EUR",
          confidence: 0.9,
        },
      ],
      credentials: [{ platformId: "mintos" }],
    });

    await expect(page.getByText("1.200,00").first()).toBeVisible();
    await expect(page.getByText("Mintos")).toBeVisible();
    await expect(page.getByText("No data").first()).toBeVisible();

    await page.getByLabel(/Toggle theme/).click();
    await expect(page.locator("html")).toHaveClass(/light|dark/);

    await page.getByRole("button", { name: /Dashboard/ }).click();
    await page.getByRole("button", { name: "Refresh All" }).click();
    await expect(page.getByText("Syncing platforms…")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    const types = await sentMessageTypes(page);
    expect(types).toContain("OPEN_DASHBOARD");
    expect(types).toContain("START_SYNC");
    expect(types).toContain("CANCEL_SYNC_ALL");
  });
});
