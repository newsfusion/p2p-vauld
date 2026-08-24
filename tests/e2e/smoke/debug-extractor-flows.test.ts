import { expect, test } from "@playwright/test";
import { openMockedDashboard, sentMessageTypes } from "../fixtures/dashboard-mock.js";

const debugSnapshot = {
  platformId: "mintos",
  platformName: "Mintos",
  timestamp: "2026-06-08T10:00:00.000Z",
  loginSuccess: true,
  logs: [
    {
      timestamp: "2026-06-08T10:00:01.000Z",
      level: "info",
      message: "Opened dashboard",
      elapsedMs: 15,
    },
    {
      timestamp: "2026-06-08T10:00:02.000Z",
      level: "warn",
      message: "Low confidence fallback",
      elapsedMs: 30,
    },
  ],
  signals: [
    {
      signalKey: "portfolio_value",
      selectors: [".portfolio-value"],
      elementsScanned: 42,
      confidence: 0.91,
      picked: {
        value: 1000,
        text: "Portfolio Value EUR 1,000.00",
        selector: ".portfolio-value",
        currency: "EUR",
        confidence: 0.91,
        strategy: "selector",
        context: "Portfolio Value",
      },
      candidates: [
        {
          value: 1000,
          text: "Portfolio Value EUR 1,000.00",
          selector: ".portfolio-value",
          currency: "EUR",
          confidence: 0.91,
          strategy: "selector",
          context: "Portfolio Value",
        },
      ],
      aiLog: {
        available: true,
        snippetCount: 3,
        estimatedTokens: 100,
        promptText: "Extract portfolio value",
        rawResponse: '{"value":1000}',
        parsedValue: 1000,
        parsedCurrency: "EUR",
        durationMs: 5,
      },
    },
  ],
  rawLoginHtml: "<html><body><form><input name='email'><input type='password'><button>Sign in</button></form><p>Captured Login HTML</p></body></html>",
  rawHtml: "<html><body><section><h1>Dashboard</h1><div class='portfolio-value'>EUR 1,000.00</div><p>Captured Dashboard HTML</p></section></body></html>",
};

async function openDebug(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "Debug" }).click();
  await expect(page.getByRole("heading", { name: "Debug Mode" })).toBeVisible();
}

test.describe("Debug and extractor manual flows", () => {
  test("shows empty debug state, configured sync actions, and cleanup stale sync action", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      credentials: [{ platformId: "mintos" }],
      settings: { debugModeEnabled: true },
    });
    await openDebug(page);

    await expect(page.getByText("Run a sync to see the live activity log")).toBeVisible();
    await expect(page.getByTestId("debug-sync-mintos")).toBeVisible();
    await page.getByRole("button", { name: "Cleanup Stale Syncs" }).click();
    expect(await sentMessageTypes(page)).toContain("CLEANUP_STALE_SYNCS");
  });

  test("renders activity logs, signal details, AI details, and separate HTML viewers", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      credentials: [{ platformId: "mintos" }],
      settings: { debugModeEnabled: true },
    });
    await page.evaluate((snapshot) => {
      // @ts-expect-error Exposed on window for E2E tests
      window.useDashboardStore.setState({
        debugMode: true,
        view: "debug",
        debugSnapshots: [snapshot],
      });
    }, debugSnapshot);

    await expect(page.getByRole("heading", { name: "Activity Log" })).toBeVisible();
    await expect(page.getByRole("button", { name: /portfolio_value/ })).toBeVisible();

    await expect(page.getByTestId("html-viewer-login")).toContainText("Login Page HTML");
    await expect(page.getByTestId("html-viewer-dashboard")).toContainText("Dashboard HTML");
    await page.getByTestId("html-viewer-login").getByRole("button", { name: "Raw HTML" }).click();
    await expect(page.locator("textarea").filter({ hasText: "Captured Login HTML" })).toBeVisible();
    await page.getByTestId("html-viewer-dashboard").getByRole("button", { name: "Raw HTML" }).click();
    await expect(page.locator("textarea").filter({ hasText: "Captured Dashboard HTML" })).toBeVisible();
  });

  test("transfers captured login and dashboard HTML into extractor tabs and clears context", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      credentials: [{ platformId: "mintos" }],
      settings: { debugModeEnabled: true },
    });
    await page.evaluate((snapshot) => {
      // @ts-expect-error Exposed on window for E2E tests
      window.useDashboardStore.setState({
        debugMode: true,
        view: "debug",
        debugSnapshots: [snapshot],
      });
    }, debugSnapshot);

    await page.getByTestId("send-to-extractor-login").click();
    await expect(page.getByRole("heading", { name: "Login Extractor" })).toBeVisible();
    await expect(page.getByText("Transferred HTML")).toBeVisible();
    await expect(page.getByText("Captured Login HTML")).toBeVisible();
    await page.getByTestId("transferred-login-test").click();
    await expect(page.getByText("Username").first()).toBeVisible();
    await page.getByTestId("clear-login-transfer").click();
    await expect(page.getByText("Transferred HTML")).toBeHidden();

    await page.evaluate((snapshot) => {
      // @ts-expect-error Exposed on window for E2E tests
      window.useDashboardStore.setState({ view: "debug", debugSnapshots: [snapshot] });
    }, debugSnapshot);
    await page.getByTestId("send-to-extractor-dashboard").click();
    await expect(page.getByRole("heading", { name: "Dashboard Extractor" })).toBeVisible();
    await expect(page.getByText("Captured Dashboard HTML")).toBeVisible();
    await page.getByTestId("transferred-dashboard-test").click();
    await expect(page.getByText(/Dashboard Extractor Result|portfolio value/i).first()).toBeVisible();
    await page.getByTestId("clear-dashboard-transfer").click();
    await expect(page.getByText("Transferred HTML")).toBeHidden();
  });

  test("runs login and dashboard fixture tests with temporary selector overrides", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      settings: { debugModeEnabled: true },
    });

    await page.getByRole("button", { name: "Login Extractor" }).click();
    await expect(page.getByRole("heading", { name: "Login Extractor" })).toBeVisible();
    await page.getByRole("button", { name: "Test" }).first().click();
    await expect(page.getByText("Username").first()).toBeVisible();

    await page.getByRole("button", { name: "Dashboard Extractor" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard Extractor" })).toBeVisible();
    await page.getByRole("button", { name: "Test" }).first().click();
    await expect(page.getByText(/Dashboard Extractor Result|Text Tree|portfolio/i).first()).toBeVisible();
  });

  test("saves manual value override and updates portfolio metrics", async ({
    page,
  }) => {
    await openMockedDashboard(page, {
      credentials: [{ platformId: "mintos" }],
      metrics: [
        {
          platformId: "mintos",
          fetchedAt: "2026-06-08T10:00:00.000Z",
          platformValue: 10,
          freeCash: 1,
          currency: "EUR",
          confidence: 0.9,
        },
      ],
      settings: { debugModeEnabled: true },
    });
    await openDebug(page);

    await page.getByRole("button", { name: /Manual Value Override/ }).click();
    const inputs = page.locator("tbody input");
    await inputs.nth(0).fill("2222.22");
    await inputs.nth(1).fill("33.44");
    await inputs.nth(2).fill("7.89");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved!")).toBeVisible();

    await page.getByRole("button", { name: "Portfolio" }).click();
    await expect(page.getByText("Mintos")).toBeVisible();
  });
});
