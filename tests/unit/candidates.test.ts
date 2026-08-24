/**
 * Tests for financial signal extraction using DOM APIs.
 * Runs with happy-dom environment (see vitest.config.ts).
 */

import { describe, it, expect } from 'vitest';
import {
  parseLocalizedNumber,
  collectFinancialCandidates,
  pickBestCandidate,
  detectCurrency,
} from '../../src/content/extractor.js';

// ─── parseLocalizedNumber ─────────────────────────────────────────────────────

describe('parseLocalizedNumber', () => {
  it('parses US format (1,234.56)', () => {
    expect(parseLocalizedNumber('1,234.56')).toBe(1234.56);
  });

  it('parses EU format (1.234,56)', () => {
    expect(parseLocalizedNumber('1.234,56')).toBe(1234.56);
  });

  it('parses with currency symbol', () => {
    expect(parseLocalizedNumber('€ 5,432.10')).toBe(5432.1);
  });

  it('parses percentage', () => {
    expect(parseLocalizedNumber('8.54%')).toBe(8.54);
  });

  it('returns null for non-numeric strings', () => {
    expect(parseLocalizedNumber('N/A')).toBeNull();
    expect(parseLocalizedNumber('Portfolio Value')).toBeNull();
    expect(parseLocalizedNumber('')).toBeNull();
  });

  it('parses plain integers', () => {
    expect(parseLocalizedNumber('1000')).toBe(1000);
  });

  it('parses negative values', () => {
    expect(parseLocalizedNumber('-123.45')).toBe(-123.45);
  });
});

// ─── detectCurrency ───────────────────────────────────────────────────────────

describe('detectCurrency', () => {
  it('detects EUR from symbol', () => {
    expect(detectCurrency('€ 1,234.56')).toBe('EUR');
  });

  it('detects USD from symbol', () => {
    expect(detectCurrency('$ 5,000.00')).toBe('USD');
  });

  it('detects from text', () => {
    expect(detectCurrency('1,234.56 EUR')).toBe('EUR');
    expect(detectCurrency('1,234.56 GBP')).toBe('GBP');
  });

  it('uses fallback when no currency detected', () => {
    expect(detectCurrency('1,234.56', 'USD')).toBe('USD');
    expect(detectCurrency('1,234.56')).toBe('EUR');
  });

  it('allows an empty fallback for chained currency detection', () => {
    expect(detectCurrency('1,234.56', '')).toBe('');
  });
});

// ─── collectFinancialCandidates (DOM-based) ───────────────────────────────────

