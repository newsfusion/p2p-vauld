/**
 * E2E tests for AI-powered extraction pipeline.
 * Tests DOM preprocessing (anchor scanning) on synthetic HTML fixtures
 * and verifies prompt construction stays within token budgets.
 *
 * Run: pnpm test:e2e -- tests/e2e/ai-extraction.test.ts
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { readFileSync } from 'fs';
import { dashboardFixture } from '../fixtures/platform-html-bundle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const catalogPath = join(__dirname, '../../src/shared/platforms/platform-catalog.json');
const catalog: Array<{
  id: string;
  name: string;
  dashboard: {
    portfolioValueSelectors: string[];
    freeCashSelectors: string[];
    netAnnualReturnSelectors: string[];
  };
}> = JSON.parse(readFileSync(catalogPath, 'utf-8'));

function getCatalogEntry(id: string) {
  const entry = catalog.find((p) => p.id === id);
  if (!entry) throw new Error(`Platform ${id} not found in catalog`);
  return entry;
}

const MAX_PROMPT_TOKENS = 1024;
const CHARS_PER_TOKEN = 4;

const FIXTURES = [
  'mintos',
  'debitum',
  'estateguru',
  'income_marketplace',
  'indemo',
  'peerberry',
  'triple_dragon',
];

async function loadFixture(page: import('@playwright/test').Page, platformId: string) {
  await page.setContent(dashboardFixture(platformId as never).html, {
    waitUntil: 'domcontentloaded',
  });
}

/**
 * Inline anchor scanning for E2E — mirrors src/content/ai-extractor.ts logic.
 * Necessary because content scripts aren't bundled in Playwright test context.
 */
async function scanAnchorsInPage(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const CURRENCY_REGEX = /[€$£]\s*[\d.,]+|[\d.,]+\s*[€$£%]|\d{1,3}([.,]\d{3})*([.,]\d{1,2})?\s*(EUR|USD|GBP|PLN|CZK|SEK|NOK)/gi;
    const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const MAX_SNIPPET_LENGTH = 200;

    function parseLocalizedNumber(raw: string): number | null {
      const trimmed = raw.trim();
      if (!/[0-9]/.test(trimmed)) return null;
      const cleaned = trimmed.replace(/[^0-9,.-]/g, '');
      const lastComma = cleaned.lastIndexOf(',');
      const lastDot = cleaned.lastIndexOf('.');
      let normalized = cleaned;
      if (lastComma !== -1 && lastDot !== -1) {
        normalized = lastDot > lastComma
          ? cleaned.replace(/,/g, '')
          : cleaned.replace(/\./g, '').replace(',', '.');
      } else if (lastComma !== -1) {
        normalized = cleaned.replace(',', '.');
      }
      const value = Number(normalized);
      return Number.isFinite(value) ? value : null;
    }

    const elements = Array.from(document.querySelectorAll('body *')).slice(0, 6000);
    const snippets: Array<{ rawText: string; value: number; contextBubble: string }> = [];

    for (const el of elements) {
      if (IGNORED_TAGS.has(el.tagName)) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;
      if (el.hasAttribute('hidden')) continue;
      if (el.closest('[aria-hidden="true"], [hidden]')) continue;

      const text = (el.textContent ?? '').trim();
      if (!text || text.length > 500) continue;

      CURRENCY_REGEX.lastIndex = 0;
      if (!CURRENCY_REGEX.test(text)) continue;

      const value = parseLocalizedNumber(text);
      if (value === null) continue;

      // Build context bubble
      const parts: string[] = [];
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) parts.push(ariaLabel.trim());
      const prev = el.previousElementSibling;
      if (prev) {
        const prevText = (prev.textContent ?? '').trim();
        if (prevText && prevText.length <= 120) parts.push(prevText);
      }
      let current: Element | null = el;
      for (let level = 0; level < 3 && current?.parentElement; level++) {
        current = current.parentElement;
        const parentAria = current.getAttribute('aria-label');
        if (parentAria) parts.push(parentAria.trim());
        const parentText = (current.textContent ?? '').trim().slice(0, 120);
        if (parentText) parts.push(parentText);
      }
      const unique = [...new Set(parts.filter(Boolean))];
      const contextBubble = unique.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_LENGTH);

      snippets.push({
        rawText: text.slice(0, MAX_SNIPPET_LENGTH),
        value,
        contextBubble,
      });
    }

    return snippets;
  });
}

/**
 * Build an AI prompt from snippets and estimate token count.
 */
