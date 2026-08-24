import { afterEach, describe, expect, it } from "vitest";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";
import {
  checkLoginState,
  detectSessionEvidence,
  isLikelyLoggedIn,
} from "../../src/content/login.js";

function setBody(html: string): void {
  document.body.replaceChildren(
    document.createRange().createContextualFragment(html),
  );
}

const DEBITUM_LOGIN_FORM = `
  <form>
    <div class="nOADS" data-fieldname="email">
      <input name="email" inputmode="email" value="[EMAIL_ADDRESS]" />
    </div>
    <div class="nOADS" data-fieldname="password">
      <input type="password" name="password" value="secret" />
    </div>
    <button class="_85ZHE" type="submit">LOGIN</button>
  </form>
  <a href="/en/register">Don't have an account? Register now</a>
`;

/**
 * Condensed version of the header Debitum renders on /en/login while the
 * session cookie is still valid: signed-in nav, balance, account avatar, and a
 * LOGOUT button that lives in the collapsed mobile menu (display:none).
 */
const DEBITUM_AUTHENTICATED_HEADER = `
  <div class="_3KozD">
    <a class="_1j5J8" href="/overview"><svg width="48" height="48"></svg></a>
    <div class="_2Jc8T" title="My balance"><div class="_2COrd">&nbsp;€112.20</div></div>
    <div class="_2hafP">
      <a class="_1DAb1" href="/overview">Overview</a>
      <a class="_1DAb1" href="/deposit">Deposit</a>
      <a class="_1DAb1" href="/auto-invest">Auto invest</a>
      <a class="_1DAb1" href="/invest">Invest</a>
      <a class="_1DAb1" href="/my-portfolio">My portfolio</a>
      <a class="_1DAb1" href="/my-balance">My balance</a>
      <a class="_1DAb1" href="/loyalty-program">Loyalty program</a>
    </div>
    <div class="_3JsMl _21a8M" title="Account settings"><div class="_1z44T">P</div></div>
    <div class="_2hWiW" style="display: none">
      <button type="submit" class="yNzkb lAMJU HlFJz">LOGOUT</button>
    </div>
  </div>
`;

const DEBITUM_POST_LOGIN_INDICATORS = [
  "text=/available funds|available cash|free cash|verfügbar/i",
  "text=/mein kontostand|my balance|kontoauszug|account statement/i",
  "text=/insgesamt investiert|total invested/i",
  ".portfolio-value",
  '[data-cy="portfolio-total"]',
];

afterEach(() => {
  document.body.replaceChildren();
});

describe("detectSessionEvidence", () => {
  it("detects a live session on Debitum's login page", () => {
    setBody(`${DEBITUM_AUTHENTICATED_HEADER}${DEBITUM_LOGIN_FORM}`);

    expect(detectSessionEvidence()).toBe(true);
  });

  it("still refuses to treat that page as logged in", () => {
    setBody(`${DEBITUM_AUTHENTICATED_HEADER}${DEBITUM_LOGIN_FORM}`);

    // The header text matches the "my balance" post-login indicator, so the
    // strict check must keep winning — extraction here would read the wrong page.
    expect(
      isLikelyLoggedIn(DEBITUM_POST_LOGIN_INDICATORS, {
        usernameSelectors: ['input[name="email"]'],
        passwordSelectors: ['input[name="password"]'],
      }),
    ).toBe(false);
  });

  it("surfaces sessionEvidence through checkLoginState", () => {
    setBody(`${DEBITUM_AUTHENTICATED_HEADER}${DEBITUM_LOGIN_FORM}`);

    const result = checkLoginState(
      DEBITUM_POST_LOGIN_INDICATORS,
      [],
      ['input[name="email"]'],
      ['input[name="password"]'],
    );

    expect(result.success).toBe(false);
    expect(result.sessionEvidence).toBe(true);
  });

  it("treats a visible logout control as sufficient on its own", () => {
    setBody(`<header><a href="/logout">Log out</a></header>`);

    expect(detectSessionEvidence()).toBe(true);
  });

  it("does not fire on a plain login page", () => {
    setBody(`
      <header><a href="/en/login">Log in</a></header>
      ${DEBITUM_LOGIN_FORM}
    `);

    expect(detectSessionEvidence()).toBe(false);
  });

  it("does not fire on a marketing page with a single account-ish link", () => {
    setBody(`
      <nav>
        <a href="/about">About</a>
        <a href="/invest">Invest</a>
        <a href="/en/register">Register</a>
        <a href="/en/login">Log in</a>
      </nav>
      <h1>Invest in secured business loans</h1>
    `);

    expect(detectSessionEvidence()).toBe(false);
  });

  it("ignores authenticated-looking nav links on other origins", () => {
    setBody(`
      <nav>
        <a href="https://blog.example.com/portfolio">Portfolio</a>
        <a href="https://blog.example.com/my-account">My account</a>
      </nav>
      <div class="user-avatar"></div>
    `);

    expect(detectSessionEvidence()).toBe(false);
  });

  it("surfaces no sessionEvidence field on a plain login page", () => {
    setBody(`<header><a href="/en/login">Log in</a></header>${DEBITUM_LOGIN_FORM}`);

    const result = checkLoginState(
      DEBITUM_POST_LOGIN_INDICATORS,
      [],
      ['input[name="email"]'],
      ['input[name="password"]'],
    );

    expect(result.sessionEvidence).toBeUndefined();
  });
});

describe("Debitum login regression guards", () => {
  it("keeps post-login indicators narrow enough to avoid login-page false positives", () => {
    const debitum = getPlatformCatalog().find((platform) => platform.id === "debitum");

    expect(debitum).toBeDefined();
    expect(debitum?.login.postLoginIndicators).not.toContain(
      "text=/portfolio|dashboard|overview|überblick/i",
    );
    expect(debitum?.login.postLoginIndicators).toContain(
      "text=/available funds|available cash|free cash|verfügbar/i",
    );
    expect(debitum?.login.postLoginIndicators).toContain(
      "text=/insgesamt investiert|total invested/i",
    );
  });
});
