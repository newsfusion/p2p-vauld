import React from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { useDashboardStore } from "../../src/dashboard/store.js";

vi.mock("../../src/shared/platforms/index.js", () => ({
  getPlatformCatalog: () => [
    {
      id: "mintos",
      name: "Mintos",
      enabled: true,
      login: {
        entryUrl: "https://www.mintos.com/en/login",
        usernameSelectors: ["#login-username"],
        passwordSelectors: ["#login-password"],
        submitSelectors: ['button[type="submit"]'],
        otpSelectors: [],
        postLoginIndicators: [],
      },
      dashboard: {
        portfolioValueSelectors: [],
        freeCashSelectors: [],
        netAnnualReturnSelectors: [],
      },
    },
  ],
}));

vi.mock("../../tests/fixtures/platform-html-bundle.js", () => ({
  logins: {
    mintos: Promise.resolve({
      default: "<html><body><form><input id='fixture-login' /></form></body></html>",
    }),
  },
}));

describe("LoginExtractorTab", () => {
  let container: HTMLDivElement;
  let root: Root;
  let LoginExtractorTab: typeof import("../../src/dashboard/components/LoginExtractorTab.js").LoginExtractorTab;

  beforeAll(async () => {
    ({ LoginExtractorTab } = await import(
      "../../src/dashboard/components/LoginExtractorTab.js"
    ));
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useDashboardStore.setState({
      extractorTransfer: null,
      view: "overview",
    });
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.restoreAllMocks();
  });

  function renderTab(): void {
    flushSync(() => {
      root.render(React.createElement(LoginExtractorTab));
    });
  }

  async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function waitForResult(): Promise<void> {
    for (let i = 0; i < 25; i += 1) {
      if (container.textContent?.includes("Login Selectors Result")) {
        return;
      }
      await flushAsyncWork();
    }
    throw new Error("Login extractor result did not render");
  }

  it("prefers transferred login HTML over fixtures when present", async () => {
    useDashboardStore.getState().setExtractorTransfer({
      platformId: "mintos",
      platformName: "Mintos",
      pageType: "login",
      html: "<html><body><form><input id='transferred-login' /></form></body></html>",
      timestamp: "2026-05-25T12:00:00.000Z",
    });

    renderTab();

    expect(container.textContent).toContain("Transferred HTML");

    const transferredTestButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="transferred-login-test"]',
    );
    expect(transferredTestButton).not.toBeNull();

    transferredTestButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    await waitForResult();

    expect(container.textContent).toContain("Using transferred HTML");
    expect(container.textContent).not.toContain("Loaded HTML fixture");
  });

  it("shows a safe invalid-transfer state and can clear it", () => {
    useDashboardStore.setState({
      extractorTransfer: {
        platformId: "mintos-missing" as never,
        platformName: "Missing Platform",
        pageType: "login",
        html: "<html><body>Transferred</body></html>",
        timestamp: "2026-05-25T12:00:00.000Z",
      },
    });

    renderTab();

    expect(container.textContent).toContain("Transferred HTML is invalid");

    const clearButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="clear-login-transfer"]',
    );
    expect(clearButton).not.toBeNull();

    flushSync(() => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Transferred HTML is invalid");
    expect(container.textContent).toContain("HTML fixtures");
    expect(useDashboardStore.getState().extractorTransfer).toBeNull();
  });
});