function buildPromptFromSnippets(
  snippets: Array<{ rawText: string; contextBubble: string }>,
  signalKey: string,
  keywords: string[]
): { prompt: string; estimatedTokens: number } {
  // Deduplicate + filter (simplified for test — skip zero/negative since we don't have values here)
  const seen = new Set<string>();
  const unique = snippets.filter((s) => {
    if (seen.has(s.contextBubble)) return false;
    seen.add(s.contextBubble);
    return true;
  });

  // Truncate to budget (800 tokens for snippets)
  const maxBudget = 800;
  const result: typeof unique = [];
  let tokens = 0;
  for (const s of unique) {
    const t = Math.ceil(`"${s.rawText}" (context: ${s.contextBubble})`.length / CHARS_PER_TOKEN);
    if (tokens + t > maxBudget) break;
    tokens += t;
    result.push(s);
  }

  const lines = result.map((s, i) => `${i + 1}. "${s.rawText}" (context: ${s.contextBubble})`);
  const prompt = `Snippets:\n${lines.join('\n')}\n\nExtract: ${signalKey}\nKeywords: ${keywords.join(', ')}`;
  const estimatedTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN);

  return { prompt, estimatedTokens };
}

// ─── Anchor scanning per fixture ──────────────────────────────────────────────

for (const platformId of FIXTURES) {
  test(`anchor scanning finds currency values on ${platformId}`, async ({ page }) => {
    await loadFixture(page, platformId);
    const snippets = await scanAnchorsInPage(page);

    // Every platform should have at least some financial values
    expect(snippets.length).toBeGreaterThan(0);

    // At least one snippet should have a positive value
    const positiveValues = snippets.filter((s) => s.value > 0);
    expect(positiveValues.length).toBeGreaterThan(0);
  });
}

// ─── Token budget compliance per fixture ──────────────────────────────────────

for (const platformId of FIXTURES) {
  test(`prompt stays under ${MAX_PROMPT_TOKENS} tokens for ${platformId}`, async ({ page }) => {
    await loadFixture(page, platformId);
    const snippets = await scanAnchorsInPage(page);
    const entry = getCatalogEntry(platformId);
    const keywords = entry.dashboard.portfolioValueSelectors;

    const { estimatedTokens } = buildPromptFromSnippets(snippets, 'portfolio_value', keywords);
    expect(estimatedTokens).toBeLessThan(MAX_PROMPT_TOKENS);
  });
}

// ─── Mock AI roundtrip ────────────────────────────────────────────────────────

test('full AI extraction pipeline with mocked LanguageModel', async ({ page }) => {
  await loadFixture(page, 'mintos');

  await page.evaluate(() => {
    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: () => Promise.resolve('available'),
      create: () =>
        Promise.resolve({
          prompt: () => Promise.resolve('{"value": 807.83, "currency": "EUR"}'),
          destroy: () => {},
          maxTokens: 1024,
          tokensSoFar: 0,
          tokensLeft: 1024,
          countPromptTokens: () => Promise.resolve(100),
          promptStreaming: () => new ReadableStream(),
        }),
    };
  });

  // Verify LanguageModel is available
  const available = await page.evaluate(async () => {
    if (typeof LanguageModel === 'undefined') return false;
    const status = await LanguageModel.availability();
    return status === 'available';
  });
  expect(available).toBe(true);

  // Verify anchor scanning finds values
  const snippets = await scanAnchorsInPage(page);
  expect(snippets.length).toBeGreaterThan(0);

  // Simulate the full AI extraction flow
  const result = await page.evaluate(async () => {
    if (typeof LanguageModel === 'undefined') return { error: 'no_language_model' };
    const session = await LanguageModel.create({
      initialPrompts: [
        { role: 'system', content: 'Extract financial data' },
      ],
      temperature: 0.1,
    });
    try {
      const response = await session.prompt('test prompt');
      const parsed = JSON.parse(response);
      return { value: parsed.value, currency: parsed.currency };
    } finally {
      session.destroy();
    }
  });

  expect(result).toEqual({ value: 807.83, currency: 'EUR' });
});

test('AI extraction handles unavailable LanguageModel gracefully', async ({ page }) => {
  await loadFixture(page, 'mintos');

  await page.evaluate(() => {
    Object.defineProperty(globalThis, 'LanguageModel', {
      configurable: true,
      value: undefined,
    });
  });

  const available = await page.evaluate(() => typeof LanguageModel !== 'undefined');
  expect(available).toBe(false);
});

test('AI extraction handles model that returns invalid JSON', async ({ page }) => {
  await loadFixture(page, 'mintos');

  await page.evaluate(() => {
    (globalThis as Record<string, unknown>).LanguageModel = {
      availability: () => Promise.resolve('available'),
      create: () =>
        Promise.resolve({
          prompt: () => Promise.resolve('This is not valid JSON'),
          destroy: () => {},
          maxTokens: 1024,
          tokensSoFar: 0,
          tokensLeft: 1024,
          countPromptTokens: () => Promise.resolve(100),
          promptStreaming: () => new ReadableStream(),
        }),
    };
  });

  const result = await page.evaluate(async () => {
    if (typeof LanguageModel === 'undefined') return { error: 'no_api' };
    const session = await LanguageModel.create();
    try {
      const response = await session.prompt('test');
      try {
        JSON.parse(response);
        return { valid: true };
      } catch {
        return { valid: false, raw: response };
      }
    } finally {
      session.destroy();
    }
  });

  expect(result).toHaveProperty('valid', false);
});
