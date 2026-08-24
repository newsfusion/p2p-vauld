import { describe, expect, it } from "vitest";
import {
  collectFinancialCandidates,
  pickBestCandidate,
} from "../../src/content/extractor.js";
import { isWellEvidenced } from "../../src/shared/page-quality.js";

function extract(html: string): ReturnType<typeof pickBestCandidate> & {
  allCandidates: ReturnType<typeof collectFinancialCandidates>["candidates"];
} {
  const document = new DOMParser().parseFromString(html, "text/html");
  const { candidates } = collectFinancialCandidates(
    "portfolio_value",
    [],
    document,
  );
  return { ...pickBestCandidate(candidates), allCandidates: candidates };
}

/**
 * The page Debitum and Income Marketplace redirect to after login: a per-loan
 * table. It is full of currency amounts, so a plain "did we get a number?"
 * check passes — which is exactly how the wrong value used to be picked.
 */
const INVESTMENTS_LIST = `
  <h1>Meine Investitionen</h1>
  <table>
    <thead>
      <tr><th>ID</th><th>Kreditgeber</th><th>Meine Investition</th><th>Kapital</th></tr>
    </thead>
    <tbody>
      <tr><td>7618630</td><td>Hoovi</td><td>€30.00</td><td>€1.03</td></tr>
      <tr><td>7397276</td><td>Hoovi</td><td>€30.00</td><td>€6.89</td></tr>
      <tr><td>7243272</td><td>Hoovi</td><td>€27.93</td><td>€5.53</td></tr>
      <tr><td>6728323</td><td>Hoovi</td><td>€22.49</td><td>€8.00</td></tr>
    </tbody>
  </table>
`;

/** The account overview the ladder should navigate to instead. */
const ACCOUNT_OVERVIEW = `
  <h1>Konto</h1>
  <div class="cards">
    <div class="card"><span class="label">Kontostand</span><span class="value">€12.345,67</span></div>
    <div class="card"><span class="label">Verfügbares Guthaben</span><span class="value">€35,55</span></div>
  </div>
`;

describe("page quality against real page shapes", () => {
  it("does not accept a portfolio value scraped off an investments list", () => {
    const result = extract(INVESTMENTS_LIST);

    // A number is found — that is the trap the old null check fell into.
    expect(result.value).not.toBeNull();
    expect(isWellEvidenced(result)).toBe(false);
  });

  it("accepts the labelled value on an account overview", () => {
    const result = extract(ACCOUNT_OVERVIEW);

    expect(result.value).toBe(12345.67);
    expect(isWellEvidenced(result)).toBe(true);
  });

  it("gives investments-list candidates no keyword evidence", () => {
    const result = extract(INVESTMENTS_LIST);

    expect(result.candidate?.keywordHits).toBe(0);
  });
});
