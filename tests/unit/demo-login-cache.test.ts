import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type DemoLoginCacheModule = {
  parseDemoLoginPageMode: (value: string | undefined) => "mock" | "catalog-cache";
  renderFallbackCachedLoginPage: (input: {
    platformId: string;
    platformName: string;
    sourceUrl: string;
    error?: string;
  }) => string;
  sanitizeCachedLoginHtml: (
    html: string,
    input: {
      platformId: string;
      platformName: string;
      sourceUrl: string;
    },
  ) => string;
};

let demoLoginCache: DemoLoginCacheModule;

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "scripts/demo-login-cache.mjs"),
  ).href;
  demoLoginCache = (await import(moduleUrl)) as DemoLoginCacheModule;
});

describe("demo login cache", () => {
  it("defaults to mock mode and accepts catalog-cache explicitly", () => {
    expect(demoLoginCache.parseDemoLoginPageMode(undefined)).toBe("mock");
    expect(demoLoginCache.parseDemoLoginPageMode("")).toBe("mock");
    expect(demoLoginCache.parseDemoLoginPageMode("catalog-cache")).toBe(
      "catalog-cache",
    );
    expect(demoLoginCache.parseDemoLoginPageMode("unknown")).toBe("mock");
  });

  it("sanitizes cached login HTML and rewrites form targets to demo auth", () => {
    const html = demoLoginCache.sanitizeCachedLoginHtml(
      `<!doctype html>
      <html>
        <head>
          <script>window.evil = true</script>
          <link rel="stylesheet" href="https://cdn.example/app.css">
        </head>
        <body onload="steal()">
          <form action="https://real.example/login" method="GET" target="_blank" onclick="track()">
            <input type="email" name="email" />
            <input type="password" name="password" />
            <button type="submit">Sign in</button>
          </form>
          <iframe src="https://real.example/frame"></iframe>
          <img src="https://real.example/pixel.png" />
        </body>
      </html>`,
      {
        platformId: "mintos",
        platformName: "Mintos",
        sourceUrl: "https://www.mintos.com/en/login/",
      },
    );

    expect(html).toContain('data-p2p-demo-login-cache="sanitized"');
    expect(html).toContain('action="/demo/mintos/authenticated"');
    expect(html).toContain('method="POST"');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<iframe\b/i);
    expect(html).not.toMatch(/onload|onclick|target="_blank"/i);
    expect(html).not.toContain("https://cdn.example/app.css");
    expect(html).not.toContain("https://real.example/pixel.png");
  });

  it("renders a marked fallback page when live refresh cannot capture a login", () => {
    const html = demoLoginCache.renderFallbackCachedLoginPage({
      platformId: "afranga",
      platformName: "Afranga",
      sourceUrl: "https://afranga.com/",
      error: "Navigation timeout",
    });

    expect(html).toContain('data-p2p-demo-login-cache="fallback"');
    expect(html).toContain("Afranga Login");
    expect(html).toContain("Navigation timeout");
    expect(html).toContain('action="/demo/afranga/authenticated"');
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('autocomplete="current-password"');
  });
});
