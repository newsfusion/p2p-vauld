import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 1,
  use: {
    headless: true,
    baseURL: "http://127.0.0.1:4173",
    locale: "de-DE",
  },
  webServer: {
    command:
      "pnpm exec vite preview --config vite.playwright.config.ts --host 127.0.0.1 --strictPort --port 4173",
    url: "http://127.0.0.1:4173/dashboard.html",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
  projects: [
    {
      name: "chromium",
      testMatch: "*.test.ts",
      testIgnore: "smoke/**",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "smoke",
      testMatch: "smoke/**/*.test.ts",
      testIgnore: "smoke/**/*.demo.test.ts",
      timeout: 120_000,
      retries: 0,
    },
  ],
});
