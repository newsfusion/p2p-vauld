/**
 * Login form handling — runs in the content script (P2P platform tab context).
 * Uses native DOM APIs. No external dependencies.
 */

import { describeElement } from "../shared/describe-element.js";
import type { DetectLoginFieldsResponse } from "../shared/messages.js";
import type {
  LearnedLoginSelectorMap,
  LoginFieldRole,
  LoginSelectorMap,
} from "../shared/types/index.js";
import {
  isRenderableElement,
  isUsableFormElement,
  isVisiblyRendered,
} from "./visibility.js";
import { generateStableLoginSelectors } from "./login-selectors.js";
import { createLogger } from "../shared/logger.js";
import { getErrorMessage } from "../shared/error-utils.js";

const log = createLogger("login");

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;
const LOGIN_FIELD_POLL_INTERVAL_MS = 100;
const LOGIN_FIELD_TIMEOUT_MS = 5_000;
const INLINE_LOGIN_FIELD_TIMEOUT_MS = 3_000;
const LOGIN_TRIGGER_CLICK_DELAY_MS = 50;
const STEALTH_FOCUS_DELAY_MS = [80, 180] as const;
const STEALTH_KEY_DELAY_MS = [50, 100] as const;
const STEALTH_FIELD_DELAY_MS = [150, 350] as const;
const STEALTH_SUBMIT_DELAY_MS = [200, 500] as const;
const GENERIC_USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[name="username"]',
  'input[autocomplete="username"]',
];
const GENERIC_PASSWORD_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[autocomplete="current-password"]',
];
const GENERIC_OTP_SELECTORS = [
  'input[name="otp"]',
  'input[name="code"]',
  'input[autocomplete="one-time-code"]',
];
const GENERIC_SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  'form button',
];
const LOGIN_TRIGGER_SELECTORS = [
  "a[href]",
  "button",
  'input[type="button"]',
  'input[type="submit"]',
  '[role="button"]',
];
const LOGIN_TRIGGER_TEXT_PATTERN =
  /\b(log\s*in|login|sign\s*in|signin)\b|anmeld|einlogg/i;
const NON_LOGIN_TRIGGER_TEXT_PATTERN =
  /\b(log\s*out|logout|sign\s*out|signout|register|sign\s*up|signup|join|create account)\b|abmeld|registrier|konto erstellen/i;
const LOGOUT_TRIGGER_TEXT_PATTERN =
  /\b(log\s*out|logout|sign\s*out|signout)\b|abmeld|auslogg/i;
const LOGOUT_HREF_PATTERN = /\/(logout|sign-?out|abmelden)(\/|$|\?)/i;

function mergeSelectors(
  primary: string[] | undefined,
  fallback: string[],
): string[] {
  return [...new Set([...(primary ?? []), ...fallback])];
}

function selectorsForRole(
  cached: LoginSelectorMap | undefined,
  role: LoginFieldRole,
  platformSelectors: string[],
  genericSelectors: string[],
): string[] {
  return mergeSelectors(
    cached?.[role],
    mergeSelectors(platformSelectors, genericSelectors),
  );
}

function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Element finders ──────────────────────────────────────────────────────────

function findFirstVisible(selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const els = document.querySelectorAll(selector);
      for (const el of Array.from(els)) {
        if (isVisible(el)) return el;
      }
    } catch {
      // Invalid selector — skip
    }
  }
  return null;
}

export function isVisible(el: Element): boolean {
  return isUsableFormElement(el);
}

function findVisibleFields(selectors: string[]): Element[] {
  return findVisibleFieldsWithin(document, selectors);
}

function findVisibleFieldsWithin(root: ParentNode, selectors: string[]): Element[] {
  const found: Element[] = [];
  const seen = new Set<Element>();

  for (const selector of selectors) {
    try {
      const els = root.querySelectorAll(selector);
      for (const el of Array.from(els)) {
        if (!seen.has(el) && isVisible(el)) {
          seen.add(el);
          found.push(el);
        }
      }
    } catch {
      // Invalid selector — skip
    }
  }

  return found;
}

function findLoginField(
  role: "username" | "password" | "submit" | "otp",
  fallbackSelectors: string[],
): Element | null {
  const aiTagged = document.querySelectorAll(`[data-p2p-field="${role}"]`);
  for (const el of Array.from(aiTagged)) {
    if (isVisible(el)) {
      log.debug(`Found ${role} via AI tag`, { selector: `[data-p2p-field="${role}"]` });
      return el;
    }
  }
  const el = findFirstVisible(fallbackSelectors);
  if (el) {
    log.debug(`Found ${role} via selector fallback`);
  } else {
    log.debug(`${role} field not found`);
  }
  return el;
}

function findLoginFields(
  role: "username" | "password",
  fallbackSelectors: string[],
): Element[] {
  const aiTagged = findVisibleFields([`[data-p2p-field="${role}"]`]);
  if (aiTagged.length > 0) {
    log.debug(`Found ${role} via AI tag`, {
      selector: `[data-p2p-field="${role}"]`,
    });
    return aiTagged;
  }

  const fields = findVisibleFields(fallbackSelectors);
  if (fields.length > 0) {
    log.debug(`Found ${role} via selector fallback`, { count: fields.length });
  } else {
    log.debug(`${role} field not found`);
  }
  return fields;
}

