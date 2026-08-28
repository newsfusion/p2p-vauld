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

  it("builds the preview before running browser tests", () => {
    const buildPosition = workflow.indexOf("pnpm build");
    const e2ePosition = workflow.indexOf("pnpm test:e2e --workers=1");

    expect(buildPosition).toBeGreaterThan(-1);
    expect(e2ePosition).toBeGreaterThan(-1);
    expect(buildPosition).toBeLessThan(e2ePosition);
  });

  it("scans the complete history of the history-less public repository", () => {
    const releaseDocumentation = readFileSync("docs/ci-cd.md", "utf8");

    expect(existsSync(".sensitive-data-history-baseline")).toBe(false);
    expect(releaseDocumentation).toContain(
      "scans the complete history of the public repository",
    );
  });

  it("documents GitHub as the primary repository", () => {
    const releaseDocumentation = readFileSync("docs/ci-cd.md", "utf8");

    expect(releaseDocumentation).not.toContain("GitHub mirror");
  });
});
