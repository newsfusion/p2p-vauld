import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getVisibleTextTree,
  textTreeToString,
  countTextNodes,
  type TextTreeNode,
} from "../../src/content/text-tree.js";
import {
  getFixtureFilename,
  loadFixtureHtml,
} from "./helpers/test-helpers.js";
import type { PlatformId } from "../../src/shared/types/index.js";

beforeEach(() => {
  vi.stubGlobal("chrome", {
    runtime: { sendMessage: vi.fn() },
    storage: { local: { get: vi.fn(), set: vi.fn() } },
  });
});

describe("getVisibleTextTree", () => {
  function parse(html: string): Document {
    return new DOMParser().parseFromString(html, "text/html");
  }

  it("extracts text from simple HTML", () => {
    const doc = parse("<div>Hello <span>World</span></div>");
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toEqual(["Hello", "World"]);
  });

  it("normalizes multiple whitespaces to a single space", () => {
    const doc = parse("<div>Hello   \n\t  World</div>");
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toBe("Hello World");
  });

  it("filters out SCRIPT tags", () => {
    const doc = parse(
      '<div>Hello<script>alert("x")</script> World</div>',
    );
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toEqual(["Hello", "World"]);
  });

  it("filters out STYLE tags", () => {
    const doc = parse(
      "<div>Hello<style>.x{color:red}</style> World</div>",
    );
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toEqual(["Hello", "World"]);
  });

  it("filters out NOSCRIPT tags", () => {
    const doc = parse("<div>Hello<noscript>no js</noscript> World</div>");
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toEqual(["Hello", "World"]);
  });

  it("filters out TEMPLATE tags", () => {
    const doc = parse(
      "<div>Hello<template><p>template content</p></template> World</div>",
    );
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toEqual(["Hello", "World"]);
  });

  it("filters out IFRAME tags", () => {
    const doc = parse(
      '<div>Hello<iframe src="about:blank"></iframe> World</div>',
    );
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toEqual(["Hello", "World"]);
  });

  it("returns null for empty elements", () => {
    const doc = parse("<div></div>");
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toBeNull();
  });

  it("flattens single-child arrays", () => {
    const doc = parse("<div><p>Only child</p></div>");
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toBe("Only child");
  });

  it("handles nested structures", () => {
    const doc = parse(
      "<div><h1>Title</h1><p>Content <strong>bold</strong></p></div>",
    );
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toEqual(["Title", ["Content", "bold"]]);
  });

  it("skips elements with aria-hidden=true when visibility checks are on", () => {
    const doc = parse(
      '<div>Visible<span aria-hidden="true">Hidden</span></div>',
    );
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: false });
    expect(tree).toBe("Visible");
  });

  it("skips elements with hidden attribute when visibility checks are on", () => {
    const doc = parse("<div>Visible<span hidden>Hidden</span></div>");
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: false });
    expect(tree).toBe("Visible");
  });

  it("includes aria-hidden elements when skipVisibilityCheck is true", () => {
    const doc = parse(
      '<div>Visible<span aria-hidden="true">Hidden</span></div>',
    );
    const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });
    expect(tree).toEqual(["Visible", "Hidden"]);
  });
});

