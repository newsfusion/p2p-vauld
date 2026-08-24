import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pathToExtension = path.resolve(__dirname, '../../../dist');

function resolveChromeExecutablePath(): string | undefined {
  return process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH;
}

type WorkerFixtures = {
  extensionContext: BrowserContext;
  extensionId: string;
};

type TestFixtures = {
  dashboardPage: Page;
};

export type ExtensionServiceWorkerTarget = {
  targetId: string;
  url: string;
};

async function listExtensionServiceWorkerTargets(
  context: BrowserContext,
  page: Page,
  extensionId: string,
): Promise<ExtensionServiceWorkerTarget[]> {
  const client = await context.newCDPSession(page);
  try {
    const { targetInfos } = await client.send("Target.getTargets");
    return targetInfos
      .filter(
        (target) =>
          target.type === "service_worker" &&
          target.url.startsWith(`chrome-extension://${extensionId}/`),
      )
      .map(({ targetId, url }) => ({ targetId, url }));
  } finally {
    await client.detach();
  }
}

export async function findExtensionServiceWorkerTarget(
  context: BrowserContext,
  page: Page,
  extensionId: string,
): Promise<ExtensionServiceWorkerTarget> {
  const targets = await listExtensionServiceWorkerTargets(
    context,
    page,
    extensionId,
  );
  if (targets.length !== 1) {
    throw new Error(
      `Expected one service worker target for ${extensionId}, found ${targets.length}`,
    );
  }
  return targets[0]!;
}

export async function getExtensionServiceWorkerInstanceId(
  context: BrowserContext,
  extensionId: string,
): Promise<string> {
  const worker = context
    .serviceWorkers()
    .find((candidate) =>
      candidate.url().startsWith(`chrome-extension://${extensionId}/`),
    );
  if (!worker) {
    throw new Error(`No running service worker found for ${extensionId}`);
  }

  return worker.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __p2pE2eWorkerInstanceId?: string;
    };
    scope.__p2pE2eWorkerInstanceId ??= crypto.randomUUID();
    return scope.__p2pE2eWorkerInstanceId;
  });
}

export async function stopExtensionServiceWorker(
  context: BrowserContext,
  page: Page,
  extensionId: string,
  targetId: string,
): Promise<void> {
  const client = await context.newCDPSession(page);
  try {
    const versionIdPromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () =>
          reject(
            new Error(`Service worker version not found for ${extensionId}`),
          ),
        5_000,
      );
      client.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
        const version = versions.find(
          (candidate) =>
            candidate.scriptURL.startsWith(`chrome-extension://${extensionId}/`) &&
            candidate.runningStatus === "running",
        );
        if (!version) return;
        clearTimeout(timeout);
        resolve(version.versionId);
      });
    });
    await client.send("ServiceWorker.enable");
    const versionId = await versionIdPromise;
    await client.send("ServiceWorker.stopWorker", { versionId });
  } finally {
    await client.detach();
  }

  await expect
    .poll(async () => {
      const targets = await listExtensionServiceWorkerTargets(
        context,
        page,
        extensionId,
      );
      return targets.some((target) => target.targetId === targetId);
    })
    .toBe(false);
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // Worker-scoped: one browser context shared across all tests in a worker
  extensionContext: [
    async ({}, use) => { // eslint-disable-line no-empty-pattern
      const executablePath = resolveChromeExecutablePath();
      const context = await chromium.launchPersistentContext('', {
        headless: false,
        ...(executablePath ? { executablePath } : {}),
        args: [
          '--headless=new',
          `--disable-extensions-except=${pathToExtension}`,
          `--load-extension=${pathToExtension}`,
          '--disable-blink-features=AutomationControlled',
        ],
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],

  extensionId: [
    async ({ extensionContext }, use) => {
      let sw = extensionContext.serviceWorkers()[0];
      if (!sw) {
        sw = await extensionContext.waitForEvent('serviceworker');
      }
      const extensionId = sw.url().split('/')[2]!;
      await use(extensionId);
    },
    { scope: 'worker' },
  ],

  // Test-scoped: new page per test for isolation
  dashboardPage: async ({ extensionContext, extensionId }, use) => {
    const page = await extensionContext.newPage();
    page.on("console", (msg) => console.log(`[BROWSER CONSOLE] ${msg.text()}`));
    page.on("pageerror", (err) => console.error(`[BROWSER ERROR] ${err.message}`));
    extensionContext.on("console", (msg) => console.log(`[WORKER CONSOLE] ${msg.text()}`));
    await page.goto(`chrome-extension://${extensionId}/dashboard.html`);
    await use(page); // eslint-disable-line react-hooks/rules-of-hooks
    await page.close();
  },
});

export { expect };
