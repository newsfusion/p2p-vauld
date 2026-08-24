/**
 * Visible text tree generator for AI extraction.
 * Recursively builds a JSON-serializable tree of visible text content,
 * filtering out hidden elements, scripts, styles, etc.
 * Runs in content script context (real DOM).
 */

import { AI_ALL_SIGNAL_KEYWORDS } from "../shared/ai/constants.js";
import { isRenderableElement } from "./visibility.js";

/** Signal-agnostic: one tree is fetched per sync run and reused for all signals. */
const PRUNE_KEYWORDS = AI_ALL_SIGNAL_KEYWORDS;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TextTreeNode = string | TextTreeNode[] | null;

export interface TextTreeOptions {
  /** Skip visibility checks (needed for hidden iframes in test panels). */
  skipVisibilityCheck?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const IGNORED_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "IFRAME",
  "SVG",
]);

// ─── Text Tree Builder ──────────────────────────────────────────────────────

export function getVisibleTextTree(
  node: Node,
  options: TextTreeOptions = {},
): TextTreeNode {
  // Text nodes → return trimmed text or null
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeTextContent(node.textContent ?? "");
    return text.length > 0 ? text : null;
  }

  // Only process element nodes
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;

  // Skip ignored tags
  if (IGNORED_TAGS.has(el.tagName)) return null;

  // Skip hidden elements
  if (!options.skipVisibilityCheck) {
    if (!isRenderableElement(el)) {
      return null;
    }
  }

  // Recurse into children
  const children: TextTreeNode[] = [];
  for (const child of node.childNodes) {
    const childTree = getVisibleTextTree(child, options);
    if (childTree !== null) {
      children.push(childTree);
    }
  }

  if (children.length === 0) return null;

  // Flatten single-child arrays
  if (children.length === 1) return children[0]!;

  return children;
}

