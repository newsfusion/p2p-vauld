import { isRenderableElement } from "./visibility.js";
import type { DashboardNavStrategy } from "../shared/messages.js";

export interface DashboardLinkClickResult {
  clicked: boolean;
  matchText?: string;
  href?: string;
  navigationKind?: "click" | "assign";
}

interface DashboardLinkCandidate {
  element: HTMLElement;
  text: string;
  score: number;
  href?: string;
}

export interface DashboardLinkClickOptions {
  strategy?: DashboardNavStrategy;
  excludeHrefs?: string[];
}

const TIER1_KEYWORDS = [
  "dashboard",
  "übersicht",
  "overview",
  "kontoübersicht",
  "account overview",
  "portfolio overview",
  "portfolioübersicht",
  "mein portfolio",
  "my portfolio",
] as const;

const TIER2_KEYWORDS = [
  "portfolio",
  "konto",
  "account",
  "mein konto",
  "my account",
  "home",
  "summary",
  "kontostand",
] as const;

/**
 * Position/holdings lists. They are navigation targets of last resort: they show
 * per-loan amounts, not the account totals, so they must lose to any overview or
 * account link. Kept as candidates because on a few platforms they are the only
 * authenticated page that carries a portfolio total.
 */
const TIER3_KEYWORDS = [
  "investments",
  "my investments",
  "meine investitionen",
  "meine anlagen",
] as const;

const TIER1_BASE = 100;
const TIER2_BASE = 60;
const TIER3_BASE = 30;
const EXACT_MATCH_BONUS = 25;
const HREF_PATH_BONUS = 10;
/** Substring matches inside long texts are usually prose, not navigation labels. */
const MAX_SUBSTRING_MATCH_LENGTH = 40;

const EXCLUDED_TEXT_PATTERN =
  /log\s?out|sign\s?out|abmelden|ausloggen|log\s?in|sign\s?in|anmelden|einloggen|register|sign\s?up|registrieren|settings|einstellungen|help|hilfe|support|faq|profil|profile|notification/i;
const EXCLUDED_HREF_PATTERN =
  /logout|sign-?out|abmelden|login|sign-?in|register|sign-?up|settings|help|support|faq|profile/i;
const DASHBOARD_PATH_PATTERN =
  /dashboard|overview|portfolio|uebersicht|konto|account/i;
const LOGO_PATTERN = /logo|brand|home|start/i;

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function candidateText(element: Element): string {
  return (
    normalizeLabel(element.textContent) ||
    normalizeLabel(element.getAttribute("aria-label")) ||
    normalizeLabel(element.getAttribute("title"))
  );
}

function keywordScore(text: string): number {
  let best = 0;
  const tiers: Array<[readonly string[], number]> = [
    [TIER1_KEYWORDS, TIER1_BASE],
    [TIER2_KEYWORDS, TIER2_BASE],
    [TIER3_KEYWORDS, TIER3_BASE],
  ];
  for (const [keywords, base] of tiers) {
    for (const keyword of keywords) {
      if (text === keyword) {
        best = Math.max(best, base + EXACT_MATCH_BONUS);
      } else if (
        text.length <= MAX_SUBSTRING_MATCH_LENGTH &&
        text.includes(keyword)
      ) {
        best = Math.max(best, base);
      }
    }
  }
  return best;
}

function resolveHref(element: Element, doc: Document): URL | null {
  const raw = element.getAttribute("href");
  if (!raw || raw.startsWith("#") || raw.startsWith("javascript:")) return null;
  try {
    return new URL(raw, doc.baseURI);
  } catch {
    return null;
  }
}

function normalizeUrlForVisit(url: URL): string {
  const normalized = new URL(url.href);
  normalized.hash = "";
  return normalized.href;
}

function normalizedExcludeSet(
  excludeHrefs: string[] = [],
  doc: Document,
): Set<string> {
  const excluded = new Set<string>();
  for (const href of excludeHrefs) {
    try {
      excluded.add(normalizeUrlForVisit(new URL(href, doc.baseURI)));
    } catch {
      // Ignore malformed caller-provided entries.
    }
  }
  return excluded;
}

function isExcludedHref(href: URL, excludeHrefs: Set<string>): boolean {
  return (
    EXCLUDED_HREF_PATTERN.test(href.href) ||
    excludeHrefs.has(normalizeUrlForVisit(href))
  );
}

function isSameOriginHref(href: URL, doc: Document): boolean {
  const origin = doc.defaultView?.location.origin;
  return !origin || href.origin === origin;
}

function safeResolvedHref(
  element: Element,
  doc: Document,
  excludeHrefs: Set<string>,
): URL | null {
  const href = resolveHref(element, doc);
  if (!href) return null;
  if (!isSameOriginHref(href, doc)) return null;
  if (isExcludedHref(href, excludeHrefs)) return null;
  return href;
}

