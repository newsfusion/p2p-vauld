import type {
  LearnedLoginSelectorMap,
  LoginFieldRole,
} from "../shared/types/index.js";
import { isUsableFormElement } from "./visibility.js";

const LOGIN_ROLES = ["username", "password", "submit", "otp"] as const;

function escapeIdent(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (input: string) => string } })
    .CSS;
  if (css?.escape) return css.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function escapeAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function attrSelector(tag: string, attr: string, value: string): string {
  return `${tag}[${attr}="${escapeAttr(value)}"]`;
}

function containsAttrSelector(tag: string, attr: string, value: string): string {
  return `${tag}[${attr}*="${escapeAttr(value)}"]`;
}

function isUniqueVisibleSelector(
  selector: string,
  root: ParentNode = document,
): boolean {
  try {
    const matches = Array.from(root.querySelectorAll(selector));
    const match = matches[0];
    return matches.length === 1 && match !== undefined && isUsableFormElement(match);
  } catch {
    return false;
  }
}

function nthOfTypeSelector(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const parent = el.parentElement;
  if (!parent) return tag;

  const siblings = Array.from(parent.children).filter(
    (child) => child.tagName.toLowerCase() === tag,
  );
  const index = siblings.indexOf(el) + 1;
  return `${tag}:nth-of-type(${Math.max(index, 1)})`;
}

function scopedPathSelector(el: Element): string | undefined {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.body && parts.length < 4) {
    const tag = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`${tag}#${escapeIdent(current.id)}`);
      break;
    }
    parts.unshift(nthOfTypeSelector(current));
    current = current.parentElement;
  }

  if (parts.length === 0) return undefined;
  return parts.join(" > ");
}

export function generateStableLoginSelector(
  el: Element,
  root: ParentNode = document,
): string | undefined {
  if (!isUsableFormElement(el)) return undefined;

  const tag = el.tagName.toLowerCase();
  const candidates: string[] = [];
  const id = el.getAttribute("id");
  const name = el.getAttribute("name");
  const autocomplete = el.getAttribute("autocomplete");
  const type = el.getAttribute("type");
  const placeholder = el.getAttribute("placeholder");
  const ariaLabel = el.getAttribute("aria-label");

  if (id) candidates.push(`${tag}#${escapeIdent(id)}`);
  if (name) candidates.push(attrSelector(tag, "name", name));
  if (autocomplete) {
    candidates.push(attrSelector(tag, "autocomplete", autocomplete));
  }
  if (type && placeholder) {
    candidates.push(
      `${attrSelector(tag, "type", type)}[placeholder*="${escapeAttr(placeholder)}"]`,
    );
  }
  if (ariaLabel) candidates.push(containsAttrSelector(tag, "aria-label", ariaLabel));
  if (type) candidates.push(attrSelector(tag, "type", type));

  const scoped = scopedPathSelector(el);
  if (scoped) candidates.push(scoped);

  for (const selector of candidates) {
    if (selector.includes("data-p2p-field")) continue;
    if (isUniqueVisibleSelector(selector, root)) return selector;
  }

  return undefined;
}

export function generateStableLoginSelectors(
  elements: Partial<Record<LoginFieldRole, Element | null | undefined>>,
  root: ParentNode = document,
): LearnedLoginSelectorMap {
  const selectors: LearnedLoginSelectorMap = {};
  for (const role of LOGIN_ROLES) {
    const el = elements[role];
    if (!el) continue;
    const selector = generateStableLoginSelector(el, root);
    if (selector) selectors[role] = selector;
  }
  return selectors;
}

export function describeLoginSelectorFingerprint(
  role: LoginFieldRole,
  el: Element,
  selector: string,
): string {
  const tag = el.tagName.toLowerCase();
  const attrs = [
    el.getAttribute("type"),
    el.getAttribute("name"),
    el.getAttribute("autocomplete"),
    el.getAttribute("placeholder"),
    el.getAttribute("aria-label"),
  ]
    .filter(Boolean)
    .join("|");
  return `${role}|${selector}|${tag}|${attrs}`.slice(0, 2000);
}
