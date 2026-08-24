import { type Server } from "node:http";
import { test, expect } from "../fixtures/extension.js";

const DEMO_PLATFORM_IDS = [
  "mintos",
  "bondora_go_grow",
  "peerberry",
  "robocash",
  "twino",
  "estateguru",
  "debitum",
  "esketit",
  "viainvest",
  "nectaro",
];
const DEMO_COHORT_STORAGE_KEY = "demo:p2p_demo_platform_cohort";

type DemoMockServiceModule = {
  DEMO_ALL_PLATFORM_IDS: string[];
  createDemoMockServer: (options?: {
    loginPageMode?: "mock" | "catalog-cache";
    loginCacheDir?: string;
  }) => { server: Server; state: Map<string, number> };
};

let demoServiceModule: DemoMockServiceModule;
let demoAllPlatformIds: string[] = [];

function demoBaseDayIso(now = new Date()): string {
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  todayStart.setUTCFullYear(todayStart.getUTCFullYear() - 1);
  return todayStart.toISOString().slice(0, 10);
}

function demoStepDays(syncIndex: number): number {
  return 14 + ((syncIndex * 17 + 11) % 21);
}

function createDemoServer(): Promise<Server> {
  const { server } = demoServiceModule.createDemoMockServer({
    loginPageMode: "catalog-cache",
    loginCacheDir: "__missing_demo_login_cache__",
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(4180, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  server.closeIdleConnections?.();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.closeAllConnections?.();
      resolve();
    }, 5_000);
    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startSyncAndWait(
  page: import("@playwright/test").Page,
  platformIds?: string[],
) {
  const response = await page.evaluate((platformIds) =>
    chrome.runtime.sendMessage({
      type: "START_SYNC",
      payload: platformIds ? { platformIds } : {},
    }),
    platformIds,
  );
  expect(response?.error).toBeFalsy();

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const status = await chrome.runtime.sendMessage({
            type: "GET_SYNC_STATUS",
          });
          return status.run?.state;
        }),
      { timeout: 540_000 },
    )
    .toBe("completed");

  return page.evaluate(async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_METRICS" });
    return response.metrics as Array<{ platformId: string; fetchedAt: string }>;
  });
}

async function countMetricsHistory(
  page: import("@playwright/test").Page,
  databaseName: string,
) {
  return page.evaluate(
    (name) =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("metricsHistory", "readonly");
          const countRequest = tx.objectStore("metricsHistory").count();
          countRequest.onerror = () => reject(countRequest.error);
          countRequest.onsuccess = () => resolve(countRequest.result);
        };
      }),
    databaseName,
  );
}

async function listDatabaseNames(page: import("@playwright/test").Page) {
  return page.evaluate(async () =>
    (await indexedDB.databases())
      .map((database) => database.name)
      .filter((name): name is string => typeof name === "string"),
  );
}

async function setDemoCohort(page: import("@playwright/test").Page, cohortIndex: number) {
  await page.evaluate(
    ({ key, cohortIndex }) =>
      chrome.storage.local.set({ [key]: cohortIndex }),
    { key: DEMO_COHORT_STORAGE_KEY, cohortIndex },
  );
}

async function getCredentialPlatformIds(page: import("@playwright/test").Page) {
  const status = await page.evaluate(() =>
    chrome.runtime.sendMessage({ type: "GET_CREDENTIAL_STATUS" }),
  );
  return status.platformIds as string[];
}

