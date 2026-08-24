import { describe, expect, it, vi } from "vitest";
import { promptWithResponseConstraintFallback } from "../../src/content/ai-shared.js";

describe("promptWithResponseConstraintFallback", () => {
  it("uses responseConstraint when the session accepts it", async () => {
    const prompt = vi.fn(async () => "{\"ok\":true}");
    const schema = { type: "object" };

    await expect(
      promptWithResponseConstraintFallback(
        { prompt },
        "Read this",
        schema,
      ),
    ).resolves.toBe("{\"ok\":true}");

    expect(prompt).toHaveBeenCalledWith("Read this", {
      responseConstraint: schema,
    });
  });

  it("falls back to plain prompt when responseConstraint is rejected", async () => {
    const prompt = vi
      .fn()
      .mockRejectedValueOnce(new Error("unsupported"))
      .mockResolvedValueOnce("{\"ok\":true}");

    await expect(
      promptWithResponseConstraintFallback(
        { prompt },
        "Read this",
        { type: "object" },
      ),
    ).resolves.toBe("{\"ok\":true}");

    expect(prompt).toHaveBeenNthCalledWith(2, "Read this");
  });

  it("uses plain prompt when no responseConstraint is supplied", async () => {
    const prompt = vi.fn(async () => "plain");

    await expect(
      promptWithResponseConstraintFallback({ prompt }, "Read this"),
    ).resolves.toBe("plain");

    expect(prompt).toHaveBeenCalledWith("Read this");
  });
});