describe("textTreeToString", () => {
  it("serializes a simple tree", () => {
    const tree: TextTreeNode = ["Hello", "World"];
    const result = textTreeToString(tree);
    expect(result.json).toBe('["Hello","World"]');
    expect(result.truncated).toBe(false);
    expect(result.textNodeCount).toBe(2);
  });

  it("returns full JSON when under maxLength", () => {
    const tree: TextTreeNode = "short";
    const result = textTreeToString(tree);
    expect(result.json).toBe('"short"');
    expect(result.truncated).toBe(false);
  });

  it("handles null", () => {
    const result = textTreeToString(null);
    expect(result.json).toBe("null");
    expect(result.truncated).toBe(false);
    expect(result.textNodeCount).toBe(0);
  });

  it("stays under maxLength and flags truncation", () => {
    const tree: TextTreeNode = ["Hello", "World", "This is a longer text"];
    const result = textTreeToString(tree, 20);
    expect(result.json.length).toBeLessThanOrEqual(20);
    expect(result.truncated).toBe(true);
  });

  it("emits valid JSON above the limit — never a mid-structure slice", () => {
    const tree: TextTreeNode = Array.from({ length: 400 }, (_, i) => [
      `Some fairly long marketing sentence number ${i} about lending`,
      `Row label ${i}`,
    ]);
    const result = textTreeToString(tree, 500);
    expect(result.truncated).toBe(true);
    expect(result.json.length).toBeLessThanOrEqual(500);
    expect(() => JSON.parse(result.json)).not.toThrow();
  });

  it("reports the node count of the tree that was actually serialized", () => {
    const tree: TextTreeNode = Array.from(
      { length: 200 },
      (_, i) => `Filler paragraph ${i} with a good amount of prose text in it`,
    );
    const result = textTreeToString(tree, 400);
    expect(result.truncated).toBe(true);
    expect(countTextNodes(JSON.parse(result.json) as TextTreeNode)).toBe(
      result.textNodeCount,
    );
    expect(result.textNodeCount).toBeLessThan(200);
  });

  it("keeps currency subtrees and drops keyword-free navigation", () => {
    const filler = Array.from({ length: 60 }, (_, i) => [
      `Legal notice paragraph ${i}`,
      `Read our terms and conditions carefully before proceeding, part ${i}`,
    ]);
    const tree: TextTreeNode = [
      ["Home", "About us", "Careers", "Press"],
      ...filler,
      ["Account value", "€12.345,67"],
    ];
    const result = textTreeToString(tree, 900);

    expect(result.truncated).toBe(true);
    expect(result.json).toContain("Account value");
    expect(result.json).toContain("12.345,67");
    expect(result.json).not.toContain("Careers");
  });

  it("keeps the label sibling of a relevant value", () => {
    const filler = Array.from({ length: 60 }, (_, i) => [
      `Marketing blurb ${i}`,
      `A long sentence of promotional copy that carries no figures at all ${i}`,
    ]);
    const tree: TextTreeNode = [
      ...filler,
      ["Verfügbare Mittel", "€807,83"],
    ];
    const result = textTreeToString(tree, 800);

    // The label carries no digits itself — it survives because its sibling does.
    expect(result.json).toContain("Verfügbare Mittel");
    expect(result.json).toContain("807,83");
  });

  it("prefers the document tail when everything is relevant", () => {
    const tree: TextTreeNode = Array.from(
      { length: 300 },
      (_, i) => `Row ${i} value €${i},00 for this position in the ledger`,
    );
    const result = textTreeToString(tree, 600);

    expect(result.truncated).toBe(true);
    expect(() => JSON.parse(result.json)).not.toThrow();
    expect(result.json).toContain("Row 299");
    expect(result.json).not.toContain("Row 0 ");
  });

  it("keeps a usable prefix when a single leaf exceeds the budget", () => {
    const tree: TextTreeNode = ["€12.345,67 " + "9".repeat(5000)];
    const result = textTreeToString(tree, 200);

    expect(result.json.length).toBeLessThanOrEqual(200);
    expect(() => JSON.parse(result.json)).not.toThrow();
    // Must not collapse to "null" — quoting overhead used to make even one
    // clamped leaf unfittable, emptying the tree entirely.
    expect(result.textNodeCount).toBe(1);
    expect(result.json).toContain("12.345,67");
  });

  it("fits a leaf whose escaping inflates the serialized form", () => {
    // Every quote costs two characters once serialized, so a plain
    // slice(0, maxLength) would still overflow the budget.
    const tree: TextTreeNode = ['€12.345,67 ' + '"'.repeat(5000)];
    const result = textTreeToString(tree, 200);

    expect(result.json.length).toBeLessThanOrEqual(200);
    expect(() => JSON.parse(result.json)).not.toThrow();
    expect(result.textNodeCount).toBe(1);
    expect(result.json).toContain("12.345,67");
  });
});

describe("countTextNodes", () => {
  it("counts leaf strings", () => {
    expect(countTextNodes(["Hello", "World"])).toBe(2);
  });

  it("counts nested leaf strings", () => {
    expect(countTextNodes(["A", ["B", "C"], "D"])).toBe(4);
  });

  it("returns 0 for null", () => {
    expect(countTextNodes(null)).toBe(0);
  });

  it("returns 1 for a single string", () => {
    expect(countTextNodes("Hello")).toBe(1);
  });
});

describe("getVisibleTextTree with synthetic platform fixtures", () => {
  const platformsWithDashboard: PlatformId[] = [
    "mintos",
    "debitum",
    "income_marketplace",
    "indemo",
    "peerberry",
    "triple_dragon",
  ];

  platformsWithDashboard.forEach((platformId) => {
    it(`produces a non-empty text tree for ${platformId}`, () => {
      const html = loadFixtureHtml(
        "dashboards",
        getFixtureFilename(platformId),
      );
      const doc = new DOMParser().parseFromString(html, "text/html");
      const tree = getVisibleTextTree(doc.body, { skipVisibilityCheck: true });

      expect(tree).not.toBeNull();
      const nodeCount = countTextNodes(tree);
      expect(nodeCount).toBeGreaterThan(5);

      const serialized = textTreeToString(tree);
      expect(serialized.json.length).toBeGreaterThan(100);
      expect(() => JSON.parse(serialized.json)).not.toThrow();
    });
  });
});
