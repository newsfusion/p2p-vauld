import { describe, expect, it } from "vitest";
import { getErrorMessage } from "../../src/shared/error-utils.js";

describe("getErrorMessage", () => {
  it("returns the message from Error instances", () => {
    expect(getErrorMessage(new Error("Boom"))).toBe("Boom");
  });

  it("stringifies non-Error values", () => {
    expect(getErrorMessage("plain")).toBe("plain");
    expect(getErrorMessage(42)).toBe("42");
    expect(getErrorMessage(null)).toBe("null");
    expect(getErrorMessage(undefined)).toBe("undefined");
  });
});
