import { describe, expect, it } from "vitest";
import {
  buildStrictExtractionPrompt,
  buildStrictResponseSchema,
  isStrictExtractionSignalKey,
  parseStrictExtractionResponse,
  prepareTreeForAI,
  InvalidTextTreeError,
} from "../../src/shared/ai/extraction.js";

describe("AI extraction shared utils", () => {
  it("prepareTreeForAI compacts a structured tree object", () => {
    const prepared = prepareTreeForAI([
      "Portfolio Overview",
      ["Account value", "€12,345.67"],
      ["Available funds", "€1,234.56"],
    ]);

    expect(prepared.startsWith("[")).toBe(true);
    expect(prepared.includes("Portfolio Overview")).toBe(true);
  });

  it("prepareTreeForAI accepts serialized tree strings", () => {
    const prepared = prepareTreeForAI('["A", ["B", "C"]]');
    expect(prepared).toBe('["A",["B","C"]]');
  });

  it("prepareTreeForAI rejects invalid JSON instead of forwarding it", () => {
    // The old behaviour silently handed Gemini the remains of a mid-structure
    // slice; the serializer now guarantees valid JSON, so this is a defect.
    expect(() => prepareTreeForAI('["A", ["B", "C"')).toThrow(
      InvalidTextTreeError,
    );
  });

  it("buildStrictExtractionPrompt uses delimiter sections and schema", () => {
    const prompt = buildStrictExtractionPrompt({
      signalKey: "portfolio_value",
      preparedTree: '["Portfolio","€123"]',
      keywords: ["portfolio", "value"],
    });

    expect(prompt).toContain("### INPUT_TEXT_TREE");
    expect(prompt).toContain("### CRITICAL_INSTRUCTIONS");
    expect(prompt).toContain("- Extract the total value of the P2P portfolio or the total account balance/investments.");
    expect(prompt).toContain("### OUTPUT");
    expect(prompt).toContain('{"portfolio_value": number, "currency": string}');
  });

  it("buildStrictResponseSchema requires metric key + currency", () => {
    const schema = buildStrictResponseSchema("free_cash");
    expect(schema.required).toEqual(["free_cash", "currency"]);
  });

  it("parses strict metric-keyed JSON", () => {
    const parsed = parseStrictExtractionResponse(
      '{"portfolio_value":12345.67,"currency":"EUR"}',
      "portfolio_value",
    );
    expect(parsed).toEqual({ value: 12345.67, currency: "EUR" });
  });

  it("parses legacy value JSON as fallback", () => {
    const parsed = parseStrictExtractionResponse(
      '{"value":807.83,"currency":"EUR"}',
      "free_cash",
    );
    expect(parsed).toEqual({ value: 807.83, currency: "EUR" });
  });

  it("parses fenced JSON responses", () => {
    const parsed = parseStrictExtractionResponse(
      "```json\n{\"free_cash\":807.83,\"currency\":\"EUR\"}\n```",
      "free_cash",
    );
    expect(parsed).toEqual({ value: 807.83, currency: "EUR" });
  });

  it("returns an error for malformed responses", () => {
    const parsed = parseStrictExtractionResponse("not-json-response", "free_cash");
    expect(parsed).toEqual({ error: "invalid_json" });
  });

  it("detects strict extraction signal keys", () => {
    expect(isStrictExtractionSignalKey("portfolio_value")).toBe(true);
    expect(isStrictExtractionSignalKey("free_cash")).toBe(true);
    expect(isStrictExtractionSignalKey("net_annual_return")).toBe(false);
  });
});
