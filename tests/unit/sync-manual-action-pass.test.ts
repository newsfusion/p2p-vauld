import { describe, expect, it } from "vitest";
import { resolveFirstPassAllowManualAction } from "../../src/background/sync.js";

describe("resolveFirstPassAllowManualAction", () => {
  it("allows inline manual action in sequential sync mode", () => {
    expect(resolveFirstPassAllowManualAction(false)).toBe(true);
  });

  it("defers manual action in parallel sync mode", () => {
    expect(resolveFirstPassAllowManualAction(true)).toBe(false);
  });
});
