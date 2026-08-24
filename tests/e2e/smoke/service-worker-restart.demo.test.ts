import { type Server } from "node:http";
import {
  expect,
  findExtensionServiceWorkerTarget,
  getExtensionServiceWorkerInstanceId,
  stopExtensionServiceWorker,
  test,
} from "../fixtures/extension.js";

const ACTIVE_SYNC_KEY = "demo:p2p_active_sync";
const PLATFORM_ID = "mintos";

type DashboardRequest = {
  platformId: string;
};

type SyncStatusResponse = {
  run: {
    runId: string;
    state: string;
    message?: string;
    platformProgress?: Record<string, string>;
  };
};

type DemoMockServiceModule = {
  createDemoMockServer: (options?: {
    beforeDashboardResponse?: (request: DashboardRequest) => Promise<void>;
    renderDashboard?: (request: DashboardRequest & { stateIndex: number }) => string;
  }) => { server: Server };
};

function renderDeterministicMintosDashboard({ stateIndex }: { stateIndex: number }) {
  const portfolioValue = (4_000 + stateIndex * 250).toFixed(2);
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Mintos Dashboard</title></head>
  <body>
    <main>
      <section data-testid="account-overview" aria-label="Portfolio summary">
        <h1 data-testid="total-value">Portfolio Value €${portfolioValue}</h1>
        <p>Free Cash <span class="m-u-nowrap m-u-color-n10--text">€${portfolioValue}</span></p>
      </section>
    </main>
  </body>
</html>`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  server.closeIdleConnections?.();
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, 5_000);
    server.close(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function startSync(
  page: import("@playwright/test").Page,
): Promise<string> {
  const response = await page.evaluate((platformId) =>
    chrome.runtime.sendMessage({
      type: "START_SYNC",
      payload: { platformIds: [platformId] },
    }), PLATFORM_ID);
  expect(response?.error).toBeFalsy();
  expect(response?.runId).toEqual(expect.any(String));
  return response.runId as string;
}

async function waitForRunState(
  page: import("@playwright/test").Page,
  expectedState: "completed" | "failed",
) {
  let latestStatus: SyncStatusResponse | undefined;
  await expect.poll(async () => {
    latestStatus = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: "GET_SYNC_STATUS" }));
    return latestStatus?.run.state;
  }, { timeout: 60_000 }).toBe(expectedState);
  return latestStatus!;
}

async function getMintosMetric(page: import("@playwright/test").Page) {
  const response = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "GET_METRICS" }));
  return response.metrics.find(
    (metric: { platformId: string }) => metric.platformId === PLATFORM_ID,
  );
}

async function seedMintosSelectorProfiles(
  page: import("@playwright/test").Page,
): Promise<void> {
  await expect.poll(() => page.evaluate(async () =>
    (await indexedDB.databases()).some(
      (database) => database.name === "demo:p2p_tracker",
    ))).toBe(true);

  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("demo:p2p_tracker");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction("selectorProfiles", "readwrite");
      const store = transaction.objectStore("selectorProfiles");
      const now = new Date().toISOString();
      store.put({
        platformId: "mintos",
        signalKey: "portfolio_value",
        selector: 'h1[data-testid="total-value"]',
        confidence: 0.99,
        source: "user",
        learnedAt: now,
        lastVerifiedAt: now,
        failureCount: 0,
      });
      store.put({
        platformId: "mintos",
        signalKey: "free_cash",
        selector:
          '[data-testid="account-overview"] span.m-u-nowrap.m-u-color-n10--text',
        confidence: 0.99,
        source: "user",
        learnedAt: now,
        lastVerifiedAt: now,
        failureCount: 0,
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    };
  }));
}

test.describe("MV3 service worker restart recovery", () => {
  let server: Server | undefined;
  let blockNextDashboardRequest = false;
  let dashboardBlocked = deferred<void>();
  let releaseDashboard = deferred<void>();

  test.beforeAll(async () => {
    const moduleUrl = new URL(
      "../../../scripts/demo-mock-service.mjs",
      import.meta.url,
    ).href;
    const demoService = (await import(moduleUrl)) as DemoMockServiceModule;
    ({ server } = demoService.createDemoMockServer({
      renderDashboard: ({ platformId, stateIndex }) =>
        platformId === PLATFORM_ID
          ? renderDeterministicMintosDashboard({ stateIndex })
          : "",
      beforeDashboardResponse: async ({ platformId }) => {
        if (platformId !== PLATFORM_ID || !blockNextDashboardRequest) return;
        blockNextDashboardRequest = false;
        dashboardBlocked.resolve();
        await releaseDashboard.promise;
      },
    }));

    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(4180, "127.0.0.1", resolve);
    });
  });

  test.afterAll(async () => {
    releaseDashboard.resolve();
    await closeServer(server);
  });

  test("recovers an interrupted sync after the real service worker is terminated", async ({
    dashboardPage,
    extensionContext,
    extensionId,
  }) => {
    await dashboardPage.getByRole("button", { name: /Use Invisible Key/ }).click();
    await expect(
      dashboardPage.getByRole("heading", { name: "Confirm Invisible Key" }),
    ).toBeVisible();
    await dashboardPage.getByRole("button", { name: "Continue" }).click();
    await expect(
      dashboardPage.getByRole("dialog", { name: "Set up security" }),
    ).toBeHidden();

    await seedMintosSelectorProfiles(dashboardPage);
    const baselineRunId = await startSync(dashboardPage);
    const baselineRun = await waitForRunState(dashboardPage, "completed");
    expect(baselineRun.run.runId).toBe(baselineRunId);
    const baselineMetric = await getMintosMetric(dashboardPage);
    expect(baselineMetric).toBeTruthy();

    dashboardBlocked = deferred<void>();
    releaseDashboard = deferred<void>();
    blockNextDashboardRequest = true;

    const mintosRow = dashboardPage.getByRole("row", { name: /Mintos/ });
    await expect(mintosRow).toBeVisible();
    await mintosRow.getByRole("button", { name: "Sync" }).click();
    await dashboardBlocked.promise;

    const interruptedRun = await dashboardPage.evaluate(async (activeSyncKey) => {
      const [status, session] = await Promise.all([
        chrome.runtime.sendMessage({ type: "GET_SYNC_STATUS" }),
        chrome.storage.session.get(activeSyncKey),
      ]);
      return { status, activeRunId: session[activeSyncKey] };
    }, ACTIVE_SYNC_KEY);
    expect(interruptedRun.status.run?.state).toBe("running");
    expect(interruptedRun.activeRunId).toBe(interruptedRun.status.run.runId);

    const originalTarget = await findExtensionServiceWorkerTarget(
      extensionContext,
      dashboardPage,
      extensionId,
    );
    const originalInstanceId = await getExtensionServiceWorkerInstanceId(
      extensionContext,
      extensionId,
    );
    await stopExtensionServiceWorker(
      extensionContext,
      dashboardPage,
      extensionId,
      originalTarget.targetId,
    );
    releaseDashboard.resolve();

    await dashboardPage.reload();
    const restartedTarget = await findExtensionServiceWorkerTarget(
      extensionContext,
      dashboardPage,
      extensionId,
    );
    expect(restartedTarget.url).toBe(originalTarget.url);
    const restartedInstanceId = await getExtensionServiceWorkerInstanceId(
      extensionContext,
      extensionId,
    );
    expect(restartedInstanceId).not.toBe(originalInstanceId);

    const recovered = await waitForRunState(dashboardPage, "failed");
    expect(recovered.run).toMatchObject({
      runId: interruptedRun.activeRunId,
      state: "failed",
      message: "Sync interrupted by service worker restart",
      platformProgress: { mintos: "failed_timeout" },
    });
    await expect.poll(() => dashboardPage.evaluate((activeSyncKey) =>
      chrome.storage.session.get(activeSyncKey).then(
        (session) => session[activeSyncKey],
      ), ACTIVE_SYNC_KEY)).toBeUndefined();

    expect(await getMintosMetric(dashboardPage)).toEqual(baselineMetric);
    await expect(mintosRow.getByRole("button", { name: "Sync" })).toBeEnabled();
    await expect(dashboardPage.getByText("Starting sync...")).toHaveCount(0);

    const retryRunId = await startSync(dashboardPage);
    const retryRun = await waitForRunState(dashboardPage, "completed");
    expect(retryRun.run.runId).toBe(retryRunId);
  });
});
