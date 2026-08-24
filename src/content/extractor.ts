/**
 * Financial signal extraction using native DOM APIs.
 * Runs inside the P2P platform tab (via content script or executeScript).
 * No external dependencies — must be self-contained in browser context.
 */

import type { FinancialSignalKey, ExtractionCandidate } from '../shared/types/index.js';
import { computeConfidence, countAgreementEvidence } from '../shared/scoring.js';
export { detectCurrency } from '../shared/currency.js';

// ─── Default keywords per signal ─────────────────────────────────────────────

const DEFAULT_KEYWORDS: Record<FinancialSignalKey, string[]> = {
  portfolio_value: [
    'portfolio value',
    'portfolio',
    'kontostand',
    'account balance',
    'kontowert',
    'gesamt',
    'total value',
    'total investments',
    'invested funds',
    'net value',
    'insgesamt investiert',
    'gesamtinvestition',
  ],
  free_cash: [
    'available funds',
    'available cash',
    'available to invest',
    'available for investment',
    'verfügbare mittel',
    'verfügbares guthaben',
    'verfügbar',
    'guthaben',
    'free cash',
    'cash',
    'wallet',
    'uninvested',
  ],
  net_annual_return: [
    'net annual return',
    'net annualised return',
    'annual return',
    'xirr',
    'irr',
    'rendite p.a',
    'jahresrendite',
    'erwartete rendite',
    'expected return',
    'annual yield',
  ],
};

const IGNORED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const CURRENCY_SIGNAL_PATTERN = /[€$£]|zł|Kč|\bkr\.?\b|\b(eur|usd|gbp|pln|czk|sek|nok)\b/i;

/** Detects a magnitude suffix (K/M/Mrd/…) and returns its multiplier, or 1. */
function magnitudeMultiplier(raw: string): number {
  // Must directly follow the numeric part (allow one space) and be terminal —
  // not followed by another letter/digit or a superscript (guards "m²", "kr",
  // currency codes like "CZK", words like "million").
  const match = raw.match(/[0-9]\s*(mrd|mio|m|k)(?![a-z0-9²³])/i);
  if (!match) return 1;
  switch ((match[1] ?? '').toLowerCase()) {
    case 'k':
      return 1e3;
    case 'm':
    case 'mio':
      return 1e6;
    case 'mrd':
      return 1e9;
    default:
      return 1;
  }
}

