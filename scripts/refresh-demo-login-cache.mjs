import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import {
  DEMO_LOGIN_CACHE_DIR,
  getDemoLoginSnapshotPath,
  renderFallbackCachedLoginPage,
  sanitizeCachedLoginHtml,
} from "./demo-login-cache.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const catalogPath = path.join(repoRoot, "src", "shared", "platforms", "platform-catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

const cacheDir = process.env.DEMO_LOGIN_CACHE_DIR
  ? path.resolve(process.env.DEMO_LOGIN_CACHE_DIR)
  : DEMO_LOGIN_CACHE_DIR;
const requestedIds = new Set(
  (process.env.DEMO_LOGIN_CACHE_PLATFORM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);
const platforms = requestedIds.size
  ? catalog.filter((platform) => requestedIds.has(platform.id))
  : catalog;

mkdirSync(cacheDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1366, height: 900 },
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
});

let failures = 0;

for (const platform of platforms) {
  const outputPath = getDemoLoginSnapshotPath(platform.id, cacheDir);
  try {
    await page.goto(platform.login.entryUrl, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await page.waitForTimeout(1_500);
    const html = await page.content();
    const sanitized = sanitizeCachedLoginHtml(html, {
      platformId: platform.id,
      platformName: platform.name,
      sourceUrl: platform.login.entryUrl,
    });
    writeFileSync(outputPath, sanitized, "utf8");
    console.log(`cached ${platform.id}`);
  } catch (error) {
    failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(
      outputPath,
      renderFallbackCachedLoginPage({
        platformId: platform.id,
        platformName: platform.name,
        sourceUrl: platform.login.entryUrl,
        error: message,
      }),
      "utf8",
    );
    console.warn(`fallback ${platform.id}: ${message}`);
  }
}

await browser.close();
console.log(`Demo login cache refresh complete: ${platforms.length} platforms, ${failures} fallbacks.`);
