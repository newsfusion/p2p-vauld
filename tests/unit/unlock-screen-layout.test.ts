import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { UnlockScreen } from "../../src/dashboard/components/UnlockScreen.js";

describe("UnlockScreen layout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root.unmount();
    container.remove();
  });

  it("renders the login form before the hero panel on desktop", () => {
    flushSync(() => {
      root.render(React.createElement(UnlockScreen, { onUnlocked: () => undefined }));
    });

    const panels = container.querySelectorAll("section");

    expect(panels).toHaveLength(2);
    expect(panels[0]?.textContent).toContain("Welcome back");
    expect(panels[0]?.textContent).not.toContain("Your portfolio");
    expect(panels[1]?.textContent).toContain("Your portfolio");
  });

  it("uses the project banner instead of legacy vauld branding", () => {
    flushSync(() => {
      root.render(React.createElement(UnlockScreen, { onUnlocked: () => undefined }));
    });

    expect(container.querySelectorAll('img[src="/vauld-banner.png"]')).toHaveLength(2);
    expect(container.textContent).toContain("P2P Portfolio Tracker");
    expect(container.textContent).not.toContain("P2P Vauld");
  });
});
