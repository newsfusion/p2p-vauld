import http, { type Server } from "node:http";
import { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "../fixtures/extension.js";
import { ExtensionDashboardPage, PlatformContentPage } from "../fixtures/extension-pages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distManifestPath = path.resolve(__dirname, "../../../dist/manifest.json");

function distManifestAllowsLocalhost(): boolean {
  const manifest = JSON.parse(readFileSync(distManifestPath, "utf8")) as {
    content_scripts?: Array<{ matches?: string[] }>;
  };
  return (manifest.content_scripts ?? []).some((script) =>
    (script.matches ?? []).some((match) => match.startsWith("http://127.0.0.1/")),
  );
}

function pageHtml(body: string): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Demo P2P Login</title></head>
  <body>${body}</body>
</html>`;
}

function createLoginServer(): Promise<{ server: Server; origin: string }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    res.setHeader("content-type", "text/html; charset=utf-8");

    if (url.pathname === "/two-factor") {
      res.end(
        pageHtml(`<main>
          <h1>Demo P2P Two-Factor</h1>
          <form>
            <label>Security code <input name="otp" autocomplete="one-time-code" /></label>
            <button type="submit">Verify</button>
          </form>
        </main>`),
      );
      return;
    }

    res.end(
      pageHtml(`<main>
        <h1>Demo P2P Login</h1>
        <form>
          <label>Email <input type="email" name="email" autocomplete="username" /></label>
          <label>Password <input type="password" name="password" autocomplete="current-password" /></label>
          <button type="submit">Sign in</button>
        </form>
      </main>`),
    );
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
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

test.describe("CDP-backed extension smoke", () => {
  let server: Server | undefined;
  let origin = "";

  test.beforeAll(async () => {
    test.skip(
      !distManifestAllowsLocalhost(),
      "Build dist with VITE_DEMO_MODE=true so localhost pages receive the content script",
    );
    const started = await createLoginServer();
    server = started.server;
    origin = started.origin;
  });

  test.afterAll(async () => {
    await closeServer(server);
  });

  test("opens extension pages and switches back to a content tab through CDP", async ({
    extensionContext,
    extensionId,
  }) => {
    const contentPage = new PlatformContentPage(
      await extensionContext.newPage(),
    );
    await contentPage.goto(`${origin}/login`);

    const dashboardPage = new ExtensionDashboardPage(
      await extensionContext.newPage(),
      extensionId,
    );
    await dashboardPage.open();
    await dashboardPage.expectLoaded();

    await contentPage.bringToFrontWithCdp();
    await expect(contentPage.page.getByRole("heading", { name: "Demo P2P Login" })).toBeVisible();

    await expect.poll(() => dashboardPage.checkActiveTabLoginState()).toMatchObject({
      loggedIn: false,
      requires2FA: false,
      requiresCaptcha: false,
      url: `${origin}/login`,
    });
  });

  test("detects 2FA state from the active content tab through the dashboard", async ({
    extensionContext,
    extensionId,
  }) => {
    const contentPage = new PlatformContentPage(
      await extensionContext.newPage(),
    );
    await contentPage.goto(`${origin}/two-factor`);

    const dashboardPage = new ExtensionDashboardPage(
      await extensionContext.newPage(),
      extensionId,
    );
    await dashboardPage.open();
    await dashboardPage.expectLoaded();

    await contentPage.bringToFrontWithCdp();
    await expect(contentPage.page.getByRole("heading", { name: "Demo P2P Two-Factor" })).toBeVisible();

    await expect.poll(() => dashboardPage.checkActiveTabLoginState()).toMatchObject({
      loggedIn: false,
      requires2FA: true,
      requiresCaptcha: false,
      url: `${origin}/two-factor`,
    });
  });
});
