import { describe, it, expect } from 'vitest';
import { collectFinancialCandidates } from '../../src/content/extractor.js';

function makeDocument(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe('Heuristic Leakage Prevention', () => {
  it('correctly isolates Bondora Go & Grow HTML structures', () => {
    // Parent contains multiple <p> tags with numbers (Account balance, Wallet, Return)
    makeDocument(`
      <main>
        <h1>Bondora Go & Grow Dashboard</h1>
        <section aria-label="Investor account">
          <p>Account balance: €11,250.00</p>
          <p>Wallet: €575.00</p>
          <p>Annual return: 6.18%</p>
        </section>
      </main>
    `);

    // Extract portfolio_value (should pick 11250)
    const pvCandidates = collectFinancialCandidates('portfolio_value', [], document).candidates;
    expect(pvCandidates.length).toBeGreaterThan(0);
    expect(pvCandidates[0]!.value).toBe(11250);

    // Extract free_cash (should NOT pick 11250! It must pick 575 because "Wallet" matches and does not bleed into balance)
    const fcCandidates = collectFinancialCandidates('free_cash', [], document).candidates;
    expect(fcCandidates.length).toBeGreaterThan(0);
    expect(fcCandidates[0]!.value).toBe(575);
  });

  it('correctly isolates PeerBerry HTML structures', () => {
    // Parent section contains several article tags with numbers, one of which has "Available funds"
    makeDocument(`
      <main>
        <h1>PeerBerry Overview</h1>
        <section aria-label="Available for investment">
          <article data-test="peerberry-balance">Portfolio Value €12,250.00</article>
          <article><span>Available funds</span><b>€625.00</b></article>
          <article><span>Net annualised return</span><b>6.30%</b></article>
        </section>
      </main>
    `);

    // Extract portfolio_value
    const pvCandidates = collectFinancialCandidates('portfolio_value', [], document).candidates;
    expect(pvCandidates.length).toBeGreaterThan(0);
    expect(pvCandidates[0]!.value).toBe(12250);

    // Extract free_cash (should pick 625, NOT 12250)
    const fcCandidates = collectFinancialCandidates('free_cash', [], document).candidates;
    expect(fcCandidates.length).toBeGreaterThan(0);
    expect(fcCandidates[0]!.value).toBe(625);
  });

  it('correctly isolates Twino HTML structures', () => {
    // Parent dl has "Account metrics" label and contains multiple dd's with numbers
    makeDocument(`
      <main>
        <h1>TWINO Account</h1>
        <dl aria-label="Account metrics">
          <dt>Total value</dt>
          <dd>€14,250.00</dd>
          <dt>Available to invest</dt>
          <dd>€725.00</dd>
          <dt>XIRR yearly</dt>
          <dd>6.60%</dd>
        </dl>
      </main>
    `);

    // Extract portfolio_value
    const pvCandidates = collectFinancialCandidates('portfolio_value', [], document).candidates;
    expect(pvCandidates.length).toBeGreaterThan(0);
    expect(pvCandidates[0]!.value).toBe(14250);

    // Extract free_cash (should pick 725, NOT 14250)
    const fcCandidates = collectFinancialCandidates('free_cash', [], document).candidates;
    expect(fcCandidates.length).toBeGreaterThan(0);
    expect(fcCandidates[0]!.value).toBe(725);
  });

  it('does not leak previous sibling section labels into multi-value container context', () => {
    makeDocument(`
      <main>
        <section>
          <h2>Portfolio Value</h2>
          <p>€12,250.00</p>
        </section>
        <section>
          <div>Available</div>
          <div>€625.00</div>
          <div>Annual return</div>
          <div>6.30%</div>
        </section>
      </main>
    `);

    const fcCandidates = collectFinancialCandidates('free_cash', [], document).candidates;
    const cashCandidate = fcCandidates.find((candidate) => candidate.value === 625);

    expect(cashCandidate).toBeDefined();
    expect(cashCandidate?.context).not.toContain('Portfolio Value');
  });
});
