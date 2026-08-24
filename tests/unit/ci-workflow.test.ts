import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CI workflow", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

  it("loads the production MV3 extension in Chromium", () => {
    expect(workflow).toContain(
      "playwright test --project=smoke tests/e2e/smoke/extension-load.test.ts",
    );
    expect(workflow).toContain("playwright install --with-deps chromium");
  });

  it("scans the complete history of the history-less public repository", () => {
    const releaseDocumentation = readFileSync("docs/ci-cd.md", "utf8");

    expect(existsSync(".sensitive-data-history-baseline")).toBe(false);
    expect(releaseDocumentation).toContain(
      "scans the complete history of the public repository",
    );
  });
});