function findScopedLoginFields(
  role: "username" | "password",
  fallbackSelectors: string[],
  scope: Element,
): Element[] {
  const aiTagged = findVisibleFieldsWithin(scope, [`[data-p2p-field="${role}"]`]);
  if (aiTagged.length > 0) return aiTagged;

  return findVisibleFieldsWithin(scope, fallbackSelectors);
}

function getCredentialScope(el: Element): Element | null {
  return (
    el.closest("form") ??
    el.closest("dialog,[role=\"dialog\"],[aria-modal=\"true\"]")
  );
}

function areCredentialFieldsPaired(
  usernameEl: Element,
  passwordEl: Element,
): boolean {
  const passwordScope = getCredentialScope(passwordEl);
  if (passwordScope) return passwordScope.contains(usernameEl);

  const usernameScope = getCredentialScope(usernameEl);
  if (usernameScope) return usernameScope.contains(passwordEl);

  return (
    usernameEl.parentElement !== null &&
    usernameEl.parentElement === passwordEl.parentElement
  );
}

function getLoginTriggerText(el: Element): string {
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

function isLoginTriggerCandidate(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (!isRenderableElement(el, { requireEnabled: true })) return false;

  const text = getLoginTriggerText(el);
  if (!LOGIN_TRIGGER_TEXT_PATTERN.test(text)) return false;
  if (NON_LOGIN_TRIGGER_TEXT_PATTERN.test(text)) return false;

  return true;
}

function findVisibleLoginTrigger(): HTMLElement | null {
  for (const selector of LOGIN_TRIGGER_SELECTORS) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of Array.from(elements)) {
        if (isLoginTriggerCandidate(el)) {
          log.debug("Found login navigation trigger", {
            text: getLoginTriggerText(el),
          });
          return el;
        }
      }
    } catch {
      // Invalid selector — skip
    }
  }
  return null;
}

const LOGOUT_TRIGGER_SELECTORS = [
  "a[href]",
  "button",
  '[role="button"]',
  '[role="link"]',
];

/**
 * Finds a logout control. With `requireVisible: false` a control hidden inside a
 * collapsed mobile menu still counts — that is a weaker but still meaningful
 * signal that the page was rendered for an authenticated user.
 */
function findLogoutTrigger(
  options: { requireVisible?: boolean } = {},
): HTMLElement | null {
  const requireVisible = options.requireVisible ?? true;
  for (const selector of LOGOUT_TRIGGER_SELECTORS) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of Array.from(elements)) {
        if (!(el instanceof HTMLElement)) continue;
        if (requireVisible && !isRenderableElement(el, { requireEnabled: true })) {
          continue;
        }
        const text = getLoginTriggerText(el);
        const href =
          el instanceof HTMLAnchorElement ? el.getAttribute("href") ?? "" : "";
        if (LOGOUT_TRIGGER_TEXT_PATTERN.test(text) || LOGOUT_HREF_PATTERN.test(href)) {
          log.debug("Found logout navigation trigger", { text, requireVisible });
          return el;
        }
      }
    } catch {
      // Invalid selector — skip
    }
  }
  return null;
}

function findVisibleLogoutTrigger(): HTMLElement | null {
  return findLogoutTrigger({ requireVisible: true });
}

function clickLoginTriggerAfterResponse(triggerEl: HTMLElement): void {
  window.setTimeout(() => {
    triggerEl.click();
  }, LOGIN_TRIGGER_CLICK_DELAY_MS);
}