test.describe("Demo mode smoke", () => {
  let server: Server | undefined;

  test.beforeAll(async () => {
    const moduleUrl = new URL(
      "../../../scripts/demo-mock-service.mjs",
      import.meta.url,
    ).href;
    demoServiceModule = (await import(moduleUrl)) as DemoMockServiceModule;
    demoAllPlatformIds = demoServiceModule.DEMO_ALL_PLATFORM_IDS;
    server = await createDemoServer();
  });

  test.afterAll(async () => {
    await closeServer(server);
  });

  test("syncs selected default demo cohort platforms through the official demo service", async ({
    dashboardPage,
  }) => {
    await setDemoCohort(dashboardPage, 0);
    const platformIds = await getCredentialPlatformIds(dashboardPage);
    if (!Array.isArray(platformIds)) {
      test.skip(true, "Build dist with VITE_DEMO_MODE=true before running demo smoke");
      return;
    }
    test.skip(
      platformIds.join(",") !== DEMO_PLATFORM_IDS.join(","),
      "Build dist with VITE_DEMO_MODE=true before running demo smoke",
    );

    const settingsResponse = await dashboardPage.evaluate(() =>
      chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        payload: { parallelSyncEnabled: false },
      }),
    );
    expect(settingsResponse?.success).toBe(true);

    const requestedPlatformIds = DEMO_PLATFORM_IDS.slice(0, 1);
    const firstMetrics = await startSyncAndWait(
      dashboardPage,
      requestedPlatformIds,
    );
    expect(firstMetrics).toHaveLength(requestedPlatformIds.length);
    expect(firstMetrics.map((metric) => metric.platformId).sort()).toEqual(
      [...requestedPlatformIds].sort(),
    );
    const firstDay = demoBaseDayIso();
    expect(firstMetrics[0]?.fetchedAt.startsWith(firstDay)).toBe(true);
    expect(await countMetricsHistory(dashboardPage, "demo:p2p_tracker")).toBe(
      requestedPlatformIds.length,
    );
    const databaseNames = await listDatabaseNames(dashboardPage);
    expect(databaseNames).toContain("demo:p2p_keystore");
    expect(databaseNames).not.toContain("p2p_keystore");
    expect(databaseNames).not.toContain("p2p_tracker");
    await expect(dashboardPage.getByRole("columnheader", { name: "Portfolio Value" })).toBeVisible();
    await expect(dashboardPage.getByRole("columnheader", { name: "Free Cash" })).toBeVisible();
    await expect(dashboardPage.getByRole("row", { name: /Mintos/ })).toBeVisible();
    await expect(
      dashboardPage.getByText("No configured platforms yet. Add login credentials in Settings."),
    ).toBeHidden();

    expect(demoStepDays(0)).toBe(25);
  });

  test("exposes every catalog platform through deterministic demo cohorts", async ({
    dashboardPage,
  }) => {
    test.skip(
      demoAllPlatformIds.length !== 54,
      "Demo service catalog fixture did not expose 54 platforms",
    );

    const seen = new Set<string>();
    for (let cohortIndex = 0; cohortIndex < 6; cohortIndex += 1) {
      await setDemoCohort(dashboardPage, cohortIndex);
      const platformIds = await getCredentialPlatformIds(dashboardPage);
      if (!Array.isArray(platformIds)) {
        test.skip(true, "Build dist with VITE_DEMO_MODE=true before running demo smoke");
        return;
      }
      expect(platformIds.length).toBeLessThanOrEqual(10);
      expect(platformIds).toEqual(
        demoAllPlatformIds.slice(cohortIndex * 10, cohortIndex * 10 + 10),
      );

      for (const platformId of platformIds) {
        seen.add(platformId);
        const loginResponse = await dashboardPage.request.get(
          `http://127.0.0.1:4180/demo/${platformId}/login`,
        );
        expect(loginResponse.ok()).toBe(true);
        expect(await loginResponse.text()).toContain(
          `/demo/${platformId}/authenticated`,
        );

        const dashboardResponse = await dashboardPage.request.get(
          `http://127.0.0.1:4180/demo/${platformId}/dashboard`,
        );
        expect(dashboardResponse.ok()).toBe(true);
        expect(await dashboardResponse.text()).toMatch(
          /Portfolio|Account|Summary|Dashboard|Free Cash|Wallet/i,
        );
      }
    }

    expect([...seen]).toEqual(demoAllPlatformIds);
  });
});
