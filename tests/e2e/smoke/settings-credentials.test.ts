import { expect, test } from "@playwright/test";
import { openMockedDashboard, sentMessageTypes } from "../fixtures/dashboard-mock.js";

async function openSettings(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test.describe("Settings and credential manual flows", () => {
  test("adds credentials through searchable combobox, keyboard selection, and advanced modes", async ({
    page,
  }) => {
    await openMockedDashboard(page);
    await openSettings(page);

    const save = page.getByRole("button", { name: "Connect platform" });
    await expect(save).toBeDisabled();

    const platform = page.getByRole("combobox", { name: "Platform" });
    await platform.fill("mint");
    await expect(page.getByRole("option", { name: "Mintos" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(platform).toHaveValue("Mintos");

    await page.getByLabel("Username / Email").fill("e2e-user@example.test");
    await page.getByRole("textbox", { name: "Password" }).fill("secret-password");
    await page.getByLabel("Toggle advanced settings").click();
    await page.getByRole("switch", { name: "Safe Mode" }).click();
    await page.getByRole("switch", { name: "Stealth Mode" }).click();
    await save.click();

    await expect(page.getByText("Credentials saved securely.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Password" })).toHaveValue("");
    await expect(page.getByTestId("connected-platforms-card").getByText("Mintos")).toBeVisible();

    await page.getByRole("button", { name: "Portfolio" }).click();
    await expect(page.getByText("Mintos")).toBeVisible();
    expect(await sentMessageTypes(page)).toContain("SAVE_CREDENTIALS");
  });

  test("supports mouse selection, edit, delete, activate/deactivate, and mode pills", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      credentials: [{ platformId: "mintos", username: "old@example.test", active: true }],
    });
    await openSettings(page);

    await expect(page.getByText("Active")).toBeVisible();
    await page.getByLabel("Deactivate Mintos").click();
    await expect(page.getByText("Deactivated")).toBeVisible();
    await page.getByLabel("Activate Mintos").click();
    await expect(page.getByText("Active")).toBeVisible();

    await page.getByLabel("Show details for Mintos").click();
    await page.getByLabel("Toggle Safe Mode for Mintos").click();
    await page.getByLabel("Toggle Stealth Mode for Mintos").click();
    await expect(page.getByLabel("Toggle Safe Mode for Mintos")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Toggle Stealth Mode for Mintos")).toHaveAttribute("aria-checked", "true");

    await page.getByLabel("Edit Mintos").click();
    await expect(page.getByRole("combobox", { name: "Platform" })).toHaveValue("Mintos");
    await expect(page.getByRole("heading", { name: "Edit Mintos" })).toBeVisible();
    await expect(page.getByText("Update the credentials and login behavior for this platform.")).toBeVisible();
    await expect(page.getByLabel("Username / Email")).toBeFocused();
    await expect(page.getByLabel("Username / Email")).toHaveValue("old@example.test");
    await expect(page.getByRole("textbox", { name: "Password" })).toHaveValue("");
    await page.getByLabel("Username / Email").fill("new@example.test");
    await page.getByRole("textbox", { name: "Password" }).fill("new-secret-password");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Credentials saved securely.")).toBeVisible();

    await page.getByLabel("Remove Mintos").click();
    await expect(page.getByText("No connected platforms yet.")).toBeVisible();

    const types = await sentMessageTypes(page);
    expect(types).toContain("SAVE_SETTINGS");
    expect(types).toContain("SAVE_CREDENTIALS");
    expect(types).toContain("DELETE_CREDENTIALS");
  });

  test("persists debug, parallel sync, reminder, auto-lock, and Gemini download settings", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, "ai", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(globalThis, "LanguageModel", {
        configurable: true,
        value: undefined,
      });
    });

    await openMockedDashboard(page, {
      hasMasterPassword: true,
      geminiStatus: "downloadable",
      settings: {
        syncReminderDays: 7,
        autoLockEnabled: false,
        sessionTimeoutMinutes: 15,
        historyRetentionDays: 0,
      },
    });
    await openSettings(page);

    await page.getByRole("switch").first().click();
    await expect(page.getByRole("button", { name: "Debug" })).toBeVisible();

    await page.getByTestId("parallel-sync-toggle").click();
    await expect(page.getByTestId("parallel-sync-toggle")).toHaveAttribute("aria-checked", "true");

    const reminder = page.getByLabel("Sync Reminder Days");
    await reminder.fill("0");
    await expect(reminder).toHaveValue("1");
    await reminder.fill("366");
    await expect(reminder).toHaveValue("365");
    await reminder.fill("10.5");
    await expect(reminder).toHaveValue("10");

    await page.getByRole("switch", { name: "Enable Auto-Lock" }).click();
    const autoLockSelect = page.getByLabel("Auto-lock timeout");
    await autoLockSelect.selectOption("5");
    await expect(autoLockSelect).toHaveValue("5");

    await page.getByRole("button", { name: "Download Gemini Nano" }).click();

    const types = await sentMessageTypes(page);
    expect(types).toContain("SAVE_SETTINGS");
    expect(types).toContain("TRIGGER_GEMINI_DOWNLOAD");
  });

  test("sets a master password later and enables the auto-lock defaults", async ({
    page,
  }) => {
    await openMockedDashboard(page, { hasMasterPassword: false });
    await openSettings(page);

    await page.getByRole("button", { name: "Set Master Password" }).click();
    const dialog = page.getByRole("dialog", { name: "Set Master Password" });
    await dialog.getByLabel("Password", { exact: true }).fill("x");
    await expect(dialog.getByText("Very weak")).toBeVisible();
    await dialog.getByLabel("Confirm Password").fill("x");
    await dialog.getByRole("button", { name: "Set Password" }).click();

    await expect(page.getByText("Master password enabled")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Enable Auto-Lock" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByLabel("Auto-lock timeout")).toHaveValue("15");
    expect(await sentMessageTypes(page)).toContain("SETUP_MASTER_PASSWORD");
  });
});
