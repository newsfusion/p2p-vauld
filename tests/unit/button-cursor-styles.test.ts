import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

function readCss(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf-8");
}

function expectButtonCursorRules(relativePath: string): void {
  const css = readCss(relativePath);

  expect(css).toMatch(
    /:where\(\s*button,\s*\[role='button'\],\s*input\[type='button'\],\s*input\[type='submit'\],\s*input\[type='reset'\]\s*\):not\(:disabled\):not\(\[aria-disabled='true'\]\)\s*\{\s*cursor:\s*pointer;\s*\}/s,
  );

  expect(css).toMatch(
    /:where\(\s*button,\s*\[role='button'\],\s*input\[type='button'\],\s*input\[type='submit'\],\s*input\[type='reset'\]\s*\):is\(:disabled,\s*\[aria-disabled='true'\]\)\s*\{\s*cursor:\s*not-allowed;\s*\}/s,
  );
}

describe("button cursor styles", () => {
  it("defines active and disabled button cursors in the dashboard stylesheet", () => {
    expectButtonCursorRules("src/dashboard/dashboard.css");
  });

  it("defines active and disabled button cursors in the popup stylesheet", () => {
    expectButtonCursorRules("src/popup/popup.css");
  });
});