export function parseLocalizedNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/[0-9]/.test(trimmed)) return null;

  // Accounting-style negatives: "(123,45)" → -123.45
  const isParenNegative = /^\(.*\)$/.test(trimmed) && /[0-9]/.test(trimmed);

  const hasCurrency = CURRENCY_SIGNAL_PATTERN.test(trimmed);
  const hasPercent = /%/.test(trimmed);
  const multiplier = magnitudeMultiplier(trimmed);

  const cleaned = trimmed.replace(/[^0-9,.-]/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (lastComma !== -1 && lastDot !== -1) {
    if (lastDot > lastComma) {
      normalized = cleaned.replace(/,/g, '');
    } else {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (lastComma !== -1) {
    // Single comma is ambiguous. "1,234" is a decimal in de-DE but a thousands
    // separator in en-US. Treat exactly-three trailing digits after a lone comma
    // as a thousands separator only when the value looks like currency (not a
    // percentage), where fractional cents past 2 digits are implausible.
    const trailingDigits = cleaned.length - lastComma - 1;
    if (
      hasCurrency &&
      !hasPercent &&
      trailingDigits === 3 &&
      cleaned.indexOf(',') === lastComma
    ) {
      normalized = cleaned.replace(',', '');
    } else {
      normalized = cleaned.replace(',', '.');
    }
  }

  let value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  value *= multiplier;
  if (isParenNegative && value > 0) value = -value;
  return value;
}

export function detectValueType(text: string): 'currency' | 'percent' | null {
  if (/%/.test(text)) return 'percent';
  if (CURRENCY_SIGNAL_PATTERN.test(text)) return 'currency';
  return null;
}

function expectedValueType(signalKey: FinancialSignalKey): 'currency' | 'percent' {
  return signalKey === 'net_annual_return' ? 'percent' : 'currency';
}

function detectPeriod(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/(monat|month|monthly)/.test(lower)) return 'monthly';
  if (/(jahr|year|yearly|annual)/.test(lower)) return 'yearly';
  if (/(woche|week|weekly)/.test(lower)) return 'weekly';
  if (/(tag|day|daily)/.test(lower)) return 'daily';
  return undefined;
}

const STABLE_SELECTOR_ATTRIBUTES = [
  'data-test',
  'data-testid',
  'data-cy',
  'data-qa',
  'data-p2p-field',
  'aria-label',
  'name',
] as const;

const MAX_SELECTOR_ANCESTORS = 5;

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function nthOfType(el: Element): number {
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === el.tagName) index += 1;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

function stableAttributeSelector(el: Element): string | undefined {
  const tag = el.tagName.toLowerCase();
  for (const attr of STABLE_SELECTOR_ATTRIBUTES) {
    const value = el.getAttribute(attr);
    if (value?.trim()) return `${tag}[${attr}="${cssString(value.trim())}"]`;
  }
  return undefined;
}

function selectorSegmentForElement(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const stableAttr = stableAttributeSelector(el);
  if (stableAttr) return stableAttr;

  const tag = el.tagName.toLowerCase();
  const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
  return `${tag}${classes}:nth-of-type(${nthOfType(el)})`;
}

function cssSelectorForElement(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const directStableAttr = stableAttributeSelector(el);
  if (directStableAttr) return directStableAttr;

  const parts: string[] = [selectorSegmentForElement(el)];
  let current = el.parentElement;
  while (current && !['BODY', 'HTML'].includes(current.tagName) && parts.length < MAX_SELECTOR_ANCESTORS) {
    parts.unshift(selectorSegmentForElement(current));
    if (current.id) break;
    current = current.parentElement;
  }

  return parts.join(' > ');
}

const CONTEXT_ATTRIBUTES = [
  'aria-label',
  'title',
  'href',
  'data-test',
  'data-testid',
  'data-qa',
] as const;

function contextAttributeValue(el: Element, attr: (typeof CONTEXT_ATTRIBUTES)[number]): string {
  const value = el.getAttribute(attr)?.trim();
  if (!value) return '';

  if (attr === 'href') {
    return value
      .replace(/[?#].*$/, '')
      .split('/')
      .filter(Boolean)
      .join(' ');
  }

  return value;
}

function nearbyAttributeContext(el: Element, maxLevels = 4): string {
  const parts: string[] = [];
  let current: Element | null = el;

  for (let level = 0; current && level < maxLevels; level++) {
    for (const attr of CONTEXT_ATTRIBUTES) {
      const value = contextAttributeValue(current, attr);
      if (value && value.length <= 120) parts.push(value);
    }
    current = current.parentElement;
  }

  return normalizeWhitespace([...new Set(parts)].join(' '));
}

function scoreCandidate(input: {
  signalKey: FinancialSignalKey;
  value: number;
  text: string;
  context: string;
  /** Lowercase keywords for this scoring pass. */
  keywords: string[];
  /** Lowercase platform-specific keywords for this scoring pass. */
  platformKeywords?: string[];
  valueType: 'currency' | 'percent' | null;
}): { score: number; keywordHits: number } {
  const lower = `${input.text} ${input.context}`.toLowerCase();
  let score = 0;
  let keywordHits = 0;

  for (const keyword of input.keywords) {
    if (lower.includes(keyword)) {
      score += 1.3;
      keywordHits += 1;
    }
  }
  for (const keyword of input.platformKeywords ?? []) {
    if (lower.includes(keyword)) {
      score += 1.6;
      keywordHits += 1;
    }
  }

  const targetType = expectedValueType(input.signalKey);
  if (input.valueType === targetType) {
    score += 2;
  } else if (input.valueType === null) {
    score -= 0.7;
  } else {
    score -= 2;
  }

  if (targetType === 'currency') {
    if (Math.abs(input.value) < 0.01 && keywordHits === 0) score -= 0.5;
    else if (Math.abs(input.value) > 100) score += 0.4;
  } else {
    if (Math.abs(input.value) > 100) score -= 1.2;

    if (input.signalKey === 'net_annual_return') {
      const hasAnnualHint = /(annual|year|yearly|jahr|jahres|p\.a|pa|xirr|irr)/.test(lower);
      const hasRiskBreakdownHint =
        /(verspätet|delayed|late|days|tage|default|grace|buyback|arrears|risk)/.test(lower);

      if (hasAnnualHint) score += 0.9;
      if (keywordHits === 0 && !hasAnnualHint) score -= 2.5;
      if (hasRiskBreakdownHint) score -= 1.6;
    }
  }

  return { score, keywordHits };
}

function hasExcludedKeyword(text: string, context: string, excludeKeywords: string[]): boolean {
  if (!excludeKeywords.length) return false;
  const lower = `${text} ${context}`.toLowerCase();
  return excludeKeywords.some((keyword) => lower.includes(keyword));
}

function buildExcludeContext(parts: Array<string | null | undefined>): string {
  return normalizeWhitespace(
    parts
      .filter((part): part is string => Boolean(part?.trim()))
      .map((part) => part.trim())
      .join(' ')
  );
}

// ─── Selector-based extraction ────────────────────────────────────────────────

function extractBySelectors(
  selectors: string[],
  signalKey: FinancialSignalKey,
  root: Document | Element,
  keywords: string[],
  platformKeywords: string[] = [],
  platformExcludeKeywords: string[] = [],
): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];
  for (const sel of selectors) {
    let el: Element | null;
    try {
      el = root.querySelector(sel);
    } catch {
      continue; // invalid selector syntax
    }
    if (!el) continue;
    const text = normalizeWhitespace(el.textContent ?? '');
    const value = parseLocalizedNumber(text);
    if (value === null) continue;
    const valueType = detectValueType(text);
    const attributeContext =
      valueType === expectedValueType(signalKey) ? nearbyAttributeContext(el) : '';
    const context = normalizeWhitespace(
      [
        el.getAttribute('aria-label') ?? '',
        attributeContext,
        el.parentElement?.getAttribute('aria-label') ?? '',
        el.previousElementSibling?.textContent ?? '',
        el.parentElement?.textContent ?? '',
      ]
        .filter(Boolean)
        .join(' ')
    );
    const excludeContext = buildExcludeContext([
      el.getAttribute('aria-label'),
      attributeContext,
      el.parentElement?.getAttribute('aria-label'),
      el.previousElementSibling?.textContent,
    ]);
    if (hasExcludedKeyword(text, excludeContext, platformExcludeKeywords)) continue;
    const { score: baseScore, keywordHits } = scoreCandidate({
      signalKey,
      value,
      text,
      context,
      keywords,
      platformKeywords,
      valueType,
    });
    const score = baseScore + 2.5;
    candidates.push({
      selector: sel,
      text,
      value,
      score,
      keywordHits,
      origin: 'selector',
      ...(valueType ? { valueType } : {}),
      ...(context ? { context } : {}),
    });
  }
  return candidates;
}

// ─── Main extraction ──────────────────────────────────────────────────────────

/**
 * Collects financial signal candidates from the current document.
 * Tries CSS selectors first for direct extraction; falls back to heuristic scan.
 */
export function collectFinancialCandidates(
  signalKey: FinancialSignalKey,
  selectors: string[] = [],
  root: Document | Element = document,
  keywordsBySignal: Partial<Record<FinancialSignalKey, string[]>> = {},
  options: {
    selectorOnly?: boolean;
    excludeKeywords?: Partial<Record<FinancialSignalKey, string[]>>;
  } = {},
): { candidates: ExtractionCandidate[]; elementsScanned: number } {
  const keywords = DEFAULT_KEYWORDS[signalKey].map((keyword) => keyword.toLowerCase());
  const platformKeywords = (keywordsBySignal[signalKey] ?? []).map((keyword) =>
    keyword.toLowerCase()
  );
  const platformExcludeKeywords = (options.excludeKeywords?.[signalKey] ?? []).map(
    (keyword) => keyword.toLowerCase()
  );
  const candidates: ExtractionCandidate[] = extractBySelectors(
    selectors,
    signalKey,
    root,
    keywords,
    platformKeywords,
    platformExcludeKeywords,
  );

  if (options.selectorOnly) {
    return {
      candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 30),
      elementsScanned: 0,
    };
  }

  // When root is a cloned <body> element, 'body *' matches nothing — use '*' instead
  const selector = root instanceof Document ? 'body *' : '*';
  const elements = root.querySelectorAll(selector);
  const numericChildrenCountByParent = new WeakMap<Element, number>();
  let elementsScanned = 0;

  const numericChildrenCount = (parent: Element): number => {
    const cached = numericChildrenCountByParent.get(parent);
    if (cached !== undefined) return cached;

    let count = 0;
    for (const child of parent.children) {
      const childText = child.textContent ?? '';
      if (parseLocalizedNumber(childText) !== null) {
        count++;
      }
    }
    numericChildrenCountByParent.set(parent, count);
    return count;
  };

  for (const el of elements) {
    if (elementsScanned >= 6000) break;
    elementsScanned++;

    if (IGNORED_TAGS.has(el.tagName)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue;
    if (el.hasAttribute('hidden')) continue;

    let text: string;
    let fullText: string;

    if (el.children.length === 0) {
      // Standard leaf element
      text = normalizeWhitespace(el.textContent ?? '');
      fullText = text;
    } else if (el.children.length === 1) {
      // Near-leaf: single child is a bare currency symbol, e.g. <div><span>€</span>2 500.00</div>
      const childText = normalizeWhitespace(el.children[0]?.textContent ?? '');
      const childIsCurrencyOnly = /^[\s\u00a0]*[€$£%][\s\u00a0]*$/.test(childText);
      if (!childIsCurrencyOnly) continue;
      // Read only the direct text nodes (the number part)
      text = normalizeWhitespace(
        Array.from(el.childNodes)
          .filter((n) => n.nodeType === 3 /* TEXT_NODE */)
          .map((n) => n.textContent ?? '')
          .join('')
      );
      if (!text) continue;
      fullText = normalizeWhitespace(el.textContent ?? '');
    } else {
      continue;
    }

    if (!text || text.length > 140) continue;

    const value = parseLocalizedNumber(text);
    if (value === null) continue;

    const valueType = detectValueType(fullText || text);
    const attributeContext =
      valueType === expectedValueType(signalKey) ? nearbyAttributeContext(el) : '';
    const parent = el.parentElement;
    const prev = el.previousElementSibling;
    // Include parent's previous sibling to capture "label | value" column layouts
    const parentPrev = parent?.previousElementSibling;

    // Detect if the parent is a "multi-value container" (contains more than one child with a parseable number)
    // to prevent keyword context leaking from sibling elements.
    const shouldIncludeParentText = !parent || numericChildrenCount(parent) <= 1;

    const context = normalizeWhitespace(
      [
        el.getAttribute('aria-label') ?? '',
        attributeContext,
        shouldIncludeParentText ? (parent?.getAttribute('aria-label') ?? '') : '',
        prev?.textContent ?? '',
        shouldIncludeParentText ? (parent?.textContent ?? '') : '',
        (shouldIncludeParentText &&
        parentPrev &&
        (parentPrev.textContent?.length ?? 0) <= 120)
          ? (parentPrev.textContent ?? '')
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
    const excludeContext = buildExcludeContext([
      el.getAttribute('aria-label'),
      attributeContext,
      shouldIncludeParentText ? parent?.getAttribute('aria-label') : '',
      prev?.textContent,
      shouldIncludeParentText ? parent?.textContent : '',
    ]);
    if (hasExcludedKeyword(text, excludeContext, platformExcludeKeywords)) continue;

    const { score, keywordHits } = scoreCandidate({
      signalKey,
      value,
      text,
      context,
      keywords,
      platformKeywords,
      valueType,
    });
    if (score <= 0) continue;

    const selector = cssSelectorForElement(el);
    const period = detectPeriod(`${text} ${context}`);

    candidates.push({
      selector,
      text,
      value,
      score,
      keywordHits,
      origin: 'heuristic',
      ...(valueType ? { valueType } : {}),
      ...(context ? { context } : {}),
      ...(period ? { period } : {}),
    });
  }

  const seen = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    const key = `${candidate.origin}|${candidate.selector}|${candidate.value}|${candidate.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    candidates: deduped.sort((a, b) => b.score - a.score).slice(0, 30),
    elementsScanned,
  };
}

// ─── Decision logic ───────────────────────────────────────────────────────────

export function pickBestCandidate(candidates: ExtractionCandidate[]): {
  value: number | null;
  confidence: number;
  candidate?: ExtractionCandidate;
} {
  const top = candidates[0];
  if (!top) return { value: null, confidence: 0 };

  const second = candidates.find(
    (candidate) => Math.abs(candidate.value - top.value) > 0.005,
  );
  const confidence = computeConfidence({
    topScore: top.score,
    secondScore: second?.score ?? null,
    candidateCount: candidates.length,
    agreementCount: countAgreementEvidence(candidates, top.value),
  });

  return { value: top.value, confidence, candidate: top };
}

/**
 * Full signal extraction: collect candidates → pick best → return with confidence.
 */
export function extractSignal(
  signalKey: FinancialSignalKey,
  selectors: string[],
  root: Document | Element = document
): { value: number | null; confidence: number; candidate?: ExtractionCandidate } {
  const { candidates } = collectFinancialCandidates(signalKey, selectors, root);
  return pickBestCandidate(candidates);
}
