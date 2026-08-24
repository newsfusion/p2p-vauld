import { describe, expect, it } from "vitest";
import {
  generateStableLoginSelector,
  generateStableLoginSelectors,
} from "../../src/content/login-selectors.js";

describe("login selector generation", () => {
  it("prefers stable id and name selectors with CSS escaping", () => {
    document.body.innerHTML = `
      <form>
        <input id="login:user" name="email" />
        <input name="pass.word" type="password" />
      </form>
    `;

    const username = document.querySelector("#login\\:user")!;
    const password = document.querySelector('input[name="pass.word"]')!;

    expect(generateStableLoginSelector(username)).toBe("input#login\\:user");
    expect(generateStableLoginSelector(password)).toBe(
      'input[name="pass.word"]',
    );
  });

  it("only returns selectors that uniquely identify a visible element", () => {
    document.body.innerHTML = `
      <form>
        <input type="email" placeholder="Email address" />
        <input type="email" placeholder="Email address" />
        <button aria-label="Sign in">Sign in</button>
      </form>
    `;

    const duplicatedEmail = document.querySelector("input")!;
    const submit = document.querySelector("button")!;

    expect(generateStableLoginSelector(duplicatedEmail)).not.toBe(
      'input[type="email"][placeholder*="Email address"]',
    );
    expect(generateStableLoginSelector(submit)).toBe(
      'button[aria-label*="Sign in"]',
    );
  });

  it("does not persist temporary AI data-p2p-field selectors", () => {
    document.body.innerHTML = `
      <form>
        <input data-p2p-field="username" type="email" autocomplete="username" />
        <input data-p2p-field="password" type="password" autocomplete="current-password" />
        <button data-p2p-field="submit" type="submit">Log in</button>
      </form>
    `;

    const selectors = generateStableLoginSelectors({
      username: document.querySelector('[data-p2p-field="username"]')!,
      password: document.querySelector('[data-p2p-field="password"]')!,
      submit: document.querySelector('[data-p2p-field="submit"]')!,
    });

    expect(Object.values(selectors).join(" ")).not.toContain("data-p2p-field");
    expect(selectors).toEqual({
      username: 'input[autocomplete="username"]',
      password: 'input[autocomplete="current-password"]',
      submit: 'button[type="submit"]',
    });
  });
});
