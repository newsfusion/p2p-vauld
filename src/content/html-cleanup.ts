import { createLogger } from '../shared/logger.js';
import type { CleanupStats } from '../shared/types/index.js';

const log = createLogger("html-cleanup");

// ─── Constants ──────────────────────────────────────────────────────────────

/** Tags to remove entirely (including children) */
const REMOVE_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE",
  "FOOTER", "SVG", "IFRAME", "VIDEO", "AUDIO",
  "CANVAS", "MAP", "OBJECT", "EMBED",
]);

/** Selectors for elements to remove */
const REMOVE_SELECTORS = [
  '[aria-hidden="true"]',
  ':not(input, button, select, textarea)[hidden]',
  '[role="contentinfo"]',         // Footer content info
  'img[src^="data:"]',           // Base64 images — huge, useless for extraction
  'img[src^="blob:"]',           // Blob images
  'link',                         // Stylesheet links in body
  'meta',                         // Meta tags in body
];

// ─── Page Readiness ─────────────────────────────────────────────────────────

export interface PageReadyResult {
  readyState: string;
  waitedMs: number;
  domStable: boolean;
}

/**
 * Wait for the page to be fully ready:
 * 1. document.readyState === "complete"
 * 2. DOM stops mutating for `stableMs` milliseconds
 *
 * Returns early if maxWaitMs is reached.
 *
 * NOTE: Content scripts injected at `document_idle` will always see
 * readyState === "complete", so the MutationObserver path is the primary path.
 */
export function waitForPageReady(
  stableMs: number = 1000,
  maxWaitMs: number = 8000,
): Promise<PageReadyResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let settled = false;

    function done(domStable: boolean) {
      if (settled) return;
      settled = true;
      resolve({
        readyState: document.readyState,
        waitedMs: Date.now() - startTime,
        domStable,
      });
    }

    // If document is not yet complete, wait for load first
    if (document.readyState !== "complete") {
      const onLoad = () => {
        window.removeEventListener("load", onLoad);
        observeDomStability();
      };
      window.addEventListener("load", onLoad);
      // Safety timeout if load event never fires
      setTimeout(() => {
        window.removeEventListener("load", onLoad);
        done(false);
      }, maxWaitMs);
      return;
    }

    observeDomStability();

    function observeDomStability() {
      let stabilityTimer: ReturnType<typeof setTimeout>;
      const remainingMs = maxWaitMs - (Date.now() - startTime);
      if (remainingMs <= 0) { done(false); return; }

      const observer = new MutationObserver(() => {
        clearTimeout(stabilityTimer);
        stabilityTimer = setTimeout(() => {
          observer.disconnect();
          done(true);
        }, stableMs);
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      // Initial stability timer — if no mutations at all, resolve after stableMs
      stabilityTimer = setTimeout(() => {
        observer.disconnect();
        done(true);
      }, stableMs);

      // Safety timeout
      setTimeout(() => {
        clearTimeout(stabilityTimer);
        observer.disconnect();
        done(false);
      }, remainingMs);
    }
  });
}

// ─── HTML Cleanup ───────────────────────────────────────────────────────────

export type { CleanupStats };

/**
 * Clones the document body and strips irrelevant content.
 * Returns a detached DOM element suitable for extraction.
 *
 * Does NOT modify the live DOM — operates on a deep clone.
 */
export function cleanHtml(doc: Document = document): {
  root: Element;
  stats: CleanupStats;
} {
  const rawLength = doc.body.innerHTML.length;
  let elementsRemoved = 0;

  // Clone the body so we don't modify the live page
  const clone = doc.body.cloneNode(true) as HTMLElement;

  // Step 1: Remove entire tag types
  for (const tag of REMOVE_TAGS) {
    const elements = clone.querySelectorAll(tag.toLowerCase());
    for (const el of elements) {
      el.remove();
      elementsRemoved++;
    }
  }

  // Step 2: Remove elements matching selectors
  for (const selector of REMOVE_SELECTORS) {
    try {
      const elements = clone.querySelectorAll(selector);
      for (const el of elements) {
        el.remove();
        elementsRemoved++;
      }
    } catch {
      // Invalid selector — skip
    }
  }

  // Step 3: Remove remaining base64/blob images and images with huge src
  const images = clone.querySelectorAll("img");
  for (const img of images) {
    const src = img.getAttribute("src") ?? "";
    if (src.startsWith("data:") || src.startsWith("blob:") || src.length > 1000) {
      img.remove();
      elementsRemoved++;
    }
  }

  // Step 4: Remove empty container elements (no visible text content)
  const EMPTY_REMOVABLE = new Set(["DIV", "SPAN", "P", "SECTION", "ARTICLE"]);
  const empties = clone.querySelectorAll("div, span, p, section, article");
  for (const el of empties) {
    if (
      EMPTY_REMOVABLE.has(el.tagName) &&
      !(el.textContent ?? "").trim() &&
      !el.querySelector("input, button, select, textarea")
    ) {
      el.remove();
      elementsRemoved++;
    }
  }

  // Step 5: Scrub credential values while preserving selector structure for diagnostics.
  const fields = clone.querySelectorAll("input, textarea");
  for (const field of fields) {
    if (field instanceof HTMLInputElement) {
      field.value = "";
      field.defaultValue = "";
      field.setAttribute("value", "");
    } else if (field instanceof HTMLTextAreaElement) {
      field.value = "";
      field.defaultValue = "";
      field.textContent = "";
      field.setAttribute("value", "");
    }
  }

  const cleanedLength = clone.innerHTML.length;
  const reductionPct =
    rawLength > 0 ? Math.round((1 - cleanedLength / rawLength) * 100) : 0;

  const stats: CleanupStats = {
    rawLength,
    cleanedLength,
    reductionPct,
    elementsRemoved,
    attributesStripped: 0,
  };

  log.debug("HTML cleanup complete", {
    rawChars: rawLength,
    cleanedChars: cleanedLength,
    reductionPct: `${reductionPct}%`,
    elementsRemoved,
  });

  return { root: clone, stats };
}
