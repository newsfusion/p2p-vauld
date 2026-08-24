import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkLoginState,
  isVisible,
  performLogin,
} from "../../src/content/login.js";

describe("background-safe login helpers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
    vi.useRealTimers();
  });

  it("treats zero-rect inputs as visible when styles allow interaction", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    vi.spyOn(input, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect);

    expect(isVisible(input)).toBe(true);
  });

  it("fills hidden SPA-hydration credential inputs", async () => {
    document.body.innerHTML = `
      <form id="debitum-login-form">
        <input name="email" hidden />
        <input type="password" name="password" hidden />
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);

    const result = await performLogin({
      username: "debitum@example.com",
      password: "debitumsecret",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    expect(result.submitted).toBe(true);
    expect(
      (document.querySelector('input[name="email"]') as HTMLInputElement).value,
    ).toBe("debitum@example.com");
    expect(
      (document.querySelector('input[name="password"]') as HTMLInputElement).value,
    ).toBe("debitumsecret");
  });

  it("submits through requestSubmit without relying on focus or synthetic enter", async () => {
    document.body.innerHTML = `
      <form id="login-form">
        <input name="email" />
        <input type="password" name="password" />
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    const requestSubmit = vi
      .spyOn(form, "requestSubmit")
      .mockImplementation(() => undefined);

    const result = await performLogin({
      username: "user@example.com",
      password: "secret",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    expect(result.submitted).toBe(true);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(
      (document.querySelector('input[name="email"]') as HTMLInputElement).value,
    ).toBe("user@example.com");
    expect(
      (document.querySelector('input[name="password"]') as HTMLInputElement).value,
    ).toBe("secret");
  });

  it("falls back to generic login selectors when platform selectors are empty", async () => {
    document.body.innerHTML = `
      <form id="generic-login-form">
        <input type="email" />
        <input type="password" />
        <button type="submit">Sign in</button>
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    const requestSubmit = vi
      .spyOn(form, "requestSubmit")
      .mockImplementation(() => undefined);
    const submitButton = document.querySelector("button") as HTMLButtonElement;
    const click = vi
      .spyOn(submitButton, "click")
      .mockImplementation(() => undefined);

    const result = await performLogin({
      username: "generic@example.com",
      password: "genericsecret",
      usernameSelectors: [],
      passwordSelectors: [],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    expect(result.submitted).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(
      (document.querySelector('input[type="email"]') as HTMLInputElement).value,
    ).toBe("generic@example.com");
    expect(
      (document.querySelector('input[type="password"]') as HTMLInputElement).value,
    ).toBe("genericsecret");
  });

  it("does not run AI detection when cached selectors find credential fields", async () => {
    document.body.innerHTML = `
      <form id="cached-login-form">
        <input id="cached-email" />
        <input id="cached-password" type="password" />
        <button id="cached-submit" type="submit">Sign in</button>
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);
    const detectLoginFields = vi.fn(async () => ({
      detected: false,
      aiLog: { available: true },
    }));

    const result = await performLogin({
      username: "cached@example.com",
      password: "cachedsecret",
      cachedLoginSelectors: {
        username: ["#cached-email"],
        password: ["#cached-password"],
        submit: ["#cached-submit"],
      },
      usernameSelectors: ['input[name="stale-email"]'],
      passwordSelectors: ['input[name="stale-password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
      detectLoginFields,
    });

    expect(result.submitted).toBe(true);
    expect(detectLoginFields).not.toHaveBeenCalled();
    expect(result.usedLoginSelectorRoles).toEqual(["username", "password", "submit"]);
    expect(result.staleLoginSelectorRoles).toBeUndefined();
  });

  it("reports stale cached selector roles when cached selectors no longer resolve", async () => {
    document.body.innerHTML = `
      <form id="drifted-login-form">
        <input id="current-email" />
        <input id="current-password" type="password" />
        <button id="current-submit" type="submit">Sign in</button>
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);

    const result = await performLogin({
      username: "cached@example.com",
      password: "cachedsecret",
      cachedLoginSelectors: {
        username: ["#stale-email"],
        password: ["#stale-password"],
        submit: ["#stale-submit"],
      },
      usernameSelectors: ["#current-email"],
      passwordSelectors: ["#current-password"],
      submitSelectors: ["#current-submit"],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    expect(result.submitted).toBe(true);
    expect(result.usedLoginSelectorRoles).toBeUndefined();
    expect(result.staleLoginSelectorRoles).toEqual([
      "username",
      "password",
      "submit",
    ]);
  });

  it("runs AI detection after selector lookup fails and returns learned selectors", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <form id="drifted-login-form">
        <input id="ai-email" />
        <input id="ai-password" />
        <button id="ai-submit" type="button">Continue</button>
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);
    const detectLoginFields = vi.fn(async () => {
      document.querySelector("#ai-email")?.setAttribute("data-p2p-field", "username");
      document.querySelector("#ai-password")?.setAttribute("data-p2p-field", "password");
      document.querySelector("#ai-submit")?.setAttribute("data-p2p-field", "submit");
      return {
        detected: true,
        fields: {
          username: '[data-p2p-field="username"]',
          password: '[data-p2p-field="password"]',
          submit: '[data-p2p-field="submit"]',
        },
        stableSelectors: {
          username: 'input#ai-email',
          password: 'input#ai-password',
          submit: 'button#ai-submit',
        },
        aiLog: { available: true },
      };
    });

    const promise = performLogin({
      username: "ai@example.com",
      password: "aisecret",
      cachedLoginSelectors: {
        username: ['input[name="old-email"]'],
        password: ['input[name="old-password"]'],
      },
      usernameSelectors: ['input[name="still-old-email"]'],
      passwordSelectors: ['input[name="still-old-password"]'],
      submitSelectors: ['button[name="still-old-submit"]'],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
      detectLoginFields,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await promise;

    expect(result.submitted).toBe(true);
    expect(detectLoginFields).toHaveBeenCalledTimes(1);
    expect(result.learnedLoginSelectors).toEqual({
      username: 'input#ai-email',
      password: 'input#ai-password',
      submit: 'button#ai-submit',
    });
    expect(
      (document.querySelector("#ai-email") as HTMLInputElement).value,
    ).toBe("ai@example.com");
  });

  it("clicks the submit button so SPA login handlers can submit credentials", async () => {
    document.body.innerHTML = `
      <form id="spa-login-form">
        <input name="email" />
        <input type="password" name="password" />
        <button type="submit">Log in</button>
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    const requestSubmit = vi
      .spyOn(form, "requestSubmit")
      .mockImplementation(() => undefined);
    const submitButton = document.querySelector("button") as HTMLButtonElement;
    const click = vi
      .spyOn(submitButton, "click")
      .mockImplementation(() => undefined);

    const result = await performLogin({
      username: "spa@example.com",
      password: "spasecret",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: ['button[type="submit"]'],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    expect(result.submitted).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it("waits for SPA-rendered login fields before failing", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="app"></div>';

    setTimeout(() => {
      document.body.innerHTML = `
        <form id="delayed-login-form">
          <input name="email" />
          <input type="password" name="password" />
        </form>
      `;
    }, 250);

    let settled = false;
    const promise = performLogin({
      username: "delayed@example.com",
      password: "delayedsecret",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;
    expect(result.submitted).toBe(true);
    expect(result.error).toBeUndefined();
    expect(
      (document.querySelector('input[name="email"]') as HTMLInputElement).value,
    ).toBe("delayed@example.com");
    expect(
      (document.querySelector('input[name="password"]') as HTMLInputElement).value,
    ).toBe("delayedsecret");
  });

  it("prefers custom login selectors before generic fallbacks", async () => {
    document.body.innerHTML = `
      <form id="custom-login-form">
        <input type="email" value="leave-me-alone@example.com" />
        <input name="login" />
        <input type="password" name="generic-password" value="unchanged" />
        <input type="password" name="passcode" />
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);

    const result = await performLogin({
      username: "custom@example.com",
      password: "customsecret",
      usernameSelectors: ['input[name="login"]'],
      passwordSelectors: ['input[name="passcode"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    expect(result.submitted).toBe(true);
    expect(
      (document.querySelector('input[name="login"]') as HTMLInputElement).value,
    ).toBe("custom@example.com");
    expect(
      (document.querySelector('input[name="passcode"]') as HTMLInputElement).value,
    ).toBe("customsecret");
    expect(
      (document.querySelector('input[type="email"]') as HTMLInputElement).value,
    ).toBe("leave-me-alone@example.com");
    expect(
      (document.querySelector('input[name="generic-password"]') as HTMLInputElement)
        .value,
    ).toBe("unchanged");
  });

  it("does not treat auth-like URLs as logged in when platform selectors find a login form", () => {
    window.history.replaceState({}, "", "/en/overview");
    document.body.innerHTML = `
      <form>
        <input name="login" />
        <input type="password" name="passcode" />
      </form>
    `;

    const result = checkLoginState(
      ["text=/portfolio|overview/i"],
      [],
      ['input[name="login"]'],
      ['input[name="passcode"]'],
    );

    expect(result.success).toBe(false);
    expect(result.requires2FA).toBe(false);
    expect(result.requiresCaptcha).toBe(false);
  });

  it("clicks a visible English login trigger when login fields are absent", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <h1>Welcome</h1>
        <a href="/login" aria-label="Login">Login</a>
      </main>
    `;
    const loginButton = document.querySelector("a") as HTMLAnchorElement;
    const click = vi
      .spyOn(loginButton, "click")
      .mockImplementation(() => undefined);

    const promise = performLogin({
      username: "landing@example.com",
      password: "secret",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    const result = await promise;
    await vi.advanceTimersByTimeAsync(60);

    expect(result.submitted).toBe(false);
    expect(result.loginTriggerClicked).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.foundElements?.loginTrigger).toContain("a");
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("clicks a visible German login trigger when login fields are absent", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <a href="/login">Anmelden</a>
      </main>
    `;
    const loginLink = document.querySelector("a") as HTMLAnchorElement;
    const click = vi.spyOn(loginLink, "click").mockImplementation(() => undefined);

    const promise = performLogin({
      username: "german@example.com",
      password: "secret",
      usernameSelectors: [],
      passwordSelectors: [],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    const result = await promise;
    await vi.advanceTimersByTimeAsync(60);

    expect(result.submitted).toBe(false);
    expect(result.loginTriggerClicked).toBe(true);
    expect(result.error).toBeUndefined();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("fills fields that appear in an inline login popup after clicking a trigger", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <form id="newsletter-form">
          <input name="username" value="leave-me@example.com" />
        </form>
        <button type="button" aria-label="Login">Login</button>
        <div id="modal-root"></div>
      </main>
    `;
    const loginButton = document.querySelector("button") as HTMLButtonElement;
    vi.spyOn(loginButton, "click").mockImplementation(() => {
      setTimeout(() => {
        const modalRoot = document.querySelector("#modal-root") as HTMLDivElement;
        modalRoot.innerHTML = `
          <form id="popup-login-form">
            <input name="username" />
            <input type="password" name="password" />
          </form>
        `;
        const form = modalRoot.querySelector("form") as HTMLFormElement;
        vi.spyOn(form, "requestSubmit").mockImplementation(() => undefined);
      }, 250);
    });

    const promise = performLogin({
      username: "popup@example.com",
      password: "popupsecret",
      usernameSelectors: ['input[name="username"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    await vi.advanceTimersByTimeAsync(300);

    const result = await promise;
    const form = document.querySelector("#popup-login-form") as HTMLFormElement;

    expect(result.submitted).toBe(true);
    expect(result.loginTriggerClicked).toBeUndefined();
    expect(form.requestSubmit).toHaveBeenCalledTimes(1);
    expect(
      (document.querySelector('#newsletter-form input[name="username"]') as HTMLInputElement)
        .value,
    ).toBe("leave-me@example.com");
    expect(
      (document.querySelector('#popup-login-form input[name="username"]') as HTMLInputElement)
        .value,
    ).toBe("popup@example.com");
    expect(
      (document.querySelector('#popup-login-form input[name="password"]') as HTMLInputElement)
        .value,
    ).toBe("popupsecret");
  });

  it("ignores non-login triggers and keeps the old missing-fields failure", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <button type="button">Register</button>
        <button type="button">Create account</button>
        <button type="button" disabled>Anmelden</button>
        <a href="/login" hidden>Login</a>
      </main>
    `;
    const clickable = Array.from(
      document.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
        "button, a",
      ),
    );
    const clicks = clickable.map((element) =>
      vi.spyOn(element, "click").mockImplementation(() => undefined),
    );

    const promise = performLogin({
      username: "missing@example.com",
      password: "secret",
      usernameSelectors: [],
      passwordSelectors: [],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    });

    await vi.advanceTimersByTimeAsync(5_100);
    const result = await promise;

    expect(result).toMatchObject({
      success: false,
      submitted: false,
      requires2FA: false,
      requiresCaptcha: false,
      error: "Login form fields not found",
    });
    expect(result.loginTriggerClicked).toBeUndefined();
    expect(clicks.every((click) => click.mock.calls.length === 0)).toBe(true);
  });

  it("does not trust overview URL heuristics when a login trigger is visible", () => {
    window.history.replaceState({}, "", "/en/overview");
    document.body.innerHTML = `
      <main>
        <h1>Investments</h1>
        <a href="/login">Login</a>
      </main>
    `;

    const result = checkLoginState([], [], [], []);

    expect(result.success).toBe(false);
    expect(result.requires2FA).toBe(false);
    expect(result.requiresCaptcha).toBe(false);
  });

  it("fills custom selector fields even on overview URLs", async () => {
    window.history.replaceState({}, "", "/en/overview");
    document.body.innerHTML = `
      <form id="custom-login-form">
        <input name="login" />
        <input type="password" name="passcode" />
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    const requestSubmit = vi
      .spyOn(form, "requestSubmit")
      .mockImplementation(() => undefined);

    const result = await performLogin({
      username: "custom@example.com",
      password: "topsecret",
      usernameSelectors: ['input[name="login"]'],
      passwordSelectors: ['input[name="passcode"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: ["text=/portfolio|overview/i"],
      stealthMode: false,
      safeMode: false,
    });

    expect(result.submitted).toBe(true);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(
      (document.querySelector('input[name="login"]') as HTMLInputElement).value,
    ).toBe("custom@example.com");
    expect(
      (document.querySelector('input[name="passcode"]') as HTMLInputElement).value,
    ).toBe("topsecret");
  });

  it("types credentials progressively before submitting in stealth mode", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    document.body.innerHTML = `
      <form id="login-form">
        <input name="email" />
        <input type="password" name="password" />
      </form>
    `;

    const form = document.querySelector("form") as HTMLFormElement;
    const requestSubmit = vi
      .spyOn(form, "requestSubmit")
      .mockImplementation(() => {
        expect(
          (document.querySelector('input[name="email"]') as HTMLInputElement).value,
        ).toBe("ab");
        expect(
          (document.querySelector('input[name="password"]') as HTMLInputElement)
            .value,
        ).toBe("cd");
      });
    const usernameValues: string[] = [];
    const passwordValues: string[] = [];
    document
      .querySelector('input[name="email"]')
      ?.addEventListener("input", (event) => {
        usernameValues.push((event.target as HTMLInputElement).value);
      });
    document
      .querySelector('input[name="password"]')
      ?.addEventListener("input", (event) => {
        passwordValues.push((event.target as HTMLInputElement).value);
      });

    let settled = false;
    const promise = performLogin({
      username: "ab",
      password: "cd",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: true,
      safeMode: false,
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(requestSubmit).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    const result = await promise;

    expect(result.submitted).toBe(true);
    expect(requestSubmit).toHaveBeenCalledTimes(1);
    expect(usernameValues).toEqual(["", "a", "ab"]);
    expect(passwordValues).toEqual(["", "c", "cd"]);
  });

  it("fills credentials immediately when safeMode is true and stealthMode is false", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <form id="login-form">
        <input name="email" />
        <input type="password" name="password" />
      </form>
    `;

    let settled = false;
    const promise = performLogin({
      username: "safe@example.com",
      password: "safesecret",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: true,
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(true);

    const result = await promise;
    expect(result.submitted).toBe(true);
    expect(
      (document.querySelector('input[name="email"]') as HTMLInputElement).value,
    ).toBe("safe@example.com");
    expect(
      (document.querySelector('input[name="password"]') as HTMLInputElement)
        .value,
    ).toBe("safesecret");
  });

  it("does not add login pacing delays when stealthMode is false", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <form id="login-form">
        <input name="email" />
        <input type="password" name="password" />
      </form>
    `;

    let settled = false;
    const promise = performLogin({
      username: "quick@example.com",
      password: "secret",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: false,
      safeMode: false,
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(true);
    const result = await promise;
    expect(result.submitted).toBe(true);
  });

  it("keeps stealth login pending until pacing timers complete", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <form id="login-form">
        <input name="email" />
        <input type="password" name="password" />
      </form>
    `;

    let settled = false;
    const promise = performLogin({
      username: "stealth@example.com",
      password: "secret",
      usernameSelectors: ['input[name="email"]'],
      passwordSelectors: ['input[name="password"]'],
      submitSelectors: [],
      otpSelectors: [],
      postLoginIndicators: [],
      stealthMode: true,
      safeMode: false,
    }).then((result) => {
      settled = true;
      return result;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.submitted).toBe(true);
  });
});
