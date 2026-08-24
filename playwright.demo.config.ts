import { defineConfig } from "@playwright/test";
import {
  demoPlaywrightReporter,
  demoPlaywrightUse,
} from "./tests/e2e/fixtures/demo-playwright-options";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 600_000,
  retries: 0,
  reporter: demoPlaywrightReporter,
  use: demoPlaywrightUse,
  projects: [
    {
      name: "smoke",
      testMatch: [
        "smoke/demo-sync.test.ts",
        "smoke/cdp-content-script.demo.test.ts",
        "smoke/service-worker-restart.demo.test.ts",
      ],
    },
  ],
});
