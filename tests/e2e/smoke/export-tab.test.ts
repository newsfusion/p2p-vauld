import { expect, test } from "@playwright/test";
import {
  capturedDownloadTexts,
  openMockedDashboard,
  sentMessageTypes,
} from "../fixtures/dashboard-mock.js";

const secretUsername = "plain-user@example.test";
const secretPassword = "plain-secret-password";

const backup = {
  format: "p2p-portfolio-tracker-financial-backup",
  version: 1,
  exportedAt: "2026-06-08T10:00:00.000Z",
  appVersion: "0.12.86",
  payload: {
    overviewMetrics: [
      {
        platformId: "mintos",
        fetchedAt: "2026-06-08T10:00:00.000Z",
        platformValue: 1000,
        freeCash: 25,
        currency: "EUR",
        confidence: 0.9,
        sourceKind: "restore" as const,
      },
    ],
    metricsHistory: [],
    cashflows: [],
    positions: [],
    riskEvents: [],
    deltaLogs: [],
  },
};

test.describe("Export and restore manual flows", () => {
  test.beforeEach(async ({ page }) => {
    await openMockedDashboard(page, {
      backup,
      metrics: backup.payload.overviewMetrics,
      credentials: [],
      dataPlatformIds: ["mintos"],
    });
    await expect(page.getByRole("button", { name: "Portfolio" })).toBeVisible();
  });

  test("downloads CSV and JSON exports without credentials or plaintext secrets", async ({
    page,
  }) => {
    await expect(page.getByText("Imported data only")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add credentials" })).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("heading", { exact: true, name: "Export" })).toBeVisible();

    await page.getByTestId("export-csv").click();
    let downloads = await capturedDownloadTexts(page);
    expect(downloads[0]).toContain("mintos");
    expect(downloads[0]).toContain("1000");
    expect(downloads[0]).not.toContain(secretUsername);
    expect(downloads[0]).not.toContain(secretPassword);

    await page.getByTestId("export-json").click();
    await expect.poll(async () => (await capturedDownloadTexts(page)).length).toBeGreaterThanOrEqual(2);
    downloads = await capturedDownloadTexts(page);
    expect(downloads[1]).toContain("p2p-portfolio-tracker-financial-backup");
    expect(downloads[1]).not.toContain(secretUsername);
    expect(downloads[1]).not.toContain(secretPassword);

    const sentTypes = await sentMessageTypes(page);
    expect(sentTypes).toContain("GET_EXPORT_DATA");
    expect(sentTypes).toContain("CREATE_FINANCIAL_BACKUP");
  });

  test("restores valid backup and keeps imported-only platforms read-only until credentials are added", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Export" }).click();

    await page
      .getByTestId("restore-file-input")
      .setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup)),
      });
    await expect(page.getByText("Backup ready to restore.")).toBeVisible();
    await page.getByTestId("restore-backup").click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore" })
      .click();
    await expect(page.getByText("Backup restored.")).toBeVisible();

    await page.getByRole("button", { name: "Portfolio" }).click();
    await expect(page.getByText("Imported data only")).toBeVisible();
    await page.getByRole("button", { name: "Add credentials" }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });

  test("rejects invalid, wrong-schema, and oversized restore files", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Export" }).click();
    const input = page.getByTestId("restore-file-input");
    const restore = page.getByTestId("restore-backup");

    await input.setInputFiles({
      name: "not-json.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("this is not json"),
    });
    await expect(page.getByText("Invalid JSON backup file.")).toBeVisible();
    await expect(restore).toBeDisabled();

    await input.setInputFiles({
      name: "wrong.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ nope: true })),
    });
    await expect(page.getByText("Invalid backup format.")).toBeVisible();
    await expect(restore).toBeDisabled();

    await input.setInputFiles({
      name: "huge.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, "x"),
    });
    await expect(page.getByText("Backup file is too large.")).toBeVisible();
    await expect(restore).toBeDisabled();
  });
});
