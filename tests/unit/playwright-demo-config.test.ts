import { describe, expect, it } from "vitest";
import {
  demoPlaywrightReporter,
  demoPlaywrightUse,
} from "../e2e/fixtures/demo-playwright-options.js";

describe("Playwright demo config", () => {
  it("keeps the CDP extension loop readable for agents", () => {
    expect(demoPlaywrightReporter).toBe("list");
    expect(demoPlaywrightUse).toMatchObject({
      headless: true,
      screenshot: "only-on-failure",
      trace: "retain-on-failure",
    });
  });
});
