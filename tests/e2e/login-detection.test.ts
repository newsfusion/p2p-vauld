/**
 * E2E tests for login form detection, post-login state detection,
 * captcha detection, and 2FA detection.
 *
 * Uses synthetic HTML pages to simulate various login states.
 *
 * Run: pnpm test:e2e
 */

import { test, expect } from "@playwright/test";

// ─── Helper: set page content with a realistic structure ─────────────────────

async function setPageContent(
  page: import("@playwright/test").Page,
  html: string,
  url?: string,
) {
  if (url) {
    await page.goto(url);
    await page.setContent(html, { waitUntil: "domcontentloaded" });
  } else {
    await page.setContent(html, { waitUntil: "domcontentloaded" });
  }
}

// ─── Inline login detection logic (mirrors login.ts) ─────────────────────────

async function evaluateLoginState(
  page: import("@playwright/test").Page,
  params: {
    postLoginIndicators: string[];
    usernameSelectors: string[];
    passwordSelectors: string[];
    otpSelectors: string[];
    pathOverride?: string;
    afterSubmission?: boolean;
    entryUrl?: string;
  },
): Promise<{
  isLoggedIn: boolean;
  hasCaptcha: boolean;
  hasLoginForm: boolean;
  hasOtpField: boolean;
}> {
  return page.evaluate((params) => {
    const genericUsernameSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[autocomplete="username"]',
    ];
    const genericPasswordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[autocomplete="current-password"]',
    ];
    const genericOtpSelectors = [
      'input[name="otp"]',
      'input[name="code"]',
      'input[autocomplete="one-time-code"]',
    ];
    const unauthPathHint =
      /\/(login|sign-?in|auth|authorize|captcha|challenge|verify)(\/|$)/i;
    const authPathHint =
      /\/(overview|dashboard|portfolio|account|wallet|investor)(\/|$)/i;
    const loginTriggerTextPattern =
      /\b(log\s*in|login|sign\s*in|signin)\b|anmeld|einlogg/i;
    const nonLoginTriggerTextPattern =
      /\b(log\s*out|logout|sign\s*out|signout|register|sign\s*up|signup|join|create account)\b|abmeld|registrier|konto erstellen/i;
    const logoutTriggerTextPattern =
      /\b(log\s*out|logout|sign\s*out|signout)\b|abmeld|auslogg/i;
    const logoutHrefPattern = /\/(logout|sign-?out|abmelden)(\/|$|\?)/i;

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0"
      );
    }

    function findFirstVisible(selectors: string[]): Element | null {
      for (const selector of selectors) {
        try {
          const el = document.querySelector(selector);
          if (el && isVisible(el)) return el;
        } catch {
          // Invalid selector — skip
        }
      }
      return null;
    }

    function triggerText(el: Element): string {
      const values = [
        el.textContent ?? "",
        el.getAttribute("aria-label") ?? "",
        el.getAttribute("title") ?? "",
      ];
      if (el instanceof HTMLInputElement) {
        values.push(el.value, el.name);
      }
      if (el instanceof HTMLAnchorElement) {
        values.push(el.href);
      }
      return values.join(" ").replace(/\s+/g, " ").trim();
    }

    function findVisibleLoginTrigger(): HTMLElement | null {
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button, input[type="button"], input[type="submit"], [role="button"]',
        ),
      )) {
        if (!isVisible(el)) continue;
        const text = triggerText(el);
        if (
          loginTriggerTextPattern.test(text) &&
          !nonLoginTriggerTextPattern.test(text)
        ) {
          return el;
        }
      }
      return null;
    }

    function findVisibleLogoutTrigger(): HTMLElement | null {
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button, [role="button"], [role="link"]',
        ),
      )) {
        if (!isVisible(el)) continue;
        const text = triggerText(el);
        const href =
          el instanceof HTMLAnchorElement ? el.getAttribute("href") ?? "" : "";
        if (logoutTriggerTextPattern.test(text) || logoutHrefPattern.test(href)) {
          return el;
        }
      }
      return null;
    }

    function hasAfterSubmissionNeutralPage(path: string): boolean {
      if (!params.afterSubmission) return false;
      if (findVisibleLoginTrigger()) return false;
      if (document.readyState !== "complete") return false;
      if ((document.body.textContent ?? "").trim().length < 100) return false;

      if (!params.entryUrl) return false;
      try {
        const entryPath = new URL(params.entryUrl, window.location.href).pathname
          .toLowerCase();
        return path !== entryPath;
      } catch {
        return false;
      }
    }

    // isLikelyLoggedIn
    function isLikelyLoggedIn(postLoginIndicators: string[]): boolean {
      const path = (
        params.pathOverride ?? window.location.pathname
      ).toLowerCase();
      const onUnauthPath = unauthPathHint.test(path);
      if (
        findFirstVisible(genericUsernameSelectors) &&
        findFirstVisible(genericPasswordSelectors)
      )
        return false;
      if (findFirstVisible(genericOtpSelectors)) return false;
      if (hasCaptchaOrChallenge()) return false;

      for (const indicator of postLoginIndicators) {
        try {
          const textMatch = indicator.match(/^text=\/(.+)\/([a-z]*)$/i);
          if (textMatch) {
            const regex = new RegExp(textMatch[1] ?? "", textMatch[2] ?? "");
            if (regex.test(document.body.textContent ?? "")) return true;
            continue;
          }
          const el = document.querySelector(indicator);
          if (el && isVisible(el)) return true;
        } catch {
          // Ignore
        }
      }

      if (findVisibleLogoutTrigger()) return true;
      if (findVisibleLoginTrigger()) return false;
      if (onUnauthPath) return false;
      if (authPathHint.test(path)) return true;
      if (hasAfterSubmissionNeutralPage(path)) return true;
      return false;
    }

    // hasCaptchaOrChallenge — mirrors src/content/login.ts. This runs inside
    // page.evaluate, so it cannot import the real implementation; keep the two
    // in sync when changing either.
    function isCaptchaNoise(el: Element): boolean {
      if (el.closest(".grecaptcha-badge, #g-recaptcha-response") !== null) {
        return true;
      }
      return (el.getAttribute("id") ?? "").startsWith("g-recaptcha-response");
    }

    function isVisiblyRendered(el: Element, minSize = 1): boolean {
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < minSize || rect.height < minSize) return false;
      if (rect.right <= 0 || rect.bottom <= 0) return false;
      if (rect.left >= window.innerWidth || rect.top >= window.innerHeight) {
        return false;
      }
      return true;
    }

    function hasVisibleChallengeElement(
      selectors: string[],
      minSize?: number,
    ): boolean {
      return selectors.some((selector) => {
        try {
          return Array.from(document.querySelectorAll(selector)).some(
            (el) => !isCaptchaNoise(el) && isVisiblyRendered(el, minSize),
          );
        } catch {
          return false;
        }
      });
    }

    function hasCaptchaOrChallenge(): boolean {
      const specific = [
        'iframe[src*="recaptcha"]',
        'iframe[title*="reCAPTCHA"]',
        ".g-recaptcha",
        'iframe[src*="hcaptcha"]',
        ".h-captcha",
        'iframe[src*="turnstile"]',
        ".cf-turnstile",
        "#challenge-form",
        "#cf-challenge-running",
        'iframe[title*="challenge"]',
      ];
      if (hasVisibleChallengeElement(specific)) return true;
      if (hasVisibleChallengeElement(['[id*="captcha"]', '[class*="captcha"]'], 40)) {
        return true;
      }
      if (
        /just a moment|attention required|einen moment|checking your browser/i.test(
          document.title,
        )
      ) {
        return (
          document.querySelector(
            '#challenge-form, #cf-challenge-running, [id^="cf-"], script[src*="challenges.cloudflare.com"]',
          ) !== null
        );
      }
      return false;
    }

    const usernameEl = findFirstVisible(params.usernameSelectors);
    const passwordEl = findFirstVisible(params.passwordSelectors);
    const otpEl = findFirstVisible(params.otpSelectors);

    return {
      isLoggedIn: isLikelyLoggedIn(params.postLoginIndicators),
      hasCaptcha: hasCaptchaOrChallenge(),
      hasLoginForm: !!(usernameEl && passwordEl),
      hasOtpField: !!otpEl,
    };
  }, params);
}

