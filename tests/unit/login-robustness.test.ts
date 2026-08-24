import { describe, it, expect, afterEach } from "vitest";
import {
  checkLoginState,
  detectCredentialError,
  hasCaptchaOrChallenge,
} from "../../src/content/login.js";

function setBody(html: string): void {
  document.body.replaceChildren(
    document.createRange().createContextualFragment(html),
  );
}

/**
 * happy-dom has no layout engine — every getBoundingClientRect() is all-zero,
 * which `isVisiblyRendered` treats as "unknown". Stub a real box so the
 * geometry checks are actually exercised.
 */
function setRect(
  selector: string,
  box: { left: number; top: number; width: number; height: number },
): void {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`No element for selector ${selector}`);
  (el as Element & { getBoundingClientRect: () => DOMRect }).getBoundingClientRect =
    () =>
      ({
        x: box.left,
        y: box.top,
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON: () => ({}),
      }) as DOMRect;
}

/**
 * Give <html> a viewport-sized box so `isVisiblyRendered` believes a layout
 * engine is present and applies its geometry rules to all-zero element rects.
 */
function simulateLayoutEngine(): void {
  const root = document.documentElement as Element & {
    getBoundingClientRect: () => DOMRect;
  };
  root.getBoundingClientRect = () =>
    ({
      x: 0, y: 0, left: 0, top: 0,
      width: window.innerWidth, height: window.innerHeight,
      right: window.innerWidth, bottom: window.innerHeight,
      toJSON: () => ({}),
    }) as DOMRect;
}

const LOGIN_FORM_HTML = `
  <form>
    <input type="email" name="email" />
    <input type="password" name="password" />
    <button type="submit">Log in</button>
  </form>
`;

afterEach(() => {
  document.body.replaceChildren();
  document.title = "";
  // simulateLayoutEngine() sets an own property; fall back to the prototype.
  delete (document.documentElement as Partial<Element>).getBoundingClientRect;
});

describe("detectCredentialError", () => {
  it("detects an English invalid-password banner", () => {
    setBody(`
      ${LOGIN_FORM_HTML}
      <div role="alert">Invalid email or password.</div>
    `);
    expect(detectCredentialError()).toBe(true);
  });

  it("detects a German banner", () => {
    setBody(`
      ${LOGIN_FORM_HTML}
      <div class="error-message">Anmeldung fehlgeschlagen</div>
    `);
    expect(detectCredentialError()).toBe(true);
  });

  it("ignores unrelated alerts", () => {
    setBody(`
      ${LOGIN_FORM_HTML}
      <div role="alert">Cookie preferences updated</div>
    `);
    expect(detectCredentialError()).toBe(false);
  });
});

describe("checkLoginState credentialError", () => {
  it("flags credentialError when a login form + error banner are present", () => {
    setBody(`
      ${LOGIN_FORM_HTML}
      <div role="alert">These credentials do not match our records.</div>
    `);
    const result = checkLoginState([], [], [], []);
    expect(result.success).toBe(false);
    expect(result.credentialError).toBe(true);
  });

  it("does not flag credentialError without a visible login form", () => {
    setBody(`<div role="alert">Invalid password</div>`);
    const result = checkLoginState([], [], [], []);
    expect(result.credentialError).toBeUndefined();
  });
});

