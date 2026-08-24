/**
 * E2E tests for extraction edge cases: currency detection, number parsing,
 * scoring rules, and ambiguous signal handling in a real browser context.
 *
 * Uses synthetic HTML to test specific extraction scenarios.
 *
 * Run: pnpm test:e2e
 */

import { test, expect } from '@playwright/test';

// ─── Inline extraction helper (same as connector.test.ts) ────────────────────

async function extractSignal(
  page: import('@playwright/test').Page,
  signalKey: string,
  labels: string[]
): Promise<{ value: number | null; confidence: number; topScore: number }> {
  return page.evaluate(
    ({ signalKey, labels }) => {
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

      function detectValueType(text: string): 'currency' | 'percent' | null {
        if (/%/.test(text)) return 'percent';
        if (/[€$£]|\b(eur|usd|gbp|pln|czk|sek|nok)\b/i.test(text)) return 'currency';
        return null;
      }

      const defaultKeywords: Record<string, string[]> = {
        portfolio_value: ['portfolio value', 'portfolio', 'kontostand', 'account balance', 'total value', 'total investments', 'invested funds', 'net value', 'insgesamt investiert', 'gesamtinvestition'],
        free_cash: ['available funds', 'available cash', 'available to invest', 'available for investment', 'verfügbare mittel', 'verfügbares guthaben', 'free cash', 'cash', 'wallet', 'uninvested'],
        net_annual_return: ['net annual return', 'net annualised return', 'annual return', 'xirr', 'irr', 'rendite p.a', 'jahresrendite', 'erwartete rendite', 'expected return', 'annual yield'],
      };

      const keywords = [...(defaultKeywords[signalKey] ?? []), ...labels.map((l: string) => l.toLowerCase())];
      const elements = Array.from(document.querySelectorAll('body *')).slice(0, 6000);
      const candidates: { value: number; score: number }[] = [];
      const targetType = signalKey === 'net_annual_return' ? 'percent' : 'currency';

      for (const el of elements) {
        let text: string;
        if (el.children.length === 0) {
          text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        } else if (el.children.length === 1) {
          const childText = (el.children[0]?.textContent ?? '').replace(/\s+/g, ' ').trim();
          const childIsCurrencyOnly = /^[\s\u00a0]*[€$£%][\s\u00a0]*$/.test(childText);
          if (!childIsCurrencyOnly) continue;
          text = Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent ?? '')
            .join('')
            .replace(/\s+/g, ' ')
            .trim();
          if (!text) continue;
        } else {
          continue;
        }
        if (!text || text.length > 140) continue;
        const value = parseLocalizedNumber(text);
        if (value === null) continue;

        const fullText = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
        const valueType = detectValueType(fullText || text);
        const parent = el.parentElement;
        const parentPrev = parent?.previousElementSibling;
        const parentPrevText = (parentPrev?.textContent?.length ?? 0) <= 120
          ? (parentPrev?.textContent ?? '') : '';
        const lower = `${text} ${parent?.textContent ?? ''} ${parentPrevText}`.toLowerCase();

        let score = 0;
        let keywordHits = 0;
        for (const kw of keywords) {
          if (lower.includes(kw)) {
            score += 1.3;
            keywordHits += 1;
          }
        }
        if (valueType === targetType) score += 2;
        else if (valueType === null) score -= 0.7;
        else score -= 2;

        if (targetType === 'currency') {
          if (Math.abs(value) < 0.01) score -= 0.5;
          else if (Math.abs(value) > 100) score += 0.4;
        } else {
          if (Math.abs(value) > 100) score -= 1.2;
          if (signalKey === 'net_annual_return') {
            const hasAnnualHint = /(annual|year|yearly|jahr|jahres|p\.a|pa|xirr|irr)/.test(lower);
            const hasRiskBreakdownHint =
              /(verspätet|delayed|late|days|tage|default|grace|buyback|arrears|risk)/.test(lower);
            if (hasAnnualHint) score += 0.9;
            if (keywordHits === 0 && !hasAnnualHint) score -= 2.5;
            if (hasRiskBreakdownHint) score -= 1.6;
          }
        }

        if (score > 0) candidates.push({ value, score });
      }

      candidates.sort((a, b) => b.score - a.score);
      const top = candidates[0];
      if (!top) return { value: null, confidence: 0, topScore: 0 };

      const second = candidates[1];
      const margin = second ? top.score - second.score : top.score;
      // This intentionally simplified confidence stand-in exercises ranking
      // edge cases only. Production confidence is covered by confidence-baseline.test.ts.
      const confidence = Math.max(0, Math.min(1, 0.45 + Math.max(0, margin) * 0.12));

      return { value: top.value, confidence, topScore: top.score };
    },
    { signalKey, labels }
  );
}