function isLikelyNavigationTrigger(triggerEl: HTMLElement): boolean {
  if (triggerEl instanceof HTMLAnchorElement) {
    const href = triggerEl.getAttribute("href");
    return !!href && href !== "#" && !href.startsWith("javascript:");
  }

  if (triggerEl instanceof HTMLInputElement) {
    return triggerEl.type === "submit";
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findLoginCredentials(
  usernameSelectors: string[],
  passwordSelectors: string[],
): {
  usernameEl: HTMLInputElement | null;
  passwordEl: HTMLInputElement | null;
} {
  const usernameFields = findLoginFields("username", usernameSelectors);
  const passwordFields = findLoginFields("password", passwordSelectors);

  for (const passwordEl of passwordFields) {
    const passwordScope = getCredentialScope(passwordEl);
    const usernameEl =
      passwordScope
        ? findScopedLoginFields("username", usernameSelectors, passwordScope)[0]
        : usernameFields.find((candidate) =>
            areCredentialFieldsPaired(candidate, passwordEl),
          );
    if (usernameEl) {
      return {
        usernameEl: usernameEl as HTMLInputElement,
        passwordEl: passwordEl as HTMLInputElement,
      };
    }
  }

  return {
    usernameEl: (usernameFields[0] ?? null) as HTMLInputElement | null,
    passwordEl: (passwordFields[0] ?? null) as HTMLInputElement | null,
  };
}

async function waitForLoginCredentials(
  usernameSelectors: string[],
  passwordSelectors: string[],
  timeoutMs = LOGIN_FIELD_TIMEOUT_MS,
): Promise<{
  usernameEl: HTMLInputElement | null;
  passwordEl: HTMLInputElement | null;
}> {
  let fields = findLoginCredentials(usernameSelectors, passwordSelectors);
  if (fields.usernameEl && fields.passwordEl) {
    return fields;
  }

  const deadline = Date.now() + timeoutMs;
  log.debug("Login fields missing on first pass, waiting for SPA render");

  while (Date.now() < deadline) {
    await sleep(LOGIN_FIELD_POLL_INTERVAL_MS);
    fields = findLoginCredentials(usernameSelectors, passwordSelectors);
    if (fields.usernameEl && fields.passwordEl) {
      log.debug("Login fields appeared after wait");
      return fields;
    }
  }

  return fields;
}

function selectorMatchesElement(selector: string, el: Element): boolean {
  try {
    return Array.from(document.querySelectorAll(selector)).includes(el);
  } catch {
    return false;
  }
}

function selectorFindsElement(selector: string): boolean {
  try {
    return document.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

function usedCachedRoles(
  cachedLoginSelectors: LoginSelectorMap | undefined,
  elements: Partial<Record<LoginFieldRole, Element | null | undefined>>,
): LoginFieldRole[] {
  if (!cachedLoginSelectors) return [];
  const roles: LoginFieldRole[] = [];
  for (const role of ["username", "password", "submit", "otp"] as const) {
    const el = elements[role];
    const selectors = cachedLoginSelectors[role] ?? [];
    if (el && selectors.some((selector) => selectorMatchesElement(selector, el))) {
      roles.push(role);
    }
  }
  return roles;
}

function staleCachedRoles(
  cachedLoginSelectors: LoginSelectorMap | undefined,
): LoginFieldRole[] {
  if (!cachedLoginSelectors) return [];
  const roles: LoginFieldRole[] = [];
  for (const role of ["username", "password", "submit", "otp"] as const) {
    const selectors = cachedLoginSelectors[role] ?? [];
    if (
      selectors.length > 0 &&
      !selectors.some((selector) => selectorFindsElement(selector))
    ) {
      roles.push(role);
    }
  }
  return roles;
}

async function defaultDetectLoginFields(): Promise<DetectLoginFieldsResponse> {
  const { detectLoginFields } = await import("./ai-login.js");
  return detectLoginFields(document);
}

async function detectLoginCredentials(
  detector: NonNullable<LoginParams["detectLoginFields"]>,
): Promise<{
  usernameEl: HTMLInputElement | null;
  passwordEl: HTMLInputElement | null;
  learnedLoginSelectors?: LearnedLoginSelectorMap;
}> {
  const detection = await detector(document);
  if (!detection.detected) {
    return { usernameEl: null, passwordEl: null };
  }

  const usernameEl = findLoginField("username", []) as HTMLInputElement | null;
  const passwordEl = findLoginField("password", []) as HTMLInputElement | null;
  const submitEl = findLoginField("submit", []) as HTMLElement | null;
  const otpEl = findLoginField("otp", []) as HTMLInputElement | null;
  const generatedSelectors = generateStableLoginSelectors({
    username: usernameEl,
    password: passwordEl,
    submit: submitEl,
    otp: otpEl,
  });
  const learnedLoginSelectors = {
    ...generatedSelectors,
    ...(detection.stableSelectors ?? {}),
  };

  return {
    usernameEl,
    passwordEl,
    ...(Object.keys(learnedLoginSelectors).length > 0
      ? { learnedLoginSelectors }
      : {}),
  };
}

// ─── Input filling ────────────────────────────────────────────────────────────

function setInputValue(el: HTMLInputElement, value: string): void {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }
}

function dispatchInputEvent(
  el: HTMLInputElement,
  data: string | null,
  inputType: "deleteContentBackward" | "insertText",
): void {
  const event =
    typeof InputEvent === "function"
      ? new InputEvent("input", {
          bubbles: true,
          data,
          inputType,
        })
      : new Event("input", { bubbles: true });
  el.dispatchEvent(event);
}

function fillInputNative(
  el: HTMLInputElement,
  value: string,
): void {
  log.debug("Filling input via native setter", { id: el.id, name: el.name });
  el.focus();
  setInputValue(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

async function typeWithDelay(
  el: HTMLInputElement,
  value: string,
): Promise<void> {
  log.debug("Typing input with stealth pacing", { id: el.id, name: el.name });
  el.focus();
  await randomDelay(...STEALTH_FOCUS_DELAY_MS);

  setInputValue(el, "");
  dispatchInputEvent(el, null, "deleteContentBackward");

  let typedValue = "";
  for (const character of Array.from(value)) {
    typedValue += character;
    setInputValue(el, typedValue);
    dispatchInputEvent(el, character, "insertText");
    await randomDelay(...STEALTH_KEY_DELAY_MS);
  }

  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.blur();
}

function findOwningForm(
  submitEl: HTMLElement | null,
  fallbackField: HTMLElement,
): HTMLFormElement | null {
  return submitEl?.closest("form") ?? fallbackField.closest("form");
}

function asSubmitter(
  submitEl: HTMLElement | null,
): HTMLButtonElement | HTMLInputElement | undefined {
  if (
    submitEl instanceof HTMLButtonElement ||
    submitEl instanceof HTMLInputElement
  ) {
    return submitEl;
  }
  return undefined;
}

function submitViaForm(
  form: HTMLFormElement,
  submitter?: HTMLButtonElement | HTMLInputElement,
): boolean {
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit(submitter);
    return true;
  }

  const submitEvent =
    typeof SubmitEvent === "function"
      ? new SubmitEvent("submit", {
          bubbles: true,
          cancelable: true,
          ...(submitter ? { submitter } : {}),
        })
      : new Event("submit", { bubbles: true, cancelable: true });

  const notCancelled = form.dispatchEvent(submitEvent);
  if (notCancelled) {
    form.submit();
  }
  return true;
}

function submitLoginForm(
  submitEl: HTMLElement | null,
  fallbackField: HTMLInputElement,
): void {
  if (submitEl) {
    log.debug("Submitting via button click");
    submitEl.click();
    return;
  }

  const form = findOwningForm(submitEl, fallbackField);
  const submitter = asSubmitter(submitEl);

  if (form && submitViaForm(form, submitter)) {
    log.debug("Submitted via form API", { hasSubmitter: !!submitter });
    return;
  }

  log.debug("Final fallback: clicking password field for submit");
  fallbackField.click();
}



// ─── Post-login detection ─────────────────────────────────────────────────────

const UNAUTH_PATH_HINT =
  /\/(login|sign-?in|auth|authorize|captcha|challenge|verify)(\/|$)/i;
const AUTH_PATH_HINT =
  /\/(overview|dashboard|portfolio|account|wallet|investor)(\/|$)/i;

function hasVisibleLoginForm(
  usernameSelectors: string[] = [],
  passwordSelectors: string[] = [],
): boolean {
  return !!(
    findFirstVisible(mergeSelectors(usernameSelectors, GENERIC_USERNAME_SELECTORS)) &&
    findFirstVisible(mergeSelectors(passwordSelectors, GENERIC_PASSWORD_SELECTORS))
  );
}

function hasVisibleOtpField(otpSelectors: string[] = []): boolean {
  return findFirstVisible(mergeSelectors(otpSelectors, GENERIC_OTP_SELECTORS)) !== null;
}

// Detects SPA login pages where inputs are present with the `hidden` attribute
// (e.g. Vue transition/animation state). These inputs are not visible but indicate
// the login form is present and the user is NOT logged in.
function hasLoginFormWithHiddenInputs(
  usernameSelectors: string[] = [],
  passwordSelectors: string[] = [],
): boolean {
  const allUsernames = mergeSelectors(usernameSelectors, GENERIC_USERNAME_SELECTORS);
  const allPasswords = mergeSelectors(passwordSelectors, GENERIC_PASSWORD_SELECTORS);
  for (const sel of allUsernames) {
    try {
      const el = document.querySelector(sel);
      if (el instanceof HTMLInputElement && el.hasAttribute("hidden") && el.closest("form")) {
        for (const psel of allPasswords) {
          try {
            const pel = document.querySelector(psel);
            if (pel instanceof HTMLInputElement && pel.hasAttribute("hidden")) return true;
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * True when a *selector-based* post-login indicator is visibly rendered.
 *
 * `text=/…/` indicators are deliberately excluded: they match against
 * `document.body.textContent` and would also fire on a challenge page that
 * still ships the site's normal header/footer copy.
 *
 * `strict` additionally requires the element to occupy a real box inside the
 * viewport. Only the captcha-suppression path uses it — overriding a challenge
 * signal deserves harder proof than the ordinary logged-in heuristic, which
 * keeps tolerating hydrating zero-size elements.
 */
export function hasVisiblePostLoginIndicator(
  postLoginIndicators: string[],
  options: { strict?: boolean } = {},
): boolean {
  const isAcceptable = options.strict === true ? isVisiblyRendered : isRenderableElement;
  for (const indicator of postLoginIndicators) {
    if (/^text=\//i.test(indicator)) continue;
    try {
      for (const el of Array.from(document.querySelectorAll(indicator))) {
        if (isAcceptable(el)) return true;
      }
    } catch {
      // Invalid selector — skip
    }
  }
  return false;
}

export function isLikelyLoggedIn(
  postLoginIndicators: string[],
  options: {
    usernameSelectors?: string[];
    passwordSelectors?: string[];
    otpSelectors?: string[];
    afterSubmission?: boolean;
    entryUrl?: string;
  } = {},
): boolean {
  const path = window.location.pathname.toLowerCase();
  const onUnauthPath = UNAUTH_PATH_HINT.test(path);

  // Negative auth signals win over loose text/url heuristics.
  if (
    hasVisibleLoginForm(options.usernameSelectors, options.passwordSelectors) ||
    hasLoginFormWithHiddenInputs(options.usernameSelectors, options.passwordSelectors) ||
    hasVisibleOtpField(options.otpSelectors)
  )
    return false;

  // A solidly rendered post-login indicator is authoritative — even over a
  // captcha signal, since sites like Mintos embed invisible reCAPTCHA on every
  // page including the authenticated overview.
  if (hasVisiblePostLoginIndicator(postLoginIndicators, { strict: true })) {
    return true;
  }

  if (hasCaptchaOrChallenge()) return false;

  // Below the captcha gate: the original, looser indicator check, kept so that
  // hydrating zero-size dashboards keep being recognised as logged in.
  if (hasVisiblePostLoginIndicator(postLoginIndicators)) return true;

  // text=/…/ indicators match against the whole body, so they are only weak
  // evidence and must not override the captcha check above.
  for (const indicator of postLoginIndicators) {
    const textMatch = indicator.match(/^text=\/(.+)\/([a-z]*)$/i);
    if (!textMatch) continue;
    try {
      const regex = new RegExp(textMatch[1] ?? "", textMatch[2] ?? "");
      if (regex.test(document.body.textContent ?? "")) return true;
    } catch {
      // Invalid regex — skip
    }
  }

  if (findVisibleLogoutTrigger()) return true;

  // A visible login trigger means loose URL heuristics such as /overview should
  // not be trusted, but explicit post-login indicators above remain stronger.
  if (findVisibleLoginTrigger()) return false;

  // If we're on an unauth-looking path and no positive indicators matched, not logged in
  if (onUnauthPath) return false;

  // URL path heuristics
  if (AUTH_PATH_HINT.test(path)) return true;

  if (options.afterSubmission && options.entryUrl) {
    let entryPath: string | undefined;
    try {
      entryPath = new URL(options.entryUrl, window.location.href).pathname.toLowerCase();
    } catch {
      entryPath = undefined;
    }
    const bodyText = (document.body.textContent ?? "").trim();
    if (
      entryPath &&
      path !== entryPath &&
      document.readyState === "complete" &&
      bodyText.length >= 100
    ) {
      return true;
    }
  }

  return false;
}

// ─── Authenticated-session evidence ──────────────────────────────────────────

/**
 * Paths that only make sense for a signed-in user. Deliberately excludes bare
 * "invest", which marketing pages use too.
 */
const AUTH_NAV_PATH_PATTERN =
  /\/(overview|übersicht|uebersicht|dashboard|portfolio|my-?portfolio|my-?balance|my-?account|account|konto|kontostand|deposit|withdraw|transactions|auto-?invest|wallet|loyalty|settings|einstellungen|profile)(\/|$|\?)/i;
const NON_AUTH_NAV_HREF_PATTERN =
  /\/(login|sign-?in|anmelden|register|sign-?up|registrieren|logout|sign-?out|abmelden)(\/|$|\?)/i;
const NAV_CONTAINER_SELECTOR =
  'header, nav, [role="banner"], [role="navigation"], [class*="header" i], [class*="nav" i]';
const ACCOUNT_WIDGET_SELECTOR =
  '[title*="account" i], [aria-label*="account" i], [title*="konto" i], [aria-label*="konto" i], [class*="avatar" i], [class*="user-menu" i], [data-testid*="avatar" i]';
/** Two independent weak signals, or one strong one, are enough. */
const SESSION_EVIDENCE_WEAK_THRESHOLD = 2;
const MIN_AUTH_NAV_LINKS = 2;

function countAuthenticatedNavLinks(): number {
  const origin = window.location.origin;
  const hrefs = new Set<string>();

  let containers: NodeListOf<Element>;
  try {
    containers = document.querySelectorAll(NAV_CONTAINER_SELECTOR);
  } catch {
    return 0;
  }

  for (const container of Array.from(containers)) {
    for (const el of Array.from(container.querySelectorAll("a[href]"))) {
      if (!(el instanceof HTMLAnchorElement)) continue;
      if (!isRenderableElement(el)) continue;
      let url: URL;
      try {
        url = new URL(el.getAttribute("href") ?? "", document.baseURI);
      } catch {
        continue;
      }
      if (url.origin !== origin) continue;
      if (NON_AUTH_NAV_HREF_PATTERN.test(url.pathname)) continue;
      if (!AUTH_NAV_PATH_PATTERN.test(url.pathname)) continue;
      hrefs.add(url.pathname.toLowerCase());
    }
  }

  return hrefs.size;
}

function hasAccountWidget(): boolean {
  try {
    for (const el of Array.from(
      document.querySelectorAll(ACCOUNT_WIDGET_SELECTOR),
    )) {
      if (isRenderableElement(el)) return true;
    }
  } catch {
    // Invalid selector — treat as no signal
  }
  return false;
}

/**
 * Detects that the page was rendered for an already-authenticated user, even
 * when a login form is present alongside it. Some platforms (e.g. Debitum) keep
 * serving `/login` with the full signed-in header when the session cookie is
 * still valid; submitting credentials there fails.
 *
 * Intentionally NOT wired into `isLikelyLoggedIn` — a visible login form still
 * means "do not extract here". Callers should navigate into the authenticated
 * area first and re-check.
 */
export function detectSessionEvidence(): boolean {
  if (findLogoutTrigger({ requireVisible: true })) {
    log.debug("Session evidence: visible logout control");
    return true;
  }

  let weakSignals = 0;
  const authNavLinks = countAuthenticatedNavLinks();
  if (authNavLinks >= MIN_AUTH_NAV_LINKS) weakSignals += 1;
  if (hasAccountWidget()) weakSignals += 1;
  if (findLogoutTrigger({ requireVisible: false })) weakSignals += 1;

  const detected = weakSignals >= SESSION_EVIDENCE_WEAK_THRESHOLD;
  if (detected) {
    log.debug("Session evidence detected", { authNavLinks, weakSignals });
  }
  return detected;
}

const CREDENTIAL_ERROR_CONTAINER_SELECTORS = [
  '[role="alert"]',
  ".error",
  '[class*="error"]',
  '[class*="alert"]',
  '[class*="invalid"]',
  '[class*="Error"]',
  '[class*="danger"]',
];
const CREDENTIAL_ERROR_TEXT_PATTERN =
  /(invalid|incorrect|wrong|falsch|ungültig|ungueltig)[^.]{0,40}(password|passwort|credentials|e-?mail|login|anmeldedaten|zugangsdaten)|(password|passwort|credentials|e-?mail|anmeldedaten|zugangsdaten)[^.]{0,40}(invalid|incorrect|wrong|falsch|ungültig|ungueltig)|login failed|anmeldung fehlgeschlagen|zugangsdaten[^.]{0,20}(falsch|ungültig|ungueltig)|these credentials do not match/i;

/**
 * Detects a visible "invalid credentials" error banner. Only meaningful when a
 * login form is still present — callers must gate on that to avoid false
 * positives on dashboard/marketing pages.
 */
export function detectCredentialError(): boolean {
  for (const selector of CREDENTIAL_ERROR_CONTAINER_SELECTORS) {
    let els: NodeListOf<Element>;
    try {
      els = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    for (const el of Array.from(els)) {
      if (!isRenderableElement(el)) continue;
      const text = normalizeText(el.textContent ?? "");
      if (CREDENTIAL_ERROR_TEXT_PATTERN.test(text)) {
        log.debug("Credential error banner detected", { selector });
        return true;
      }
    }
  }
  return false;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const CF_INTERSTITIAL_TITLE_PATTERN =
  /just a moment|attention required|einen moment|checking your browser/i;

/**
 * Widgets that contain "captcha" in their id/class but are never a challenge
 * the user can solve: Google's invisible-reCAPTCHA badge (parked off-screen on
 * every page of sites that use v3/Enterprise — Mintos does this site-wide) and
 * the hidden response token field.
 */
const CAPTCHA_NOISE_SELECTOR = ".grecaptcha-badge, #g-recaptcha-response";

function isCaptchaNoise(el: Element): boolean {
  if (el.closest(CAPTCHA_NOISE_SELECTOR) !== null) return true;
  const id = el.getAttribute("id") ?? "";
  return id.startsWith("g-recaptcha-response");
}

/** Selectors specific enough that mere visibility is evidence of a challenge. */
const CAPTCHA_SPECIFIC_SELECTORS = [
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

/**
 * Substring matches on id/class. These also hit empty placeholder wrappers, so
 * they additionally require the element to occupy a challenge-sized box.
 */
const CAPTCHA_LOOSE_SELECTORS = ['[id*="captcha"]', '[class*="captcha"]'];

/** A real challenge widget is never smaller than this (reCAPTCHA v2 is 304×78). */
const MIN_CAPTCHA_SIZE_PX = 40;

function hasVisibleChallengeElement(
  selectors: string[],
  minSize?: number,
): boolean {
  return selectors.some((selector) => {
    try {
      // querySelectorAll, not querySelector: a hidden first match must not mask
      // a genuinely visible second one.
      return Array.from(document.querySelectorAll(selector)).some(
        (el) =>
          !isCaptchaNoise(el) &&
          isVisiblyRendered(el, minSize === undefined ? {} : { minSize }),
      );
    } catch {
      return false;
    }
  });
}

export function hasCaptchaOrChallenge(): boolean {
  if (hasVisibleChallengeElement(CAPTCHA_SPECIFIC_SELECTORS)) return true;
  if (hasVisibleChallengeElement(CAPTCHA_LOOSE_SELECTORS, MIN_CAPTCHA_SIZE_PX)) {
    return true;
  }

  // Cloudflare interstitial: the challenge title alone is not enough (marketing
  // pages may reuse the phrase), require a Cloudflare DOM signal alongside it.
  if (CF_INTERSTITIAL_TITLE_PATTERN.test(document.title)) {
    const cfDomSignal =
      document.querySelector(
        '#challenge-form, #cf-challenge-running, [id^="cf-"], script[src*="challenges.cloudflare.com"]',
      ) !== null;
    if (cfDomSignal) return true;
  }
  return false;
}

// ─── Main login flow ──────────────────────────────────────────────────────────

export interface LoginParams {
  username: string;
  password: string;
  usernameSelectors: string[];
  passwordSelectors: string[];
  submitSelectors: string[];
  otpSelectors: string[];
  cachedLoginSelectors?: LoginSelectorMap;
  postLoginIndicators: string[];
  stealthMode: boolean;
  safeMode: boolean;
  detectLoginFields?: (
    root?: Document | Element,
  ) => Promise<DetectLoginFieldsResponse>;
}

export interface LoginResult {
  success: boolean;
  submitted: boolean;
  requires2FA: boolean;
  requiresCaptcha: boolean;
  credentialError?: boolean;
  /** Page looks rendered for a signed-in user despite the login form. */
  sessionEvidence?: boolean;
  foundElements?: {
    username?: string;
    password?: string;
    submit?: string;
    loginTrigger?: string;
  };
  learnedLoginSelectors?: LearnedLoginSelectorMap;
  usedLoginSelectorRoles?: LoginFieldRole[];
  staleLoginSelectorRoles?: LoginFieldRole[];
  loginTriggerClicked?: boolean;
  error?: string;
}

export async function performLogin(params: LoginParams): Promise<LoginResult> {
  // Already logged in?
  if (
    isLikelyLoggedIn(params.postLoginIndicators, {
      usernameSelectors: params.usernameSelectors,
      passwordSelectors: params.passwordSelectors,
      otpSelectors: params.otpSelectors,
    })
  ) {
    log.info("Already logged in, skipping login form", { url: window.location.href });
    return {
      success: true,
      submitted: false,
      requires2FA: false,
      requiresCaptcha: false,
    };
  }

  const usernameSelectors = selectorsForRole(
    params.cachedLoginSelectors,
    "username",
    params.usernameSelectors,
    GENERIC_USERNAME_SELECTORS,
  );
  const passwordSelectors = selectorsForRole(
    params.cachedLoginSelectors,
    "password",
    params.passwordSelectors,
    GENERIC_PASSWORD_SELECTORS,
  );
  const submitSelectors = selectorsForRole(
    params.cachedLoginSelectors,
    "submit",
    params.submitSelectors,
    GENERIC_SUBMIT_SELECTORS,
  );
  let learnedLoginSelectors: LearnedLoginSelectorMap | undefined;
  const openLoginTrigger = (loginTriggerEl: HTMLElement): LoginResult => {
    const loginTrigger = describeElement(loginTriggerEl);
    log.info("Login fields not found, opening login page via trigger", {
      loginTrigger,
    });
    clickLoginTriggerAfterResponse(loginTriggerEl);
    return {
      success: false,
      submitted: false,
      requires2FA: false,
      requiresCaptcha: false,
      loginTriggerClicked: true,
      foundElements: { loginTrigger },
    };
  };

  const openInlineLoginTrigger = async (
    loginTriggerEl: HTMLElement,
  ): Promise<{
    usernameEl: HTMLInputElement | null;
    passwordEl: HTMLInputElement | null;
    loginTrigger: string;
  }> => {
    const loginTrigger = describeElement(loginTriggerEl);
    log.info("Login fields not found, opening inline login popup via trigger", {
      loginTrigger,
    });
    loginTriggerEl.click();
    const fields = await waitForLoginCredentials(
      usernameSelectors,
      passwordSelectors,
      INLINE_LOGIN_FIELD_TIMEOUT_MS,
    );
    return { ...fields, loginTrigger };
  };

  // Find login form elements (AI-tagged first, then selector fallback)
  let { usernameEl, passwordEl } = findLoginCredentials(
    usernameSelectors,
    passwordSelectors,
  );

  if (!usernameEl || !passwordEl) {
    const loginTriggerEl = findVisibleLoginTrigger();
    if (loginTriggerEl) {
      if (isLikelyNavigationTrigger(loginTriggerEl)) {
        return openLoginTrigger(loginTriggerEl);
      }

      const inlineResult = await openInlineLoginTrigger(loginTriggerEl);
      usernameEl = inlineResult.usernameEl;
      passwordEl = inlineResult.passwordEl;
      if (!usernameEl || !passwordEl) {
        return {
          success: false,
          submitted: false,
          requires2FA: false,
          requiresCaptcha: false,
          loginTriggerClicked: true,
          foundElements: { loginTrigger: inlineResult.loginTrigger },
        };
      }
    }

    ({ usernameEl, passwordEl } = await waitForLoginCredentials(
      usernameSelectors,
      passwordSelectors,
    ));

    if (!usernameEl || !passwordEl) {
      const detector = params.detectLoginFields ?? defaultDetectLoginFields;
      try {
        const detected = await detectLoginCredentials(detector);
        usernameEl = detected.usernameEl;
        passwordEl = detected.passwordEl;
        learnedLoginSelectors = detected.learnedLoginSelectors;
      } catch (err) {
        log.warn(
          "AI login field detection failed",
          { error: getErrorMessage(err) },
        );
      }
    }

    if (!usernameEl || !passwordEl) {
      const delayedLoginTriggerEl = findVisibleLoginTrigger();
      if (delayedLoginTriggerEl) {
        return openLoginTrigger(delayedLoginTriggerEl);
      }
    }
  }

  if (!usernameEl || !passwordEl) {
    return {
      success: false,
      submitted: false,
      requires2FA: false,
      requiresCaptcha: false,
      error: "Login form fields not found",
    };
  }

  const foundElements: NonNullable<LoginResult["foundElements"]> = {
    username: describeElement(usernameEl),
    password: describeElement(passwordEl),
  };

  log.debug("Filling login credentials", {
    safeMode: params.safeMode,
    stealthMode: params.stealthMode,
  });
  if (params.stealthMode) {
    await typeWithDelay(usernameEl, params.username);
    await randomDelay(...STEALTH_FIELD_DELAY_MS);
    await typeWithDelay(passwordEl, params.password);
    await randomDelay(...STEALTH_SUBMIT_DELAY_MS);
  } else {
    fillInputNative(usernameEl, params.username);
    fillInputNative(passwordEl, params.password);
  }

  // Submit form (AI-tagged first, then selector fallback)
  const submitEl = findLoginField("submit", submitSelectors) as HTMLElement | null;
  if (submitEl) {
    foundElements.submit = describeElement(submitEl);
  }
  const usedLoginSelectorRoles = usedCachedRoles(params.cachedLoginSelectors, {
    username: usernameEl,
    password: passwordEl,
    submit: submitEl,
  });
  const staleLoginSelectorRoles = staleCachedRoles(params.cachedLoginSelectors);
  log.debug("Triggering form submission");
  submitLoginForm(submitEl, passwordEl);

  // Return immediately — background will wait for navigation and verify login
  return {
    success: false,
    submitted: true,
    requires2FA: false,
    requiresCaptcha: false,
    foundElements,
    ...(learnedLoginSelectors !== undefined ? { learnedLoginSelectors } : {}),
    ...(usedLoginSelectorRoles.length > 0 ? { usedLoginSelectorRoles } : {}),
    ...(staleLoginSelectorRoles.length > 0 ? { staleLoginSelectorRoles } : {}),
  };
}

/**
 * Check current page login state. Called by background via CHECK_LOGIN
 * after post-login navigation completes.
 */
export function checkLoginState(
  postLoginIndicators: string[],
  otpSelectors: string[],
  usernameSelectors: string[] = [],
  passwordSelectors: string[] = [],
  options: {
    afterSubmission?: boolean;
    entryUrl?: string;
  } = {},
): LoginResult {
  // A visibly rendered, selector-based post-login indicator proves the session
  // is live. It must be checked *before* the captcha branch: platforms that use
  // invisible reCAPTCHA (v3/Enterprise) keep captcha nodes in the DOM of every
  // page, including the authenticated one, and a captcha short-circuit here
  // would make `loggedIn` permanently unreachable — deadlocking the manual
  // action prompt, which only ever resolves on `loggedIn`.
  const loggedInByIndicator = hasVisiblePostLoginIndicator(postLoginIndicators, {
    strict: true,
  });

  if (!loggedInByIndicator && hasCaptchaOrChallenge()) {
    return {
      success: false,
      submitted: false,
      requires2FA: false,
      requiresCaptcha: true,
    };
  }
  const otpEl = findLoginField(
    "otp",
    mergeSelectors(otpSelectors, GENERIC_OTP_SELECTORS),
  );
  if (otpEl) {
    return {
      success: false,
      submitted: false,
      requires2FA: true,
      requiresCaptcha: false,
    };
  }
  if (
    isLikelyLoggedIn(postLoginIndicators, {
      usernameSelectors,
      passwordSelectors,
      otpSelectors,
      ...(options.afterSubmission !== undefined
        ? { afterSubmission: options.afterSubmission }
        : {}),
      ...(options.entryUrl !== undefined ? { entryUrl: options.entryUrl } : {}),
    })
  ) {
    return {
      success: true,
      submitted: false,
      requires2FA: false,
      requiresCaptcha: false,
    };
  }
  // Not logged in. If a login form is still present and a "wrong credentials"
  // banner is showing, surface it so the background can fail fast instead of
  // polling until the verify timeout (and risking repeated bad-credential tries).
  const credentialError =
    hasVisibleLoginForm(usernameSelectors, passwordSelectors) &&
    detectCredentialError();
  // A stale-looking login page that still carries signed-in markers means the
  // session is alive — the caller should navigate instead of submitting.
  const sessionEvidence = detectSessionEvidence();
  return {
    success: false,
    submitted: false,
    requires2FA: false,
    requiresCaptcha: false,
    ...(credentialError ? { credentialError: true } : {}),
    ...(sessionEvidence ? { sessionEvidence: true } : {}),
  };
}

export async function submitOtp(
  code: string,
  otpSelectors: string[],
  submitSelectors: string[],
  postLoginIndicators: string[],
): Promise<boolean> {
  const otpEl = findLoginField(
    "otp",
    mergeSelectors(otpSelectors, GENERIC_OTP_SELECTORS),
  ) as HTMLInputElement | null;
  if (!otpEl) {
    log.warn("OTP field not found for automatic submission");
    return false;
  }

  log.info("Submitting OTP code");
  await fillInputNative(otpEl, code);
  await randomDelay(100, 300);

  const submitEl = findLoginField(
    "submit",
    mergeSelectors(submitSelectors, GENERIC_SUBMIT_SELECTORS),
  ) as HTMLElement | null;
  submitLoginForm(submitEl, otpEl);

  // Wait for post-login state
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await randomDelay(POLL_INTERVAL_MS, POLL_INTERVAL_MS);
    if (isLikelyLoggedIn(postLoginIndicators)) return true;
  }
  return false;
}