describe("hasCaptchaOrChallenge", () => {
  it("detects hCaptcha", () => {
    setBody(`<div class="h-captcha"></div>`);
    expect(hasCaptchaOrChallenge()).toBe(true);
  });

  it("detects Cloudflare Turnstile", () => {
    setBody(`<div class="cf-turnstile"></div>`);
    expect(hasCaptchaOrChallenge()).toBe(true);
  });

  it("detects a Cloudflare interstitial by title + DOM signal", () => {
    document.title = "Just a moment...";
    setBody(`<form id="challenge-form"></form>`);
    expect(hasCaptchaOrChallenge()).toBe(true);
  });

  it("does not trigger on the interstitial title alone", () => {
    document.title = "Just a moment with our team";
    setBody(`<p>Marketing copy</p>`);
    expect(hasCaptchaOrChallenge()).toBe(false);
  });

  it("returns false on a plain page", () => {
    setBody(`<p>Dashboard</p>`);
    expect(hasCaptchaOrChallenge()).toBe(false);
  });

  // Regression: Mintos (and every site on invisible reCAPTCHA v3/Enterprise)
  // ships these nodes on *every* page including the authenticated overview.
  it("ignores the off-screen invisible-reCAPTCHA badge", () => {
    setBody(`<div class="grecaptcha-badge"><iframe title="reCAPTCHA"></iframe></div>`);
    setRect(".grecaptcha-badge", { left: -186, top: 200, width: 256, height: 60 });
    setRect("iframe", { left: -186, top: 200, width: 256, height: 60 });
    expect(hasCaptchaOrChallenge()).toBe(false);
  });

  it("ignores the hidden g-recaptcha-response token field", () => {
    setBody(`<textarea id="g-recaptcha-response-1"></textarea>`);
    expect(hasCaptchaOrChallenge()).toBe(false);
  });

  it("ignores a zero-sized captcha placeholder wrapper", () => {
    setBody(`<div class="js-captcha-container"></div>`);
    setRect(".js-captcha-container", { left: 10, top: 10, width: 0, height: 0 });
    expect(hasCaptchaOrChallenge()).toBe(false);
  });

  // An all-zero rect is ambiguous: it is what happy-dom reports for everything,
  // but in a browser it means a genuinely zero-sized element at the origin.
  // With a layout engine present, it must be treated as invisible.
  it("ignores a zero-sized captcha wrapper sitting at the origin", () => {
    simulateLayoutEngine();
    setBody(`<div class="captcha-slot"></div>`);
    setRect(".captcha-slot", { left: 0, top: 0, width: 0, height: 0 });
    expect(hasCaptchaOrChallenge()).toBe(false);
  });

  it("ignores a captcha wrapper that is too small to be a challenge", () => {
    setBody(`<div class="captcha-placeholder"></div>`);
    setRect(".captcha-placeholder", { left: 10, top: 10, width: 8, height: 8 });
    expect(hasCaptchaOrChallenge()).toBe(false);
  });

  it("still detects a full-size visible challenge widget", () => {
    setBody(`<div class="h-captcha"></div>`);
    setRect(".h-captcha", { left: 20, top: 40, width: 304, height: 78 });
    expect(hasCaptchaOrChallenge()).toBe(true);
  });

  it("looks past a hidden first match to find a visible second one", () => {
    setBody(`
      <div class="grecaptcha-badge"></div>
      <div class="captcha-challenge"></div>
    `);
    setRect(".grecaptcha-badge", { left: -186, top: 200, width: 256, height: 60 });
    setRect(".captcha-challenge", { left: 20, top: 40, width: 304, height: 78 });
    expect(hasCaptchaOrChallenge()).toBe(true);
  });
});

describe("checkLoginState captcha vs. login signal", () => {
  it("reports loggedIn when a post-login indicator is visible despite captcha nodes", () => {
    setBody(`
      <div class="grecaptcha-badge"></div>
      <div data-test="mintos-balance">1.234,56 €</div>
    `);
    const result = checkLoginState(['[data-test="mintos-balance"]'], [], [], []);
    expect(result.requiresCaptcha).toBe(false);
    expect(result.success).toBe(true);
  });

  it("still reports a captcha when only a loose text indicator matches", () => {
    setBody(`
      <div class="h-captcha"></div>
      <p>Your portfolio is temporarily unavailable</p>
    `);
    setRect(".h-captcha", { left: 20, top: 40, width: 304, height: 78 });
    const result = checkLoginState(["text=/portfolio/i"], [], [], []);
    expect(result.requiresCaptcha).toBe(true);
    expect(result.success).toBe(false);
  });
});
