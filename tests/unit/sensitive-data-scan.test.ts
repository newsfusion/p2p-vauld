import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type SensitiveDataScannerModule = {
  scanText: (
    input: {
      path: string;
      text: string;
    },
    options?: { allowSyntheticFixtures?: boolean },
  ) => Array<{ ruleId: string; path: string; excerpt: string }>;
};

let scanner: SensitiveDataScannerModule;

beforeAll(async () => {
  const moduleUrl = pathToFileURL(
    join(process.cwd(), "scripts/sensitive-data-scanner.mjs"),
  ).href;
  scanner = (await import(moduleUrl)) as SensitiveDataScannerModule;
});

describe("sensitive data scanner", () => {
  it("does not flag a capture path without scoped sensitive data", () => {
    const findings = scanner.scanText({
      path: "p2p-testdata/Estateguru.html",
      text: "<!doctype html><html><body>Portfolio overview</body></html>",
    });

    expect(findings).toEqual([]);
  });

  it("only detects email, IBAN, and financial values from account data", () => {
    const email = "investor" + "piet" + "@" + "mailbox.org";
    const phone = "+4915" + "151035555";
    const dobField = "date" + "OfBirth";
    const dobValue = "1984" + "-04" + "-16";
    const iban = "PL67" + "109028510000000145029328";
    const balance = "1000" + " Euro";
    const findings = scanner.scanText({
      path: "p2p-testdata/Estateguru.html",
      text: `
        <script>
          window.__STATE__ = {
            username: "${email}",
            fullAddress: "Dorener Weg, 17",
            phoneNumber: "${phone}",
            ${dobField}: "${dobValue}",
            iban: "${iban}",
            balance: "${balance}"
          };
        </script>
      `,
    });

    expect(findings.map((finding) => finding.ruleId)).toEqual([
      "email-address",
      "iban",
      "financial-amount",
    ]);
  });

  it("allows the Peter Mustermann synthetic placeholder", () => {
    const placeholder = "Peter " + "Mustermann";

    const findings = scanner.scanText({
      path: "tests/fixtures/platform-html-bundle.js",
      text: `<p>${placeholder}</p>`,
    });

    expect(findings).toEqual([]);
  });

  it("allows example.org email placeholders", () => {
    const findings = scanner.scanText({
      path: "docs/example.md",
      text: `Sign in as borrower${"@"}example.org`,
    });

    expect(findings).toEqual([]);
  });

  it("allows the conventional you@email.com placeholder", () => {
    const findings = scanner.scanText({
      path: "src/ui/translations.ts",
      text: `usernameEmailPlaceholder: "you${"@"}email.com"`,
    });

    expect(findings).toEqual([]);
  });

  it("allows the published project privacy contact", () => {
    const findings = scanner.scanText({
      path: "docs/site/privacy-policy.html",
      text: `Contact privacy${"@"}vauld.de`,
    });

    expect(findings).toEqual([]);
  });

  it("allows marked synthetic fixture account placeholders", () => {
    const placeholderIban = "DE89" + "370400440532013000";
    const findings = scanner.scanText(
      {
        path: "tests/fixtures/platform-html-bundle.js",
        text: `
          // @p2p-synthetic-fixture
          export const html = "<p>demo.user@example.test</p><p>${placeholderIban}</p>";
        `,
      },
      { allowSyntheticFixtures: true },
    );

    expect(findings).toEqual([]);
  });

  it("allows authentication and KYC UUID values", () => {
    const uuid = ["8f14e45f", "ceea", "4fcd", "9f8b", "3b2a1c0d9e8f"].join(
      "-",
    );

    const findings = scanner.scanText({
      path: "tests/fixtures/dashboards/auth-state.html",
      text: `<script>window.__SESSION__ = { authToken: "${uuid}" };</script>`,
    });

    expect(findings).toEqual([]);

    const publicIdFindings = scanner.scanText({
      path: "docs/example-public-id.md",
      text: `Public documentation example id: ${uuid}`,
    });

    expect(publicIdFindings).toEqual([]);
  });

  it("allows KYC schema field names without personal values", () => {
    const findings = scanner.scanText({
      path: "src/shared/account-schema.ts",
      text: `export const fields = ["onfidoApplicantId", "dateOfBirth"];`,
    });

    expect(findings).toEqual([]);
  });

  it("allows a concrete Onfido applicant UUID", () => {
    const field = "onfido" + "ApplicantId";
    const uuid = ["8f14e45f", "ceea", "4fcd", "9f8b", "3b2a1c0d9e8f"].join(
      "-",
    );

    const findings = scanner.scanText({
      path: "tests/fixtures/dashboards/kyc-state.html",
      text: `<script>window.__KYC__ = { ${field}: "${uuid}" };</script>`,
    });

    expect(findings).toEqual([]);
  });

  it("detects concrete password values but allows password field names", () => {
    const field = "pass" + "word";
    const value = "R3al-Credential!";

    const findings = scanner.scanText({
      path: "captures/account.json",
      text: JSON.stringify({ [field]: value }),
    });
    const schemaFindings = scanner.scanText({
      path: "src/shared/schema.ts",
      text: `export const fields = ["password", "passwordSelectors"];`,
    });
    const labelFindings = scanner.scanText({
      path: "captures/translations.json",
      text: JSON.stringify({ [field]: "Enter password" }),
    });

    expect(findings.map((finding) => finding.ruleId)).toEqual(["password"]);
    expect(schemaFindings).toEqual([]);
    expect(labelFindings).toEqual([]);
  });

  it("detects common Euro amount formats outside tests and docs", () => {
    const findings = scanner.scanText({
      path: "captures/account.json",
      text: ["1000" + " Euro", "1.000,00" + " €", "EUR " + "2,500.00"].join(
        " | ",
      ),
    });
    const testFindings = scanner.scanText({
      path: "template-electron/tests/fixtures/dashboard.html",
      text: `const expected = "1000 Euro";`,
    });
    const sourceFindings = scanner.scanText({
      path: "src/content/ai-extractor.ts",
      text: `const example = "1000 Euro";`,
    });

    expect(findings.map((finding) => finding.ruleId)).toEqual([
      "financial-amount",
      "financial-amount",
      "financial-amount",
    ]);
    expect(testFindings).toEqual([]);
    expect(sourceFindings).toEqual([]);
  });

  it("does not read an embedded Eur prefix as a financial amount", () => {
    const findings = scanner.scanText({
      path: "captures/page.html",
      text: "base64:iThE34N5+Ngs7xMMsxUTaX6/Eur9+8jl1UeaE9hY",
    });

    expect(findings).toEqual([]);
  });

  it("allows KYC schema field names in git history", () => {
    const repository = mkdtempSync(join(tmpdir(), "p2p-sensitive-scan-"));
    const scannerPath = join(
      process.cwd(),
      "scripts/sensitive-data-scanner.mjs",
    );

    try {
      execFileSync("git", ["init", "-q"], { cwd: repository });
      execFileSync("git", ["config", "user.email", "test@example.test"], {
        cwd: repository,
      });
      execFileSync("git", ["config", "user.name", "Test User"], {
        cwd: repository,
      });
      writeFileSync(
        join(repository, "account-schema.ts"),
        `export const fields = ["onfidoApplicantId", "dateOfBirth"];`,
      );
      execFileSync("git", ["add", "account-schema.ts"], { cwd: repository });
      execFileSync("git", ["commit", "-qm", "add account schema"], {
        cwd: repository,
      });

      expect(() =>
        execFileSync(process.execPath, [scannerPath, "--history"], {
          cwd: repository,
          encoding: "utf8",
          stdio: "pipe",
        }),
      ).not.toThrow();
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("ignores public dependency metadata in pnpm lockfiles", () => {
    const repository = mkdtempSync(join(tmpdir(), "p2p-sensitive-scan-"));
    const scannerPath = join(
      process.cwd(),
      "scripts/sensitive-data-scanner.mjs",
    );

    try {
      execFileSync("git", ["init", "-q"], { cwd: repository });
      writeFileSync(
        join(repository, "pnpm-lock.yaml"),
        `maintainer: dependency-author${"@"}package.example`,
      );
      execFileSync("git", ["add", "pnpm-lock.yaml"], { cwd: repository });

      expect(() =>
        execFileSync(process.execPath, [scannerPath], {
          cwd: repository,
          encoding: "utf8",
          stdio: "pipe",
        }),
      ).not.toThrow();
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("allows KYC and birth-date values remaining in git history", () => {
    const repository = mkdtempSync(join(tmpdir(), "p2p-sensitive-scan-"));
    const scannerPath = join(
      process.cwd(),
      "scripts/sensitive-data-scanner.mjs",
    );
    const field = "onfido" + "ApplicantId";
    const dateField = "date" + "OfBirth";
    const uuid = ["8f14e45f", "ceea", "4fcd", "9f8b", "3b2a1c0d9e8f"].join(
      "-",
    );

    try {
      execFileSync("git", ["init", "-q"], { cwd: repository });
      execFileSync("git", ["config", "user.email", "test@example.test"], {
        cwd: repository,
      });
      execFileSync("git", ["config", "user.name", "Test User"], {
        cwd: repository,
      });
      writeFileSync(
        join(repository, "account-state.json"),
        JSON.stringify({ [field]: uuid, [dateField]: "1984-04-16" }),
      );
      execFileSync("git", ["add", "account-state.json"], { cwd: repository });
      execFileSync("git", ["commit", "-qm", "add account state"], {
        cwd: repository,
      });
      writeFileSync(join(repository, "account-state.json"), "{}");
      execFileSync("git", ["commit", "-qam", "remove account state"], {
        cwd: repository,
      });

      const result = spawnSync(process.execPath, [scannerPath, "--history"], {
        cwd: repository,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("reports each sensitive category once per historical path", () => {
    const repository = mkdtempSync(join(tmpdir(), "p2p-sensitive-scan-"));
    const scannerPath = join(
      process.cwd(),
      "scripts/sensitive-data-scanner.mjs",
    );

    try {
      execFileSync("git", ["init", "-q"], { cwd: repository });
      execFileSync("git", ["config", "user.email", "test@example.test"], {
        cwd: repository,
      });
      execFileSync("git", ["config", "user.name", "Test User"], {
        cwd: repository,
      });
      writeFileSync(
        join(repository, "account-state.json"),
        JSON.stringify({
          first: "1000" + " Euro",
          padding: "x".repeat(200),
          second: "2000" + " Euro",
        }),
      );
      execFileSync("git", ["add", "account-state.json"], { cwd: repository });
      execFileSync("git", ["commit", "-qm", "add financial state"], {
        cwd: repository,
      });
      writeFileSync(join(repository, "account-state.json"), "{}");
      execFileSync("git", ["commit", "-qam", "remove financial state"], {
        cwd: repository,
      });

      const result = spawnSync(process.execPath, [scannerPath, "--history"], {
        cwd: repository,
        encoding: "utf8",
      });
      const matches = result.stderr.match(/history-financial-amount/g) ?? [];

      expect(result.status).toBe(1);
      expect(matches).toHaveLength(1);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("accepts audited history before a baseline and still rejects new sensitive commits", () => {
    const repository = mkdtempSync(join(tmpdir(), "p2p-sensitive-scan-"));
    const scannerPath = join(
      process.cwd(),
      "scripts/sensitive-data-scanner.mjs",
    );

    try {
      execFileSync("git", ["init", "-q"], { cwd: repository });
      execFileSync("git", ["config", "user.email", "test@example.test"], {
        cwd: repository,
      });
      execFileSync("git", ["config", "user.name", "Test User"], {
        cwd: repository,
      });
      writeFileSync(
        join(repository, "legacy-capture.html"),
        `Investor: legacy${"@"}mailbox.org`,
      );
      execFileSync("git", ["add", "legacy-capture.html"], { cwd: repository });
      execFileSync("git", ["commit", "-qm", "legacy capture"], {
        cwd: repository,
      });
      execFileSync("git", ["rm", "-q", "legacy-capture.html"], {
        cwd: repository,
      });
      execFileSync("git", ["commit", "-qm", "remove legacy capture"], {
        cwd: repository,
      });
      const baseline = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repository,
        encoding: "utf8",
      }).trim();
      writeFileSync(
        join(repository, ".sensitive-data-history-baseline"),
        `${baseline}\n`,
      );

      const accepted = spawnSync(process.execPath, [scannerPath, "--history"], {
        cwd: repository,
        encoding: "utf8",
      });
      expect(accepted.status, accepted.stderr).toBe(0);

      writeFileSync(
        join(repository, "new-capture.html"),
        `Investor: new${"@"}mailbox.org`,
      );
      execFileSync("git", ["add", "new-capture.html"], { cwd: repository });
      execFileSync("git", ["commit", "-qm", "new capture"], {
        cwd: repository,
      });

      const rejected = spawnSync(process.execPath, [scannerPath, "--history"], {
        cwd: repository,
        encoding: "utf8",
      });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("history-email-address");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});