// ─── Inline currency detection helper ────────────────────────────────────────

async function detectCurrencyOnPage(
  page: import('@playwright/test').Page
): Promise<string[]> {
  return page.evaluate(() => {
    function detectCurrency(text: string, fallback = 'EUR'): string {
      const upper = text.toUpperCase();
      if (upper.includes('USD') || upper.includes('$')) return 'USD';
      if (upper.includes('GBP') || upper.includes('£')) return 'GBP';
      if (upper.includes('PLN')) return 'PLN';
      if (upper.includes('CZK')) return 'CZK';
      if (upper.includes('SEK')) return 'SEK';
      if (upper.includes('NOK')) return 'NOK';
      if (upper.includes('EUR') || upper.includes('€')) return 'EUR';
      return fallback;
    }

    // Scan leaf elements for currency indicators
    const elements = Array.from(document.querySelectorAll('body *'));
    const currencies = new Set<string>();
    for (const el of elements) {
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? '').trim();
      if (!text || text.length > 200) continue;
      const currency = detectCurrency(text, '');
      if (currency) currencies.add(currency);
    }
    return Array.from(currencies);
  });
}

// ─── Currency detection tests ────────────────────────────────────────────────

test.describe('Currency detection in DOM', () => {
  test('detects EUR from € symbol', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value</div>
        <div>€12,345.00</div>
      </body></html>
    `);
    const currencies = await detectCurrencyOnPage(page);
    expect(currencies).toContain('EUR');
  });

  test('detects USD from $ symbol', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Account Balance</div>
        <div>$5,000.00</div>
      </body></html>
    `);
    const currencies = await detectCurrencyOnPage(page);
    expect(currencies).toContain('USD');
  });

  test('detects GBP from £ symbol', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value</div>
        <div>£3,200.50</div>
      </body></html>
    `);
    const currencies = await detectCurrencyOnPage(page);
    expect(currencies).toContain('GBP');
  });

  test('detects EUR from text "EUR"', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value: 12345.00 EUR</div>
      </body></html>
    `);
    const currencies = await detectCurrencyOnPage(page);
    expect(currencies).toContain('EUR');
  });

  test('detects multiple currencies on same page', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>EUR Account: €1,000.00</div>
        <div>USD Account: $500.00</div>
      </body></html>
    `);
    const currencies = await detectCurrencyOnPage(page);
    expect(currencies).toContain('EUR');
    expect(currencies).toContain('USD');
  });
});

// ─── Number format edge cases ────────────────────────────────────────────────

test.describe('Number format extraction in real DOM', () => {
  test('extracts EU format number (1.234,56)', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value</div>
        <div>€1.234,56</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    expect(result.value).toBeCloseTo(1234.56, 1);
  });

  test('extracts US format number (1,234.56)', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value</div>
        <div>€1,234.56</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    expect(result.value).toBeCloseTo(1234.56, 1);
  });

  test('extracts large number with spaces (12 345.67)', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value</div>
        <div>€12 345.67</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    // Spaces are stripped by replace(/[^0-9,.-]/g, '') so "12345.67" → 12345.67
    expect(result.value).toBeCloseTo(12345.67, 1);
  });

  test('extracts zero value for free cash', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Available Funds</div>
        <div>€0.00</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'free_cash', ['available funds']);
    expect(result.value).toBe(0);
  });

  test('extracts percentage with comma decimal (8,5%)', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Net Annual Return</div>
        <div>8,5%</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'net_annual_return', ['net annual return']);
    expect(result.value).toBeCloseTo(8.5, 1);
  });

  test('handles currency symbol in child element', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value</div>
        <div><span>€</span>5,000.00</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    expect(result.value).toBeCloseTo(5000, 0);
  });
});

// ─── Scoring edge cases ─────────────────────────────────────────────────────

test.describe('Scoring edge cases', () => {
  test('net_annual_return: risk breakdown values are penalized', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Net Annual Return: <span>8.5%</span></div>
        <div>Delayed payments: <span>2.3%</span></div>
        <div>Default risk: <span>1.1%</span></div>
      </body></html>
    `);
    const result = await extractSignal(page, 'net_annual_return', ['net annual return']);
    // Should pick 8.5% (annual return), not the risk breakdown values
    expect(result.value).toBeCloseTo(8.5, 1);
  });

  test('net_annual_return: percentage > 100% is penalized', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Net Annual Return: <span>9.2%</span></div>
        <div>Completion: <span>145%</span></div>
      </body></html>
    `);
    const result = await extractSignal(page, 'net_annual_return', ['net annual return']);
    // Should pick 9.2%, not 145%
    expect(result.value).toBeCloseTo(9.2, 1);
  });

  test('portfolio_value: prefers larger currency values', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value: <span>€12,500.00</span></div>
        <div>Fee: <span>€0.50</span></div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    // Should pick 12,500 (gets +0.4 bonus for > 100)
    expect(result.value).toBeCloseTo(12500, 0);
  });

  test('no signal found returns null with zero confidence', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Welcome to the platform!</div>
        <div>Loading your data...</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    expect(result.value).toBeNull();
    expect(result.confidence).toBe(0);
  });

  test('single candidate gets high confidence (no ambiguity)', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value</div>
        <div>€10,000.00</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    expect(result.value).toBeCloseTo(10000, 0);
    // Single candidate: margin = topScore (no second), confidence should be > 0.72
    expect(result.confidence).toBeGreaterThan(0.72);
  });

  test('very close competing candidates lower confidence', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value: <span>€5,000.00</span></div>
        <div>Portfolio Value: <span>€3,000.00</span></div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    expect(result.value).not.toBeNull();
    // Two candidates with identical context → margin ≈ 0 → confidence ≈ 0.45
    expect(result.confidence).toBeLessThan(0.72);
  });

  test('currency signal ignores percentage values', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Portfolio Value</div>
        <div>8.5%</div>
        <div>€12,000.00</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'portfolio_value', ['portfolio value']);
    // Should pick €12,000, not 8.5%
    expect(result.value).toBeCloseTo(12000, 0);
  });

  test('percentage signal ignores currency values', async ({ page }) => {
    await page.setContent(`
      <html><body>
        <div>Net Annual Return</div>
        <div>€12,000.00</div>
        <div>7.3%</div>
      </body></html>
    `);
    const result = await extractSignal(page, 'net_annual_return', ['net annual return']);
    // Should pick 7.3%, not €12,000
    expect(result.value).toBeCloseTo(7.3, 1);
  });
});

// ─── Synthetic fixture currency detection ────────────────────────────────────

import { dashboardFixture } from '../fixtures/platform-html-bundle.js';

const PLATFORM_FIXTURES = [
  'mintos',
  'peerberry',
  'estateguru',
  'debitum',
  'income_marketplace',
  'indemo',
  'triple_dragon',
];

test.describe('Currency detection on synthetic fixtures', () => {
  for (const platformId of PLATFORM_FIXTURES) {
    test(`${platformId}: detects at least one currency on page`, async ({ page }) => {
      await page.setContent(dashboardFixture(platformId as never).html, {
        waitUntil: 'domcontentloaded',
      });
      const currencies = await detectCurrencyOnPage(page);
      // All P2P platforms deal in currencies — should detect at least one
      expect(currencies.length).toBeGreaterThan(0);
    });
  }
});
