import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PortfolioHeader } from "../../src/dashboard/components/PortfolioHeader.js";

const eur = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "EUR",
  }).format(value);

describe("PortfolioHeader", () => {
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

  it("renders the portfolio page heading and summary copy", () => {
    flushSync(() => {
      root.render(
        React.createElement(PortfolioHeader, {
          totalValue: 1000,
          totalCash: 200,
          avgReturn: 6.5,
          privacyMode: false,
          isSyncing: false,
          hasConfiguredPlatforms: true,
        }),
      );
    });

    expect(container.textContent).toContain("Portfolio Overview");
    expect(container.textContent).toContain(
      "Real-time performance metrics across all integrated platforms.",
    );
  });

  it("does not render overview action buttons anymore", () => {
    flushSync(() => {
      root.render(
        React.createElement(PortfolioHeader, {
          totalValue: 1000,
          totalCash: 200,
          avgReturn: 6.5,
          privacyMode: false,
          isSyncing: false,
          hasConfiguredPlatforms: true,
        }),
      );
    });

    expect(container.querySelector("button")).toBeNull();
  });

  it("renders invested and free cash shares in their own cards", () => {
    flushSync(() => {
      root.render(
        React.createElement(PortfolioHeader, {
          totalValue: 800,
          totalCash: 200,
          avgReturn: 6.5,
          privacyMode: false,
          isSyncing: false,
          hasConfiguredPlatforms: true,
        }),
      );
    });

    const cards = Array.from(container.querySelectorAll(".glass-card"));
    const totalPortfolioCard = cards.find((card) =>
      card.textContent?.includes("Total Value"),
    );
    const freeCashCard = cards.find((card) => card.textContent?.includes("Free Cash"));

    expect(container.textContent).toContain(eur(1000));
    expect(totalPortfolioCard?.textContent).toContain("Total Value");
    expect(totalPortfolioCard?.textContent).toContain("80.0% invested");
    expect(totalPortfolioCard?.textContent).toContain(`${eur(800)} Portfolio Value`);
    expect(totalPortfolioCard?.textContent).not.toContain("20.0% free cash");
    expect(freeCashCard?.textContent).toContain("20.0% free cash");
    expect(freeCashCard?.textContent).not.toContain("20.0% of Total");
    expect(container.textContent).not.toContain("Available");
    expect(container.textContent).not.toContain("Ready to invest");
  });

  it("masks financial values in the DOM when privacy mode is enabled", () => {
    flushSync(() => {
      root.render(
        React.createElement(PortfolioHeader, {
          totalValue: 1234.56,
          totalCash: 78.9,
          avgReturn: 6.5,
          privacyMode: true,
          isSyncing: false,
          hasConfiguredPlatforms: true,
        }),
      );
    });

    expect(container.textContent).toContain("****,** €");
    expect(container.textContent).toContain("**%");
    expect(container.textContent).toContain("****,** € Portfolio Value");
    expect(container.textContent).not.toContain(eur(1234.56));
    expect(container.textContent).not.toContain(eur(1313.46));
    expect(container.textContent).not.toContain(eur(78.9));
    expect(container.textContent).not.toContain("94.0");
    expect(container.textContent).not.toContain("6.0");
    expect(container.textContent).not.toContain("6.50");
    expect(container.querySelector(".blur-sm")).toBeNull();
  });

  it("renders zero allocation shares when there is no capital", () => {
    flushSync(() => {
      root.render(
        React.createElement(PortfolioHeader, {
          totalValue: 0,
          totalCash: 0,
          avgReturn: null,
          privacyMode: false,
          isSyncing: false,
          hasConfiguredPlatforms: true,
        }),
      );
    });
    expect(container.textContent).toContain("0.0% invested");
    expect(container.textContent).toContain("0.0% free cash");
  });

  it("reserves one status row while switching sync and setup messages", () => {
    flushSync(() => {
      root.render(
        React.createElement(PortfolioHeader, {
          totalValue: 0,
          totalCash: 0,
          avgReturn: null,
          privacyMode: false,
          isSyncing: false,
          hasConfiguredPlatforms: true,
        }),
      );
    });

    const idleStatus = container.querySelector('[aria-live="polite"]');
    expect(idleStatus).toBeTruthy();
    expect(idleStatus?.className).toContain("min-h-5");
    expect(idleStatus?.textContent).toBe("");

    flushSync(() => {
      root.render(
        React.createElement(PortfolioHeader, {
          totalValue: 0,
          totalCash: 0,
          avgReturn: null,
          privacyMode: false,
          isSyncing: true,
          hasConfiguredPlatforms: true,
        }),
      );
    });

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "Syncing platforms...",
    );

    flushSync(() => {
      root.render(
        React.createElement(PortfolioHeader, {
          totalValue: 0,
          totalCash: 0,
          avgReturn: null,
          privacyMode: false,
          isSyncing: false,
          hasConfiguredPlatforms: false,
        }),
      );
    });

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      "Add credentials in Settings to enable sync.",
    );
  });
});