function makeDocument(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('collectFinancialCandidates — portfolio_value', () => {
  it('keeps selector hits in the candidate list and still scans heuristic candidates', () => {
    makeDocument(`
      <section>
        <div class="stale-total">€ 999.00</div>
      </section>
      <section>
        <span>Portfolio Value</span>
        <strong class="real-total">€ 1,234.00</strong>
      </section>
    `);

    const { candidates, elementsScanned } = collectFinancialCandidates(
      'portfolio_value',
      ['.stale-total'],
      document
    );

    expect(elementsScanned).toBeGreaterThan(0);
    expect(candidates.some((candidate) => candidate.origin === 'selector')).toBe(true);
    expect(candidates.some((candidate) => candidate.origin === 'heuristic')).toBe(true);
    expect(candidates[0]!.score).toBeLessThan(10);
  });

  it('can run selector-only extraction without scanning heuristic candidates', () => {
    makeDocument(`
      <section>
        <div class="stored-total">€ 999.00</div>
      </section>
      <section>
        <span>Portfolio Value</span>
        <strong class="real-total">€ 1,234.00</strong>
      </section>
    `);

    const { candidates, elementsScanned } = collectFinancialCandidates(
      'portfolio_value',
      ['.stored-total'],
      document,
      {},
      { selectorOnly: true },
    );

    expect(elementsScanned).toBe(0);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.origin).toBe('selector');
    expect(candidates[0]?.selector).toBe('.stored-total');
    expect(candidates[0]?.value).toBe(999);
    expect(candidates.some((candidate) => candidate.selector === '.real-total')).toBe(
      false,
    );
  });

  it('extracts portfolio value from labeled element', () => {
    makeDocument(`
      <div class="portfolio-section">
        <span class="label">Portfolio Value</span>
        <span class="value">€ 12,345.67</span>
      </div>
    `);

    const { candidates } = collectFinancialCandidates('portfolio_value', [], document);
    expect(candidates.length).toBeGreaterThan(0);

    const top = candidates[0];
    expect(top).toBeDefined();
    expect(top!.value).toBeCloseTo(12345.67);
    expect(top!.score).toBeGreaterThan(0);
  });

  it('scores currency values higher than percentages for portfolio_value', () => {
    makeDocument(`
      <div>
        <span class="pv-label">Portfolio</span>
        <span class="pv-value">€ 50,000.00</span>
        <span class="ret-label">Return</span>
        <span class="ret-value">8.5%</span>
      </div>
    `);

    const { candidates } = collectFinancialCandidates('portfolio_value', [], document);
    // The € amount should rank higher than the % amount
    const top = candidates[0];
    expect(top!.value).toBe(50000);
  });

  it('prefers Mintos-style account value over total return labels', () => {
    makeDocument(`
      <section>
        <div>Gesamtrendite</div>
        <div>€ 939.64</div>
      </section>
      <section>
        <div>Kontowert</div>
        <div>€ 807.83</div>
      </section>
    `);

    const { candidates } = collectFinancialCandidates(
      'portfolio_value',
      [],
      document
    );

    expect(candidates[0]!.value).toBeCloseTo(807.83);
  });

  it('keeps PeerBerry zero portfolio candidates distinguishable', () => {
    makeDocument(`
      <main>
        <section aria-label="Account overview">
          <div class="summary-row">
            <span>Available for investment</span>
            <div>€ 0.00</div>
          </div>
          <div class="summary-row">
            <span>Invested funds</span>
            <div>€ 0.00</div>
          </div>
          <div class="summary-row">
            <span>Profit</span>
            <div>€ 1,068.18</div>
          </div>
        </section>
      </main>
    `);

    const { candidates } = collectFinancialCandidates(
      'portfolio_value',
      [],
      document,
      {
        portfolio_value: ['account overview', 'total portfolio', 'invested funds'],
      },
    );
    const zeroCandidates = candidates.filter((candidate) => candidate.value === 0);
    const selectors = new Set(zeroCandidates.map((candidate) => candidate.selector));

    expect(zeroCandidates.length).toBeGreaterThanOrEqual(2);
    expect(selectors.size).toBe(zeroCandidates.length);
    expect([...selectors].every((selector) => !/^(div|span)$/.test(selector))).toBe(true);
    expect([...selectors].every((selector) => document.querySelector(selector))).toBe(true);
    expect(candidates[0]?.context).toContain('Invested funds');
  });

  it('uses Estateguru Account Value and excludes Total Investments', () => {
    makeDocument(`
      <main>
        <section>
          <div>Total Investments</div>
          <span>€15,563.30</span>
        </section>
        <section>
          <div>Account Value</div>
          <span>€4,253.03</span>
        </section>
        <section>
          <div>Net Annual Return</div>
          <span>9.8%</span>
        </section>
      </main>
    `);

    const { candidates } = collectFinancialCandidates(
      'portfolio_value',
      [],
      document,
      {
        portfolio_value: [
          'portfolio value',
          'outstanding principal',
          'total invested',
          'account value',
        ],
      },
      {
        excludeKeywords: {
          portfolio_value: ['total investments', 'total invested'],
        },
      },
    );

    expect(candidates.find((candidate) => candidate.value === 15563.3)).toBeUndefined();
    expect(pickBestCandidate(candidates).value).toBeCloseTo(4253.03);
  });
});

