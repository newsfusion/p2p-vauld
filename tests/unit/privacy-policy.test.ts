import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("published privacy policy", () => {
  it("discloses the extension's local data handling and public contact", () => {
    const policy = readFileSync("docs/site/privacy/index.html", "utf8");

    expect(policy).toContain("Privacy Policy | P2P Vauld");
    expect(policy).toContain("privacy@vauld.de");
    expect(policy).toContain("authentication information");
    expect(policy).toContain("financial data");
    expect(policy).toContain("Debug Mode");
    expect(policy).toContain("Gemini Nano");
    expect(policy).toContain("Chrome Web Store User Data Policy");
    expect(policy).toContain("Limited Use requirements");
    expect(policy).toContain("does not use analytics or tracking");
  });

  it("publishes a one-click policy link through GitHub Pages", () => {
    const homepage = readFileSync("docs/site/index.html", "utf8");
    const workflow = readFileSync(".github/workflows/pages.yml", "utf8");
    const parsedWorkflow = parse(workflow) as {
      jobs: { deploy: { if: string } };
    };
    const deployCondition = parsedWorkflow.jobs.deploy.if;
    const pipeline = readFileSync(".gitlab-ci.yml", "utf8");

    const legacyPolicyUrl = readFileSync("docs/site/privacy-policy.html", "utf8");

    expect(homepage).toContain('href="privacy/"');
    expect(legacyPolicyUrl).toContain('content="0; url=privacy/"');
    expect(legacyPolicyUrl).toContain('href="https://vauld.de/privacy/"');
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("workflows: [CI]");
    expect(deployCondition).toContain("github.event_name == 'workflow_run'");
    expect(deployCondition).toContain("workflow_run.conclusion == 'success'");
    expect(deployCondition).toContain("workflow_run.event == 'push'");
    expect(deployCondition).toContain(
      "workflow_run.head_repository.full_name == github.repository",
    );
    expect(deployCondition).toContain("workflow_run.head_branch == 'main'");
    expect(workflow).toContain("workflow_dispatch:");
    expect(deployCondition).toContain("github.event_name == 'workflow_dispatch'");
    expect(deployCondition).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("pages: write");
    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("name: github-pages");
    expect(workflow).toContain("path: docs/site");
    expect(workflow).toContain(
      "ref: ${{ github.event.workflow_run.head_sha || github.sha }}",
    );
    expect(workflow).toMatch(/actions\/checkout@[a-f0-9]{40}/);
    expect(workflow).toMatch(/actions\/configure-pages@[a-f0-9]{40}/);
    expect(workflow).toMatch(/actions\/upload-pages-artifact@[a-f0-9]{40}/);
    expect(workflow).toMatch(/actions\/deploy-pages@[a-f0-9]{40}/);
    expect(pipeline).not.toContain("create-pages:");
  });
});