function normalizeTextContent(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

// ─── Serializer ─────────────────────────────────────────────────────────────

/**
 * Shared prompt budget for every context that feeds a tree to Gemini Nano
 * (content script, sync orchestrator, dashboard extractor panel).
 */
export const TEXT_TREE_MAX_CHARS = 20_000;

export interface SerializedTextTree {
  /** Always syntactically valid JSON, whether or not pruning happened. */
  json: string;
  /** True when nodes were removed to fit the budget. */
  truncated: boolean;
  /** Leaf count of the tree that was actually serialized. */
  textNodeCount: number;
}

const CURRENCY_PATTERN =
  /[€$£¥]|zł|Kč|\bkr\b|\b(?:EUR|USD|GBP|PLN|CZK|SEK|NOK)\b/i;
const DIGIT_PATTERN = /\d/;
/** Bounds the threshold search in the filler-leaf pass. */
const MAX_PRUNE_PROBES = 24;

/**
 * Serializes a tree, pruning whole nodes when it exceeds `maxLength`.
 *
 * The previous implementation sliced the JSON string mid-structure, which
 * handed Gemini syntactically invalid input on every real dashboard. Pruning
 * runs in escalating passes and deliberately favours keeping the end of the
 * document — summary values commonly sit in sidebars and footers.
 */
export function textTreeToString(
  tree: TextTreeNode,
  maxLength: number = TEXT_TREE_MAX_CHARS,
): SerializedTextTree {
  let current = tree;
  let json = serialize(current);
  if (json.length <= maxLength) {
    return { json, truncated: false, textNodeCount: countTextNodes(current) };
  }

  // Pass 1: drop subtrees that contain no numeric, currency or keyword leaf.
  // Whole subtrees rather than leaves, so a label keeps its sibling value.
  current = dropIrrelevantSubtrees(current) ?? current;
  json = serialize(current);
  if (json.length <= maxLength) {
    return { json, truncated: true, textNodeCount: countTextNodes(current) };
  }

  // Pass 2: drop the longest remaining prose leaves (marketing, terms, help).
  current = dropLongFillerLeaves(current, maxLength);
  json = serialize(current);
  if (json.length <= maxLength) {
    return { json, truncated: true, textNodeCount: countTextNodes(current) };
  }

  // Pass 3: last resort — flatten and drop leading leaves, keeping the tail.
  current = keepTrailingLeaves(current, maxLength);
  json = serialize(current);
  return { json, truncated: true, textNodeCount: countTextNodes(current) };
}

function serialize(tree: TextTreeNode): string {
  return JSON.stringify(tree) ?? "null";
}

/** A leaf worth keeping: carries a number, a currency, or a signal keyword. */
function isRelevantText(text: string, keywords: string[]): boolean {
  if (DIGIT_PATTERN.test(text) || CURRENCY_PATTERN.test(text)) return true;
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
}

function containsRelevantLeaf(tree: TextTreeNode, keywords: string[]): boolean {
  if (tree === null) return false;
  if (typeof tree === "string") return isRelevantText(tree, keywords);
  return tree.some((child) => containsRelevantLeaf(child, keywords));
}

function dropIrrelevantSubtrees(
  tree: TextTreeNode,
  keywords: string[] = PRUNE_KEYWORDS,
): TextTreeNode {
  if (tree === null) return null;
  if (typeof tree === "string") return tree;
  if (!containsRelevantLeaf(tree, keywords)) return null;

  const children: TextTreeNode[] = [];
  for (const child of tree) {
    // Direct string children are kept unconditionally — they are the labels
    // that give the sibling values their meaning.
    const kept =
      typeof child === "string" ? child : dropIrrelevantSubtrees(child, keywords);
    if (kept !== null) children.push(kept);
  }
  return collapse(children);
}

function dropLongFillerLeaves(
  tree: TextTreeNode,
  maxLength: number,
  keywords: string[] = PRUNE_KEYWORDS,
): TextTreeNode {
  const lengths = Array.from(
    new Set(
      collectLeaves(tree)
        .filter((leaf) => !isRelevantText(leaf, keywords))
        .map((leaf) => leaf.length),
    ),
  ).sort((a, b) => b - a);
  if (lengths.length === 0) return tree;

  const stride = Math.max(1, Math.ceil(lengths.length / MAX_PRUNE_PROBES));
  let best = tree;
  for (let i = 0; i < lengths.length; i += stride) {
    const threshold = lengths[i]!;
    best = pruneLeaves(
      tree,
      (leaf) => !isRelevantText(leaf, keywords) && leaf.length >= threshold,
    );
    if (serialize(best).length <= maxLength) return best;
  }
  return best;
}

/**
 * Flattens to a leaf list and keeps as many trailing leaves as fit. Structure
 * is already lost at this point; document order and the page tail are not.
 */
function keepTrailingLeaves(tree: TextTreeNode, maxLength: number): TextTreeNode {
  const leaves = collectLeaves(tree).map((leaf) => clampLeaf(leaf, maxLength));
  if (leaves.length === 0) return null;

  let low = 0;
  let high = leaves.length;
  let bestFit: TextTreeNode = null;
  while (low <= high) {
    const keep = Math.floor((low + high) / 2);
    const candidate = collapse(leaves.slice(leaves.length - keep));
    if (serialize(candidate).length <= maxLength) {
      bestFit = candidate;
      low = keep + 1;
    } else {
      high = keep - 1;
    }
  }
  return bestFit;
}

/**
 * Shrinks a single leaf until its *serialized* form fits. Slicing to
 * `maxLength` is not enough: quoting adds two characters and escaping can add
 * many more, which would leave even one leaf unfittable and silently collapse
 * the whole tree to `null`.
 */
function clampLeaf(leaf: string, maxLength: number): string {
  if (serialize(leaf).length <= maxLength) return leaf;
  let end = Math.min(leaf.length, Math.max(0, maxLength - 2));
  while (end > 0 && serialize(leaf.slice(0, end)).length > maxLength) {
    // Escaping overhead is per-character, so back off proportionally.
    end = Math.floor(end * 0.9);
  }
  return leaf.slice(0, end);
}

function pruneLeaves(
  tree: TextTreeNode,
  shouldDrop: (leaf: string) => boolean,
): TextTreeNode {
  if (tree === null) return null;
  if (typeof tree === "string") return shouldDrop(tree) ? null : tree;

  const children: TextTreeNode[] = [];
  for (const child of tree) {
    const kept = pruneLeaves(child, shouldDrop);
    if (kept !== null) children.push(kept);
  }
  return collapse(children);
}

function collectLeaves(tree: TextTreeNode, into: string[] = []): string[] {
  if (tree === null) return into;
  if (typeof tree === "string") {
    into.push(tree);
    return into;
  }
  for (const child of tree) collectLeaves(child, into);
  return into;
}

/** Mirrors the generator's single-child flattening so pruned trees stay compact. */
function collapse(children: TextTreeNode[]): TextTreeNode {
  if (children.length === 0) return null;
  if (children.length === 1) return children[0]!;
  return children;
}

/**
 * Count the number of text leaf nodes in a tree.
 */
export function countTextNodes(tree: TextTreeNode): number {
  if (tree === null) return 0;
  if (typeof tree === "string") return 1;
  let count = 0;
  for (const child of tree) {
    count += countTextNodes(child);
  }
  return count;
}
