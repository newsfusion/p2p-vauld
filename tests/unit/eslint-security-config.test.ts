import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function lintMessages(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result?.messages ?? [];
}

describe("ESLint extension security rules", () => {
  it(
    "rejects unsanitized DOM injection",
    async () => {
      const messages = await lintMessages(
        "const node = document.createElement('div'); node.innerHTML = location.hash;",
        "src/content/index.ts",
      );

      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: "no-unsanitized/property",
            severity: 2,
          }),
        ]),
      );
    },
    15_000,
  );

  it("rejects cloud-synced extension storage", async () => {
    const messages = await lintMessages(
      "void chrome.storage.sync.get('credentials');",
      "src/content/index.ts",
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "no-restricted-syntax", severity: 2 }),
      ]),
    );
  });

  it("rejects computed and destructured cloud-synced storage", async () => {
    const messages = await lintMessages(
      "void chrome['storage']['sync'].get('credentials'); const { sync } = chrome.storage; void sync;",
      "src/content/index.ts",
    );

    expect(
      messages.filter((message) => message.ruleId === "no-restricted-syntax"),
    ).toHaveLength(2);
  });

  it("rejects aliases that could hide cloud-synced storage", async () => {
    const messages = await lintMessages(
      "const storageApi = chrome.storage; void storageApi; const browserApi = chrome; void browserApi; const { storage } = chrome; void storage;",
      "src/content/index.ts",
    );

    expect(
      messages.filter((message) => message.ruleId === "no-restricted-syntax"),
    ).toHaveLength(3);
  });

  it("rejects direct database access from the service worker", async () => {
    const messages = await lintMessages(
      'import "../shared/db/index.js";',
      "src/background/index.ts",
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "no-restricted-imports", severity: 2 }),
      ]),
    );
  });

  it("rejects new native IndexedDB access from the service worker", async () => {
    const messages = await lintMessages(
      'indexedDB.open("extension-data");',
      "src/background/index.ts",
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ruleId: "no-restricted-globals", severity: 2 }),
      ]),
    );
  });

  it("reports unhandled promises in extension source", async () => {
    const messages = await lintMessages(
      "async function refresh() {} refresh();",
      "src/content/index.ts",
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: "@typescript-eslint/no-floating-promises",
          severity: 1,
        }),
      ]),
    );
  });
});
