export interface OverlayDismissalClick {
  vendor: "onetrust" | "cookiebot" | "usercentrics";
  selector: string;
  text: string;
  action: "reject" | "accept";
}

export interface OverlayDismissalResult {
  clicked: OverlayDismissalClick[];
  blockingOverlayDetected: boolean;
}

const ALLOWED_BUTTON_TEXT = new Set([
  "accept",
  "accept all",
  "allow all",
  "agree",
  "i agree",
  "ok",
  "got it",
  "alle akzeptieren",
  "akzeptieren",
  "zustimmen",
]);

const REJECT_BUTTON_TEXT = new Set([
  "reject all",
  "reject",
  "decline",
  "only necessary",
  "necessary only",
  "necessary cookies only",
  "alle ablehnen",
  "ablehnen",
  "nur notwendige",
  "nur erforderliche",
]);

function normalizedText(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function clickFirstAllowedButton(
  root: ParentNode,
  vendor: OverlayDismissalClick["vendor"],
  selector: string,
  clicked: OverlayDismissalClick[],
): void {
  const container = root.querySelector(selector);
  if (!container) return;
  const buttons = Array.from(container.querySelectorAll("button, [role='button']"));
  const rejectButton = buttons.find((candidate) =>
    REJECT_BUTTON_TEXT.has(normalizedText(candidate)),
  ) as HTMLElement | undefined;
  const acceptButton = buttons.find((candidate) =>
    ALLOWED_BUTTON_TEXT.has(normalizedText(candidate)),
  ) as HTMLElement | undefined;
  const button = rejectButton ?? acceptButton;
  if (!button) return;
  const text = normalizedText(button);
  button.click();
  clicked.push({
    vendor,
    selector,
    text,
    action: rejectButton ? "reject" : "accept",
  });
}

function detectBlockingOverlay(doc: Document): boolean {
  const x = Math.floor(doc.documentElement.clientWidth / 2);
  const y = Math.floor(doc.documentElement.clientHeight / 2);
  const element = doc.elementFromPoint?.(x, y);
  if (!element) return false;
  const style = doc.defaultView?.getComputedStyle(element);
  return style?.position === "fixed" && Number(style.zIndex || 0) >= 1000;
}

export function dismissKnownOverlays(doc: Document = document): OverlayDismissalResult {
  const clicked: OverlayDismissalClick[] = [];
  clickFirstAllowedButton(doc, "onetrust", "#onetrust-banner-sdk", clicked);
  clickFirstAllowedButton(doc, "cookiebot", "#CybotCookiebotDialog", clicked);
  clickFirstAllowedButton(doc, "usercentrics", "#usercentrics-root", clicked);

  return {
    clicked,
    blockingOverlayDetected: detectBlockingOverlay(doc),
  };
}
