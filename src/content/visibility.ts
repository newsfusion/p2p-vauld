interface VisibilityOptions {
  requireEnabled?: boolean;
}

const HYDRATION_HIDDEN_FORM_TAGS = new Set([
  "BUTTON",
  "INPUT",
  "SELECT",
  "TEXTAREA",
]);

function isDisabledElement(el: Element): boolean {
  if (el.getAttribute("aria-disabled") === "true") return true;

  if (
    el instanceof HTMLButtonElement ||
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLOptGroupElement ||
    el instanceof HTMLOptionElement ||
    el instanceof HTMLFieldSetElement
  ) {
    return el.disabled;
  }

  return false;
}

export function isRenderableElement(
  el: Element,
  options: VisibilityOptions = {},
): boolean {
  if (!el.isConnected) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.hasAttribute("hidden") && !HYDRATION_HIDDEN_FORM_TAGS.has(el.tagName)) {
    return false;
  }

  const style = window.getComputedStyle(el);
  if (style.display === "none") return false;
  if (style.visibility === "hidden" || style.visibility === "collapse") {
    return false;
  }
  if (style.opacity === "0") return false;

  if (options.requireEnabled && isDisabledElement(el)) {
    return false;
  }

  return true;
}

export function isUsableFormElement(el: Element): boolean {
  return isRenderableElement(el, { requireEnabled: true });
}

interface RenderedVisibilityOptions {
  /** Minimum width and height in CSS pixels the element must occupy. */
  minSize?: number;
}

/**
 * Stricter than `isRenderableElement`: additionally requires the element to
 * actually occupy space inside the viewport and to have no hidden ancestor.
 *
 * Form detection deliberately tolerates zero-size / hydrating elements, so this
 * lives beside `isRenderableElement` instead of replacing it. Use it where a
 * false positive is expensive — e.g. captcha detection, where an off-screen
 * `div.grecaptcha-badge` must not be mistaken for a user-facing challenge.
 */
export function isVisiblyRendered(
  el: Element,
  options: RenderedVisibilityOptions = {},
): boolean {
  if (!isRenderableElement(el)) return false;

  const rect = el.getBoundingClientRect();
  const hasOwnBox =
    rect.width !== 0 || rect.height !== 0 || rect.left !== 0 || rect.top !== 0;

  // Test DOMs (happy-dom) have no layout engine and report an all-zero rect for
  // *everything*, including <html>. Only skip the geometry checks in that case,
  // and only for elements whose box the test has not stubbed — a real browser
  // always gives the document element a viewport-sized box, so production
  // never takes this branch.
  if (!hasLayoutEngine() && !hasOwnBox) {
    return true;
  }

  // checkVisibility() also walks ancestors (display:none on a parent is not
  // reflected in the child's own computed style).
  const checkVisibility = (
    el as Element & {
      checkVisibility?: (opts?: {
        checkOpacity?: boolean;
        checkVisibilityCSS?: boolean;
      }) => boolean;
    }
  ).checkVisibility;
  if (typeof checkVisibility === "function") {
    if (!checkVisibility.call(el, { checkOpacity: true, checkVisibilityCSS: true })) {
      return false;
    }
  }

  const minSize = options.minSize ?? 1;
  if (rect.width < minSize || rect.height < minSize) return false;

  // Fully outside the viewport — the usual way widgets like the reCAPTCHA
  // badge are parked off-screen (position:fixed; right:-186px).
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  if (rect.right <= 0 || rect.bottom <= 0) return false;
  if (viewportWidth > 0 && rect.left >= viewportWidth) return false;
  if (viewportHeight > 0 && rect.top >= viewportHeight) return false;

  return true;
}

/**
 * Whether the document has a real layout engine. The document element always
 * has a viewport-sized box in a browser and an all-zero one in happy-dom.
 */
function hasLayoutEngine(): boolean {
  const rect = document.documentElement.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}
