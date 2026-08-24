import { describe, it, expect } from "vitest";
import {
  parseLocalizedNumber,
  detectValueType,
} from "../../src/content/extractor.js";

describe("parseLocalizedNumber", () => {
  it("parses plain de-DE and en-US decimals", () => {
    expect(parseLocalizedNumber("12,34")).toBe(12.34);
    expect(parseLocalizedNumber("12.34")).toBe(12.34);
    expect(parseLocalizedNumber("1.234,56")).toBe(1234.56);
    expect(parseLocalizedNumber("1,234.56")).toBe(1234.56);
  });

  it("treats a lone comma with 3 trailing digits as thousands only for currency", () => {
    // en-US thousands separator on a currency value
    expect(parseLocalizedNumber("€1,234")).toBe(1234);
    expect(parseLocalizedNumber("$12,345")).toBe(12345);
    // percentages keep the comma as a decimal separator
    expect(parseLocalizedNumber("7,125%")).toBe(7.125);
    // no currency signal → stays a decimal (de-DE reading)
    expect(parseLocalizedNumber("1,234")).toBe(1.234);
  });

  it("keeps 2-digit comma decimals as cents even with currency", () => {
    expect(parseLocalizedNumber("€12,34")).toBe(12.34);
  });

  it("applies magnitude suffixes", () => {
    expect(parseLocalizedNumber("1.2K")).toBe(1200);
    expect(parseLocalizedNumber("1,2 Mio €")).toBe(1_200_000);
    expect(parseLocalizedNumber("3 Mrd")).toBe(3_000_000_000);
    expect(parseLocalizedNumber("500k")).toBe(500_000);
  });

  it("does not treat currency codes as magnitude suffixes", () => {
    // "kr" must not trigger the k (thousand) multiplier
    expect(parseLocalizedNumber("100 kr")).toBe(100);
    expect(parseLocalizedNumber("1234 CZK")).toBe(1234);
  });

  it("does not treat property areas (m²/m³) as a mega multiplier", () => {
    expect(parseLocalizedNumber("85 m²")).toBe(85);
    expect(parseLocalizedNumber("120 m³")).toBe(120);
  });

  it("does not treat words like 'million' as a suffix without a clean boundary", () => {
    expect(parseLocalizedNumber("5 million")).toBe(5);
  });

  it("parses accounting-style parenthesised negatives", () => {
    expect(parseLocalizedNumber("(123,45)")).toBe(-123.45);
    expect(parseLocalizedNumber("(€1,234)")).toBe(-1234);
  });

  it("returns null for non-numeric input", () => {
    expect(parseLocalizedNumber("abc")).toBeNull();
    expect(parseLocalizedNumber("")).toBeNull();
  });
});

describe("detectValueType", () => {
  it("detects percent", () => {
    expect(detectValueType("7.5%")).toBe("percent");
  });

  it("detects common currency symbols and codes", () => {
    expect(detectValueType("€1.234")).toBe("currency");
    expect(detectValueType("$1,234")).toBe("currency");
    expect(detectValueType("1234 EUR")).toBe("currency");
  });

  it("detects native PLN/CZK/SEK symbols", () => {
    expect(detectValueType("1 234 zł")).toBe("currency");
    expect(detectValueType("1 234 Kč")).toBe("currency");
    expect(detectValueType("1 234 kr")).toBe("currency");
  });

  it("returns null for bare numbers", () => {
    expect(detectValueType("1234")).toBeNull();
  });
});
