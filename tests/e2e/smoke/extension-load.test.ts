import { expect, test } from "../fixtures/extension.js";

test("loads the production MV3 service worker and dashboard", async ({
  dashboardPage,
  extensionContext,
  extensionId,
}) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  expect(
    extensionContext
      .serviceWorkers()
      .some((worker) => worker.url().startsWith(`chrome-extension://${extensionId}/`)),
  ).toBe(true);
  await expect(dashboardPage).toHaveTitle(/P2P Portfolio Tracker/i);
});