// Default selectors used across tests
const DEFAULT_SELECTORS = {
  usernameSelectors: [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
  ],
  passwordSelectors: ['input[type="password"]', 'input[name="password"]'],
  otpSelectors: [
    'input[name="otp"]',
    'input[name="code"]',
    'input[autocomplete="one-time-code"]',
  ],
};

// ─── Login form detection ────────────────────────────────────────────────────

test.describe("Login form detection", () => {
  test("detects visible login form with email + password", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" name="email" placeholder="Email" style="width:200px;height:30px;" />
          <input type="password" name="password" placeholder="Password" style="width:200px;height:30px;" />
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ["text=/dashboard/i"],
    });

    expect(result.hasLoginForm).toBe(true);
    expect(result.isLoggedIn).toBe(false);
  });

  test("does NOT detect hidden login form", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form style="display:none;">
          <input type="email" name="email" />
          <input type="password" name="password" />
          <button type="submit">Log in</button>
        </form>
        <div>Dashboard content</div>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ["text=/dashboard/i"],
    });

    expect(result.hasLoginForm).toBe(false);
    expect(result.isLoggedIn).toBe(true);
  });

  test("does NOT trust /overview path when a visible login form is present", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <h1>Mintos overview</h1>
        <form>
          <input type="email" name="email" placeholder="Email" style="width:200px;height:30px;" />
          <input type="password" name="password" placeholder="Password" style="width:200px;height:30px;" />
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      pathOverride: "/en/overview/",
      postLoginIndicators: ["text=/portfolio|overview/i"],
    });

    expect(result.hasLoginForm).toBe(true);
    expect(result.isLoggedIn).toBe(false);
  });

  test("detects login form with username (not email) field", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="text" name="username" style="width:200px;height:30px;" />
          <input type="password" name="password" style="width:200px;height:30px;" />
          <button type="submit">Sign in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasLoginForm).toBe(true);
  });

  test("no login form when only password field (no username)", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="password" name="password" style="width:200px;height:30px;" />
          <button type="submit">Unlock</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasLoginForm).toBe(false);
  });
});

