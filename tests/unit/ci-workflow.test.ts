import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("CI workflow", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

  it("uses the package manager version declared by the project", () => {
    const packageManager = JSON.parse(readFileSync("package.json", "utf8"))
      .packageManager as string;
    const declaredVersion = /^pnpm@(\d+\.\d+\.\d+)/.exec(packageManager)?.[1];
    expect(declaredVersion).toBeDefined();

    for (const path of [".github/workflows/ci.yml", ".github/workflows/release.yml"]) {
      const jobs = Object.values(
        parse(readFileSync(path, "utf8")).jobs as Record<
          string,
          { steps?: Array<{ uses?: string; with?: { version?: unknown } }> }
        >,
      );
      const pnpmSetups = jobs
        .flatMap((job) => job.steps ?? [])
        .filter((step) => step.uses?.startsWith("pnpm/action-setup"));

      expect(pnpmSetups.length, path).toBeGreaterThan(0);
      for (const step of pnpmSetups) {
        // pnpm/action-setup fails when `version` and `packageManager` disagree.
        if (step.with?.version !== undefined) {
          expect(String(step.with.version), path).toBe(declaredVersion);
        }
      }
    }

    const gitlabPins = readFileSync(".gitlab-ci.yml", "utf8").match(
      /corepack prepare pnpm@[^\s]+/g,
    );
    for (const pin of gitlabPins ?? []) {
      expect(pin).toBe(`corepack prepare pnpm@${declaredVersion}`);
    }
  });

  it("runs GitLab security scans alongside verification and keeps browser failure reports", () => {
    const config = parse(readFileSync(".gitlab-ci.yml", "utf8"));
    expect(config.osv_dependency_scan.needs).toEqual([]);
    expect(config.semgrep_sast.needs).toEqual([]);
    expect(config.verify.script).toContain("pnpm test:e2e --workers=1");
    expect(config.verify.artifacts.when).toBe("on_failure");
    expect(config.verify.artifacts.paths).toContain("playwright-report/");
  });

  it("produces a browser report on CI failures", () => {
    const config = readFileSync("playwright.config.ts", "utf8");
    expect(config).toContain('process.env.CI ? [["list"], ["html", { open: "never" }]]');
  });

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
