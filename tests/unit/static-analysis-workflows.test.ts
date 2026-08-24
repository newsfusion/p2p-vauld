import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { validateGitLabCi } from "../../scripts/validate-gitlab-ci.mjs";

function workflow(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function parsedWorkflow(path: string): Record<string, unknown> {
  return parse(workflow(path)) as Record<string, unknown>;
}

describe("static analysis workflows", () => {
  it("runs CodeQL security-extended with minimal permissions", () => {
    const source = workflow(".github/workflows/codeql.yml");

    expect(source).toContain("javascript-typescript");
    expect(source).toContain("security-extended");
    expect(source).toMatch(/contents:\s*read/);
    expect(source).toMatch(/security-events:\s*write/);
    expect(source).toMatch(/github\/codeql-action\/init@[a-f0-9]{40}/);
    expect(source).toMatch(/github\/codeql-action\/analyze@[a-f0-9]{40}/);
    expect(source).toContain("schedule:");
  });

  it("scans the pnpm lockfile with pinned OSV and blocks vulnerabilities", () => {
    const source = workflow(".github/workflows/osv-scanner.yml");

    expect(source).toMatch(
      /google\/osv-scanner-action\/\.github\/workflows\/osv-scanner-reusable\.yml@[a-f0-9]{40}/,
    );
    expect(source).toMatch(
      /google\/osv-scanner-action\/\.github\/workflows\/osv-scanner-reusable-pr\.yml@[a-f0-9]{40}/,
    );
    expect(source).toContain("--lockfile=pnpm-lock.yaml");
    expect(source).toMatch(/upload-sarif:\s*true/);
    expect(source).not.toMatch(/fail-on-vuln:\s*false/);
    expect(source.match(/fail-on-vuln:\s*true/g)).toHaveLength(2);
    expect(source).toMatch(/security-events:\s*write/);
    expect(source).toContain("schedule:");
  });

  it("provides blocking static analysis for the configured GitLab origin", () => {
    const source = workflow(".gitlab-ci.yml");
    const parsed = parsedWorkflow(".gitlab-ci.yml");

    expect(parsed).toHaveProperty("verify");
    expect(parsed).toHaveProperty("osv_dependency_scan");
    expect(parsed).toHaveProperty("semgrep_sast");
    expect(parsed).toHaveProperty("workflow.rules");
    expect(parsed).not.toHaveProperty("default.rules");
    expect(source).toContain("pnpm-lock.yaml");
    expect(source).toContain("osv-scanner");
    expect(source).toContain("mcr.microsoft.com/playwright:v1.60.0-noble@sha256:");
    expect(source).toContain("git --version");
    expect(source).toContain("scan:sensitive --history");
    expect(source).toContain("pnpm validate:ci:gitlab");
    expect(source).toContain("actionlint_1.7.12_linux_amd64.tar.gz");
    expect(source).toContain("actionlint_1.7.12_linux_arm64.tar.gz");
    expect(source).toContain("325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6");
    expect(source).toContain("actionlint -color -shellcheck= -pyflakes=");
    expect(source).toContain("pnpm test");
    expect(source).toContain("pnpm build");
    expect(source).toContain("--built");
    expect(source).toContain("tests/e2e/smoke/extension-load.test.ts");
    expect(source).toContain("semgrep scan");
    expect(source).toContain("--config .semgrep.yml");
    expect(source).toContain("--error");
    expect(source).toContain("--exclude tests");
    expect(source.match(/pnpm install --frozen-lockfile/g)).toHaveLength(1);
    expect(source.match(/@sha256:[a-f0-9]{64}/g)).toHaveLength(3);
    expect(Object.keys(parsed).sort()).toEqual([
      "default",
      "osv_dependency_scan",
      "semgrep_sast",
      "stages",
      "verify",
      "workflow",
    ]);
    expect(parsed).toMatchObject({
      stages: ["verify", "security"],
      verify: {
        stage: "verify",
        variables: { GIT_DEPTH: "0" },
        script: expect.arrayContaining([
          "git --version",
          "pnpm scan:sensitive --history",
          "pnpm lint",
          "pnpm typecheck",
          "pnpm test",
          "pnpm build",
        ]),
      },
      osv_dependency_scan: {
        stage: "security",
        before_script: [],
        cache: [],
        script: ["/root/osv-scanner scan -L pnpm-lock.yaml"],
      },
      semgrep_sast: {
        stage: "security",
        before_script: [],
        cache: [],
      },
    });
  });

  it("uses repository-owned Semgrep rules for extension security invariants", () => {
    const config = parsedWorkflow(".semgrep.yml") as { rules?: Array<{ id?: string }> };
    const ruleIds = config.rules?.map((rule) => rule.id);

    expect(ruleIds).toEqual(
      expect.arrayContaining([
        "no-dynamic-code-execution",
        "no-chrome-storage-sync",
        "no-unsanitized-html-sinks",
        "no-shell-command-execution",
      ]),
    );
  });

  it("pins the official GitLab schema used by the CI validator", () => {
    const validator = workflow("scripts/validate-gitlab-ci.mjs");
    const packageJson = workflow("package.json");

    expect(packageJson).toContain('"validate:ci:gitlab": "node scripts/validate-gitlab-ci.mjs"');
    expect(validator).toContain(
      "0ec864ef3ca657bdb27bab6e429f2b445f05f6f5/app/assets/javascripts/editor/schema/ci.json",
    );
    expect(validator).toContain("new Ajv");
    expect(validator).toContain('parse(readFileSync(".gitlab-ci.yml", "utf8"))');
  });

  it("rejects GitLab CI data that violates its schema", () => {
    expect(() =>
      validateGitLabCi(
        { stages: "verify" },
        {
          type: "object",
          required: ["stages"],
          properties: { stages: { type: "array", items: { type: "string" } } },
        },
      ),
    ).toThrow("Invalid GitLab CI configuration");
  });

  it("parses every static-analysis workflow as YAML", () => {
    expect(parsedWorkflow(".github/workflows/codeql.yml")).toMatchObject({
      permissions: { contents: "read" },
      jobs: {
        analyze: {
          permissions: { contents: "read", "security-events": "write" },
          "runs-on": "ubuntu-latest",
        },
      },
    });
    expect(parsedWorkflow(".github/workflows/osv-scanner.yml")).toMatchObject({
      permissions: { contents: "read" },
      jobs: {
        "scan-pr": { with: { "fail-on-vuln": true } },
        "scan-full": { with: { "fail-on-vuln": true } },
      },
    });
    expect(parsedWorkflow(".gitlab-ci.yml")).toHaveProperty("stages");
  });

  it("validates the source manifest before installing Chromium", () => {
    const source = workflow(".github/workflows/ci.yml");

    expect(source.indexOf("Validate source manifest")).toBeGreaterThan(-1);
    expect(source.indexOf("Validate source manifest")).toBeLessThan(
      source.indexOf("Install Chromium"),
    );
  });
});
