export function detectCurrency(text: string, fallback = "EUR"): string {
  const upper = text.toUpperCase();
  if (upper.includes("USD") || upper.includes("$")) return "USD";
  if (upper.includes("GBP") || upper.includes("£")) return "GBP";
  if (upper.includes("PLN") || text.includes("zł")) return "PLN";
  if (upper.includes("CZK") || text.includes("Kč")) return "CZK";
  if (upper.includes("SEK")) return "SEK";
  if (upper.includes("NOK")) return "NOK";
  if (upper.includes("EUR") || upper.includes("€")) return "EUR";
  return fallback;
}