// ─── Post-login detection ────────────────────────────────────────────────────

test.describe("Post-login detection", () => {
  test("detects post-login via text indicator (regex)", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <nav>Menu</nav>
        <h1>Portfolio Overview</h1>
        <div class="portfolio-value">€12,345.00</div>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ["text=/portfolio[-\\s]?value|portfolio overview/i"],
    });

    expect(result.isLoggedIn).toBe(true);
  });

  test("detects post-login via CSS selector indicator", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <div data-test="mintos-balance" style="width:100px;height:20px;">€5,000</div>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ['[data-test="mintos-balance"]'],
    });

    expect(result.isLoggedIn).toBe(true);
  });

  test("NOT logged in when indicator element is hidden", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <div data-test="mintos-balance" style="display:none;">€5,000</div>
        <form>
          <input type="email" style="width:200px;height:30px;" />
          <input type="password" style="width:200px;height:30px;" />
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ['[data-test="mintos-balance"]'],
    });

    expect(result.isLoggedIn).toBe(false);
  });

  test("detects post-login with multiple text patterns (any match)", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <h1>Dashboard</h1>
        <div>Available Funds: €200</div>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [
        "text=/portfolio[-\\s]?value/i",
        "text=/available funds|available cash/i",
      ],
    });

    expect(result.isLoggedIn).toBe(true);
  });

  test("detects Income-style transfer page via visible logout trigger", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <nav><a href="/logout">Log out</a></nav>
        <main><h1>Transfer</h1><p>${"Account workspace ".repeat(12)}</p></main>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ["text=/portfolio|overview|dashboard/i"],
      entryUrl: "https://getincome.com/login",
      pathOverride: "/transfer",
    });

    expect(result.isLoggedIn).toBe(true);
  });

  test("accepts neutral post-submit page only with afterSubmission", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <main><h1>Transfer</h1><p>${"Account workspace ".repeat(12)}</p></main>
      </body></html>
    `,
    );

    const withoutFlag = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
      entryUrl: "https://getincome.com/login",
      pathOverride: "/transfer",
    });
    const withFlag = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
      afterSubmission: true,
      entryUrl: "https://getincome.com/login",
      pathOverride: "/transfer",
    });

    expect(withoutFlag.isLoggedIn).toBe(false);
    expect(withFlag.isLoggedIn).toBe(true);
  });

  test("keeps visible login form as a negative post-submit signal", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" name="email" style="width:200px;height:30px;" />
          <input type="password" name="password" style="width:200px;height:30px;" />
          <button type="submit">Log in</button>
        </form>
        <p>${"Account workspace ".repeat(12)}</p>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
      afterSubmission: true,
      entryUrl: "https://getincome.com/login",
      pathOverride: "/transfer",
    });

    expect(result.isLoggedIn).toBe(false);
  });
});

// ─── Captcha detection ───────────────────────────────────────────────────────

test.describe("Captcha detection", () => {
  test("detects reCAPTCHA iframe", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" style="width:200px;height:30px;" />
          <input type="password" style="width:200px;height:30px;" />
          <iframe src="https://www.google.com/recaptcha/api/anchor" style="width:300px;height:80px;"></iframe>
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasCaptcha).toBe(true);
  });

  test("detects g-recaptcha div", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" style="width:200px;height:30px;" />
          <input type="password" style="width:200px;height:30px;" />
          <div class="g-recaptcha" style="width:300px;height:80px;"></div>
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasCaptcha).toBe(true);
  });

  test("detects generic captcha element by ID", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" style="width:200px;height:30px;" />
          <input type="password" style="width:200px;height:30px;" />
          <div id="captcha-container" style="width:300px;height:80px;">Enter captcha</div>
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasCaptcha).toBe(true);
  });

  test("no captcha when element is hidden", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" style="width:200px;height:30px;" />
          <input type="password" style="width:200px;height:30px;" />
          <div id="captcha-container" style="display:none;">Enter captcha</div>
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasCaptcha).toBe(false);
  });

  test("no captcha on clean login page", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" style="width:200px;height:30px;" />
          <input type="password" style="width:200px;height:30px;" />
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasCaptcha).toBe(false);
  });
});

// ─── 2FA / OTP detection ────────────────────────────────────────────────────

test.describe("2FA / OTP detection", () => {
  test('detects OTP field by name="otp"', async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <h2>Two-Factor Authentication</h2>
        <form>
          <label>Enter your OTP code:</label>
          <input type="text" name="otp" style="width:200px;height:30px;" />
          <button type="submit">Verify</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasOtpField).toBe(true);
    expect(result.hasLoginForm).toBe(false);
  });

  test('detects OTP field by autocomplete="one-time-code"', async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="text" autocomplete="one-time-code" style="width:200px;height:30px;" />
          <button type="submit">Submit</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasOtpField).toBe(true);
  });

  test('detects OTP field by name="code"', async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="text" name="code" style="width:200px;height:30px;" />
          <button type="submit">Submit code</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasOtpField).toBe(true);
  });

  test("no OTP field on standard login page", async ({ page }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" style="width:200px;height:30px;" />
          <input type="password" style="width:200px;height:30px;" />
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: [],
    });

    expect(result.hasOtpField).toBe(false);
  });
});

// ─── Combined state scenarios ────────────────────────────────────────────────

test.describe("Combined login state scenarios", () => {
  test("dashboard page: logged in, no captcha, no login form", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <nav>Profile | Settings | Logout</nav>
        <h1>Portfolio Overview</h1>
        <div class="portfolio-value" style="width:200px;height:30px;">€12,345.00</div>
        <div>Available Funds: €500.00</div>
        <div>Net Annual Return: 8.5%</div>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ["text=/portfolio/i", ".portfolio-value"],
    });

    expect(result.isLoggedIn).toBe(true);
    expect(result.hasCaptcha).toBe(false);
    expect(result.hasLoginForm).toBe(false);
    expect(result.hasOtpField).toBe(false);
  });

  test("login page with captcha: not logged in, captcha present", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <form>
          <input type="email" name="email" style="width:200px;height:30px;" />
          <input type="password" name="password" style="width:200px;height:30px;" />
          <div class="g-recaptcha" style="width:300px;height:80px;">Verify you're human</div>
          <button type="submit">Log in</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ["text=/portfolio/i"],
    });

    expect(result.isLoggedIn).toBe(false);
    expect(result.hasCaptcha).toBe(true);
    expect(result.hasLoginForm).toBe(true);
  });

  test("2FA page after login: no login form, has OTP field", async ({
    page,
  }) => {
    await setPageContent(
      page,
      `
      <html><body>
        <h2>Verify your identity</h2>
        <p>We sent a code to your phone.</p>
        <form>
          <input type="text" name="otp" placeholder="6-digit code" style="width:200px;height:30px;" />
          <button type="submit">Verify</button>
        </form>
      </body></html>
    `,
    );

    const result = await evaluateLoginState(page, {
      ...DEFAULT_SELECTORS,
      postLoginIndicators: ["text=/portfolio/i"],
    });

    expect(result.isLoggedIn).toBe(false);
    expect(result.hasLoginForm).toBe(false);
    expect(result.hasOtpField).toBe(true);
  });
});

// ─── Login form detection on synthetic dashboard fixtures ────────────────────

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { dashboardFixture } from "../fixtures/platform-html-bundle.js";

const __dirname_fix = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(
  __dirname_fix,
  "../../src/shared/platforms/platform-catalog.json",
);
const catalog: Array<{
  id: string;
  name: string;
  login: { postLoginIndicators: string[] };
}> = JSON.parse(readFileSync(catalogPath, "utf-8"));

const PLATFORM_FIXTURES = [
  "mintos",
  "peerberry",
  "estateguru",
  "debitum",
  "income_marketplace",
  "indemo",
  "triple_dragon",
];

test.describe("Synthetic fixture post-login detection", () => {
  for (const platformId of PLATFORM_FIXTURES) {
    const entry = catalog.find((p) => p.id === platformId);
    if (!entry) continue;

    test(`${entry.name}: dashboard fixture is detected as logged in`, async ({
      page,
    }) => {
      await setPageContent(page, dashboardFixture(platformId as never).html);

      const result = await evaluateLoginState(page, {
        ...DEFAULT_SELECTORS,
        postLoginIndicators: entry.login.postLoginIndicators,
      });

      // Dashboard fixtures should be detected as post-login state
      expect(result.isLoggedIn).toBe(true);
    });
  }
});