describe('collectFinancialCandidates — free_cash', () => {
  it('uses platform keywords to boost platform-specific labels', () => {
    makeDocument(`
      <section>
        <span>Reserved balance</span>
        <span>€ 900.00</span>
      </section>
      <section>
        <span>Cash drag</span>
        <span>€ 42.00</span>
      </section>
    `);

    const withoutKeywords = collectFinancialCandidates('free_cash', [], document);
    const withKeywords = collectFinancialCandidates('free_cash', [], document, {
      free_cash: ['cash drag'],
    });

    expect(withKeywords.candidates[0]!.value).toBe(42);
    expect(withKeywords.candidates[0]!.score).toBeGreaterThan(
      withoutKeywords.candidates.find((candidate) => candidate.value === 42)?.score ?? 0,
    );
  });

  it('extracts free cash from labeled element', () => {
    makeDocument(`
      <div>
        <p class="label">Available Cash</p>
        <p class="amount">€ 1,234.00</p>
      </div>
    `);

    const { candidates } = collectFinancialCandidates('free_cash', [], document);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.value).toBeCloseTo(1234);
  });

  it('ignores script noise and prefers Mintos available cash over Smart Cash', () => {
    makeDocument(`
      <script>
        window.__STATE__ = { id: 5185538154, product: 'Smart Cash' };
      </script>
      <section>
        <div>Smart Cash</div>
        <div>€ 0.00</div>
      </section>
      <section>
        <div>Verfügbar</div>
        <div>€ 29.44</div>
      </section>
    `);

    const { candidates } = collectFinancialCandidates(
      'free_cash',
      [],
      document
    );

    expect(candidates[0]!.value).toBeCloseTo(29.44);
  });

  it('keeps PeerBerry zero free cash candidates distinguishable and ranks the available balance first', () => {
    makeDocument(`
      <main>
        <section aria-label="Account overview">
          <div class="summary-row">
            <span>Available for investment</span>
            <div>€ 0.00</div>
          </div>
          <div class="summary-row">
            <span>Invested funds</span>
            <div>€ 0.00</div>
          </div>
          <div class="summary-row">
            <span>Profit</span>
            <div>€ 1,068.18</div>
          </div>
        </section>
        <aside>
          <h2>Investments</h2>
          <div>
            <span>Total</span>
            <div>€ 0.00</div>
          </div>
        </aside>
      </main>
    `);

    const { candidates } = collectFinancialCandidates(
      'free_cash',
      [],
      document,
      {
        free_cash: ['available for investment', 'available funds'],
      },
    );
    const zeroCandidates = candidates.filter((candidate) => candidate.value === 0);
    const selectors = new Set(zeroCandidates.map((candidate) => candidate.selector));

    expect(zeroCandidates.length).toBeGreaterThanOrEqual(2);
    expect(selectors.size).toBe(zeroCandidates.length);
    expect([...selectors].every((selector) => !/^(div|span)$/.test(selector))).toBe(true);
    expect([...selectors].every((selector) => document.querySelector(selector))).toBe(true);
    expect(candidates[0]?.value).toBe(0);
    expect(candidates[0]?.context).toContain('Available for investment');
  });

  it('generates deterministic selectors for the same PeerBerry zero-value DOM', () => {
    const html = `
      <main>
        <section aria-label="Account overview">
          <div class="summary-row">
            <span>Available for investment</span>
            <div>€ 0.00</div>
          </div>
          <div class="summary-row">
            <span>Invested funds</span>
            <div>€ 0.00</div>
          </div>
        </section>
      </main>
    `;

    makeDocument(html);
    const firstSelectors = collectFinancialCandidates(
      'free_cash',
      [],
      document,
      { free_cash: ['available for investment', 'available funds'] },
    ).candidates
      .filter((candidate) => candidate.value === 0)
      .map((candidate) => candidate.selector);

    makeDocument(html);
    const secondSelectors = collectFinancialCandidates(
      'free_cash',
      [],
      document,
      { free_cash: ['available for investment', 'available funds'] },
    ).candidates
      .filter((candidate) => candidate.value === 0)
      .map((candidate) => candidate.selector);

    expect(secondSelectors).toEqual(firstSelectors);
  });

  it('prefers stable attributes when available for heuristic selector fingerprints', () => {
    makeDocument(`
      <section aria-label="Account overview">
        <div>
          <span>Available for investment</span>
          <div data-testid="peerberry-available-balance">€ 0.00</div>
        </div>
      </section>
    `);

    const { candidates } = collectFinancialCandidates(
      'free_cash',
      [],
      document,
      { free_cash: ['available for investment', 'available funds'] },
    );

    expect(candidates[0]?.selector).toBe('div[data-testid="peerberry-available-balance"]');
    expect(document.querySelector(candidates[0]!.selector)?.textContent).toContain('€ 0.00');
  });

  it('uses nearby header link attributes as context for icon-only wallet balances', () => {
    makeDocument(`
      <header role="banner">
        <a href="/wallet" aria-label="Wallet">
          <span><div>€25.51</div></span>
          <span class="badge">550</span>
        </a>
      </header>
      <main>
        <section>
          <span>Pending investment credit</span>
          <span>€15.00</span>
        </section>
        <section>
          <span>Total Investments</span>
          <span>€15,800.70</span>
        </section>
      </main>
    `);

    const { candidates } = collectFinancialCandidates('free_cash', [], document);
    const headerBalance = candidates.find((candidate) => candidate.value === 25.51);

    expect(headerBalance).toBeDefined();
    expect(headerBalance?.context).toContain('Wallet');
    expect(headerBalance?.context).toContain('wallet');
    expect(headerBalance?.score).toBeGreaterThan(2);
    expect(
      candidates.find((candidate) => candidate.value === 550)?.context ?? '',
    ).not.toContain('wallet');
  });

  it('excludes Estateguru free-cash decoys instead of choosing a false balance', () => {
    makeDocument(`
      <main>
        <section>
          <div>Investment Credit</div>
          <span>€15.00</span>
        </section>
        <section>
          <div>Deposited this month</div>
          <span>€0.00</span>
        </section>
        <section>
          <div>Invested this month</div>
          <span>€0.00</span>
        </section>
        <section>
          <div>Earned in the past year</div>
          <span>€122.30</span>
        </section>
        <section>
          <div>Principal</div>
          <span>€3,900.00</span>
        </section>
        <section>
          <div>Interest</div>
          <span>€32.10</span>
        </section>
        <section>
          <div>Available trades matching your filters</div>
          <span>24</span>
        </section>
      </main>
    `);

    const { candidates } = collectFinancialCandidates(
      'free_cash',
      [],
      document,
      {
        free_cash: ['available funds', 'available balance'],
      },
      {
        excludeKeywords: {
          free_cash: [
            'investment credit',
            'deposited this month',
            'invested this month',
            'earned in the past year',
            'principal',
            'interest',
            'available trades',
            'matching your filters',
          ],
        },
      },
    );

    expect(candidates).toHaveLength(0);
    expect(pickBestCandidate(candidates).value).toBeNull();
  });
});

