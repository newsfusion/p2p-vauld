import { beforeEach, describe, expect, it } from "vitest";
import { getVisibleTextTree } from "../../src/content/text-tree.js";

describe("text tree visibility", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("includes background-tab text without requiring layout rects", () => {
    document.body.innerHTML = `
      <div id="visible">Portfolio Value</div>
      <div id="hidden" style="display: none">Hidden text</div>
    `;

    const tree = getVisibleTextTree(document.body);
    const serialized = JSON.stringify(tree);

    expect(serialized).toContain("Portfolio Value");
    expect(serialized).not.toContain("Hidden text");
  });
});
