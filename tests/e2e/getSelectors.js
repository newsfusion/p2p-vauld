import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { Window } from "happy-dom";
import { dashboardFixture } from "../fixtures/platform-html-bundle.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const catalogPath = join(
  __dirname,
  "../../src/shared/platforms/platform-catalog.json",
);
const catalog = JSON.parse(readFileSync(catalogPath, "utf-8"));

const PLATFORMS = [
  "mintos",
  "peerberry",
  "estateguru",
  "debitum",
  "income_marketplace",
  "indemo",
  "triple_dragon",
];

function loadFixture(platformId) {
  const html = dashboardFixture(platformId).html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");

  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document;
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function findFirstMatch(document, selectors) {
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (!el) continue;

      return {
        selector,
        tag: el.tagName,
        id: el.id,
        className: el.className,
        text: normalizeText(el.textContent ?? ""),
        html: el.outerHTML.slice(0, 160),
      };
    } catch {
      continue;
    }
  }

  return null;
}

const results = {};

for (const platformId of PLATFORMS) {
  const entry = catalog.find((platform) => platform.id === platformId);
  if (!entry) continue;

  const document = loadFixture(platformId);

  results[platformId] = {
    portfolioValue: findFirstMatch(
      document,
      entry.dashboard.portfolioValueSelectors,
    ),
    freeCash: findFirstMatch(document, entry.dashboard.freeCashSelectors),
    netAnnualReturn: findFirstMatch(
      document,
      entry.dashboard.netAnnualReturnSelectors,
    ),
  };
}

console.log(JSON.stringify(results, null, 2));