describe('collectFinancialCandidates — net_annual_return', () => {
  it('extracts annual return percentage', () => {
    makeDocument(`
      <div>
        <span class="lbl">Net Annual Return</span>
        <span class="val">8.54%</span>
      </div>
    `);

    const { candidates } = collectFinancialCandidates(
      'net_annual_return',
      [],
      document
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]!.value).toBeCloseTo(8.54);
    expect(candidates[0]!.valueType).toBe('percent');
  });

  it('penalises unlabelled percentages that share no label context', () => {
    // Put the noise in an isolated container so its parent text does NOT include label keywords
    makeDocument(`
      <section id="noise">
        <span>Some random percentage: 12.3%</span>
      </section>
      <section id="nar">
        <span class="nar-label">Net Annual Return</span>
        <span class="nar-value">8.54%</span>
      </section>
    `);

    const { candidates } = collectFinancialCandidates(
      'net_annual_return',
      [],
      document
    );
    // The labelled 8.54% should rank highest — 12.3% has no keyword context
    expect(candidates[0]!.value).toBeCloseTo(8.54);
  });
});

describe('pickBestCandidate', () => {
  it('returns null for empty candidates', () => {
    const result = pickBestCandidate([]);
    expect(result.value).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('returns the top-scored candidate', () => {
    const candidates = [
      { selector: '.a', text: '€ 5,000', value: 5000, score: 3.5, valueType: 'currency' as const },
      { selector: '.b', text: '€ 1,000', value: 1000, score: 2.0, valueType: 'currency' as const },
    ];
    const result = pickBestCandidate(candidates);
    expect(result.value).toBe(5000);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.candidate?.selector).toBe('.a');
  });

  it('yields higher confidence when top score margin is large', () => {
    const tight = [
      { selector: '.a', text: '1', value: 1, score: 3.0 },
      { selector: '.b', text: '2', value: 2, score: 2.9 },
    ];
    const wide = [
      { selector: '.a', text: '1', value: 1, score: 5.0 },
      { selector: '.b', text: '2', value: 2, score: 1.0 },
    ];

    expect(pickBestCandidate(tight).confidence).toBeLessThan(pickBestCandidate(wide).confidence);
  });
});