export function findDashboardLink(
  doc: Document = document,
  excludeHrefs: string[] = [],
): DashboardLinkCandidate | null {
  const excluded = normalizedExcludeSet(excludeHrefs, doc);
  const elements = doc.querySelectorAll<HTMLElement>(
    'a, [role="link"]',
  );
  let best: DashboardLinkCandidate | null = null;

  for (const element of elements) {
    if (!isRenderableElement(element, { requireEnabled: true })) continue;

    const text = candidateText(element);
    if (!text) continue;
    if (EXCLUDED_TEXT_PATTERN.test(text)) continue;

    const baseScore = keywordScore(text);
    if (baseScore === 0) continue;

    const rawHref = resolveHref(element, doc);
    if (rawHref && (!isSameOriginHref(rawHref, doc) || isExcludedHref(rawHref, excluded))) {
      continue;
    }

    const score =
      baseScore -
      Math.min(text.length, MAX_SUBSTRING_MATCH_LENGTH) / 4 +
      (rawHref && DASHBOARD_PATH_PATTERN.test(rawHref.pathname) ? HREF_PATH_BONUS : 0);

    if (!best || score > best.score) {
      best = {
        element,
        text,
        score,
        ...(rawHref ? { href: rawHref.href } : {}),
      };
    }
  }

  return best;
}

function hasLogoSignal(element: HTMLElement): boolean {
  const label = [
    element.className,
    element.getAttribute("aria-label") ?? "",
    element.getAttribute("title") ?? "",
    ...Array.from(element.querySelectorAll("img, svg")).map((child) =>
      [
        child.getAttribute("alt") ?? "",
        child.getAttribute("aria-label") ?? "",
        child.getAttribute("class") ?? "",
      ].join(" "),
    ),
  ].join(" ");
  return (
    element.querySelector("img, svg") !== null ||
    LOGO_PATTERN.test(label)
  );
}

function pathDepth(url: URL): number {
  return url.pathname.split("/").filter(Boolean).length;
}

export function findLogoLink(
  doc: Document = document,
  excludeHrefs: string[] = [],
): DashboardLinkCandidate | null {
  const excluded = normalizedExcludeSet(excludeHrefs, doc);
  const elements = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'header a[href], nav a[href], [role="banner"] a[href], a[href*="logo" i], a[class*="logo" i], a[aria-label*="logo" i]',
    ),
  );
  const candidates: DashboardLinkCandidate[] = [];

  for (const element of elements) {
    if (!isRenderableElement(element, { requireEnabled: true })) continue;
    if (!hasLogoSignal(element)) continue;
    const text = candidateText(element) || "logo";
    if (EXCLUDED_TEXT_PATTERN.test(text)) continue;
    const href = safeResolvedHref(element, doc, excluded);
    if (!href || pathDepth(href) > 1) continue;
    candidates.push({
      element,
      text,
      href: href.href,
      score: href.pathname === "/" || href.pathname === "" ? 100 : 80,
    });
  }

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return (
      a.element.getBoundingClientRect().top -
      b.element.getBoundingClientRect().top
    );
  });

  return candidates[0] ?? null;
}

export function findFirstNavLink(
  doc: Document = document,
  excludeHrefs: string[] = [],
): DashboardLinkCandidate | null {
  const excluded = normalizedExcludeSet(excludeHrefs, doc);
  const current = doc.defaultView?.location.href;
  const currentNormalized = current
    ? normalizeUrlForVisit(new URL(current, doc.baseURI))
    : "";
  const elements = doc.querySelectorAll<HTMLElement>(
    'nav a[href], header a[href], [role="navigation"] a[href]',
  );

  for (const element of elements) {
    if (!isRenderableElement(element, { requireEnabled: true })) continue;
    const text = candidateText(element);
    if (!text || EXCLUDED_TEXT_PATTERN.test(text)) continue;
    const href = safeResolvedHref(element, doc, excluded);
    if (!href) continue;
    if (normalizeUrlForVisit(href) === currentNormalized) continue;
    return {
      element,
      text,
      href: href.href,
      score: 1,
    };
  }

  return null;
}

function clickCandidate(
  match: DashboardLinkCandidate,
  doc: Document,
): DashboardLinkClickResult {
  const href = resolveHref(match.element, doc);
  const win = doc.defaultView;

  // target="_blank" would open a new tab and abandon the sync tab — navigate
  // in place instead.
  if (
    href &&
    win &&
    match.element.getAttribute("target")?.toLowerCase() === "_blank"
  ) {
    win.location.assign(href.href);
    return {
      clicked: true,
      matchText: match.text,
      href: href.href,
      navigationKind: "assign",
    };
  }

  match.element.click();
  return {
    clicked: true,
    matchText: match.text,
    ...(href ? { href: href.href } : {}),
    navigationKind: "click",
  };
}

export function clickDashboardLink(
  doc: Document = document,
  options: DashboardLinkClickOptions = {},
): DashboardLinkClickResult {
  const strategy = options.strategy ?? "keywords";
  const match =
    strategy === "logo"
      ? findLogoLink(doc, options.excludeHrefs)
      : strategy === "first-nav"
        ? findFirstNavLink(doc, options.excludeHrefs)
        : findDashboardLink(doc, options.excludeHrefs);
  if (!match) return { clicked: false };

  return clickCandidate(match, doc);
}
