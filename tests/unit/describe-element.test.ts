import { describe, it, expect, beforeEach } from "vitest";
import { describeElement } from "../../src/shared/describe-element.js";

describe("describeElement", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("should describe a simple element", () => {
    const el = document.createElement("div");
    expect(describeElement(el)).toBe("<div>");
  });

  it("should include classes grouping them correctly", () => {
    const el = document.createElement("span");
    el.classList.add("text-bold", "highlight");
    expect(describeElement(el)).toBe('<span class="text-bold highlight">');
  });

  it("should include an ID", () => {
    const el = document.createElement("input");
    el.id = "username-field";
    expect(describeElement(el)).toBe('<input type="text" id="username-field">');
  });

  it("should include type for input elements", () => {
    const el = document.createElement("input");
    el.type = "password";
    el.className = "form-control";
    expect(describeElement(el)).toBe(
      '<input type="password" class="form-control">',
    );
  });

  it("should include and truncate text content", () => {
    const el = document.createElement("button");
    el.className = "btn";
    el.textContent = "  Sign In Securely With Your Account  ";
    expect(describeElement(el)).toBe(
      '<button class="btn">Sign In Securely With Your ...</button>',
    );
  });

  it("should combine multiple attributes correctly", () => {
    const el = document.createElement("input");
    el.type = "email";
    el.id = "login-email";
    el.classList.add("input-field", "dark-theme");
    expect(describeElement(el)).toBe(
      '<input type="email" id="login-email" class="input-field dark-theme">',
    );
  });

  it("should truncate the entire description if too long", () => {
    const el = document.createElement("div");
    el.id = "very-long-id-that-takes-up-a-lot-of-space-in-the-description";
    el.className =
      "class1 class2 class3 class4 class5 class6 class7 class8 class9";
    el.textContent =
      "Some inner text content here that adds more length to the resulting string.";

    const result = describeElement(el, 100);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result.endsWith("...")).toBe(true);
  });
});
