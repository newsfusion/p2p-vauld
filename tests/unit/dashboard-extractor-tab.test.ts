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

const checkAiAvailabilityMock = vi.fn(
  async (): Promise<{
    status:
      | "api_not_supported"
      | "unavailable"
      | "downloadable"
      | "downloading"
      | "available";
  }> => ({ status: "unavailable" }),
);
const createAiSessionMock = vi.fn();

vi.mock("../../src/shared/platforms/index.js", () => ({
  getPlatformCatalog: () => [
    {
      id: "mintos",
      name: "Mintos",
      enabled: true,
      dashboard: {
        portfolioValueSelectors: [".portfolio"],
        freeCashSelectors: [".cash"],
        netAnnualReturnSelectors: [".yield"],
      },
    },
  ],
}));

vi.mock("../../src/content/html-cleanup.js", () => ({
  cleanHtml: (doc: Document) => ({
    root: doc.body,
    stats: {
      rawLength: 200,
      cleanedLength: 120,
      reductionPct: 40,
      elementsRemoved: 2,
    },
  }),
}));

vi.mock("../../src/content/extractor.js", () => ({
  collectFinancialCandidates: () => ({
    candidates: [],
    elementsScanned: 5,
  }),
  pickBestCandidate: () => ({
    value: null,
    confidence: 0,
    candidate: undefined,
  }),
}));

vi.mock("../../src/content/text-tree.js", () => ({
  getVisibleTextTree: () => ["Portfolio", "€12,345"],
  textTreeToString: () => ({
    json: '["Portfolio","€12,345"]',
    truncated: false,
    textNodeCount: 2,
  }),
  countTextNodes: () => 2,
}));

vi.mock("../../src/content/ai-shared.js", () => ({
  checkAiAvailability: () => checkAiAvailabilityMock(),
  createAiSession: (...args: unknown[]) => createAiSessionMock(...args),
}));

vi.mock("../../tests/fixtures/platform-html-bundle.js", () => ({
  dashboards: {
    mintos: Promise.resolve({
      default: "<html><body><main><div>Portfolio €12,345</div></main></body></html>",
    }),
  },
}));

describe("DashboardExtractorTab", () => {
  let container: HTMLDivElement;
  let root: Root;
  let DashboardExtractorTab: typeof import("../../src/dashboard/components/DashboardExtractorTab.js").DashboardExtractorTab;
  let withTimeout: typeof import("../../src/dashboard/components/DashboardExtractorTab.js").withTimeout;

  beforeAll(async () => {
    ({ DashboardExtractorTab, withTimeout } = await import(
      "../../src/dashboard/components/DashboardExtractorTab.js"
    ));
  });

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    checkAiAvailabilityMock.mockReset();
    checkAiAvailabilityMock.mockResolvedValue({ status: "unavailable" });
    createAiSessionMock.mockReset();
    useDashboardStore.setState({
      extractorTransfer: null,
      view: "overview",
    });
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderTab(): void {
    flushSync(() => {
      root.render(React.createElement(DashboardExtractorTab));
    });
  }

  function findTestButton(): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent?.trim() === "Test",
    );
  }

  async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function waitForResult(): Promise<void> {
    for (let i = 0; i < 25; i += 1) {
      if (container.textContent?.includes("Dashboard Extractor Result")) {
        return;
      }
      await flushAsyncWork();
    }
    throw new Error("Dashboard extractor result did not render");
  }

  it("does not log missing key warning when rendering AI prompt lists", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderTab();
    const testButton = findTestButton();
    expect(testButton).toBeTruthy();
    testButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForResult();

    const keyWarnings = consoleErrorSpy.mock.calls.filter(([firstArg]) =>
      typeof firstArg === "string"
        ? firstArg.includes('Each child in a list should have a unique "key" prop')
        : false,
    );

    expect(keyWarnings).toHaveLength(0);
  });

  it("times out hanging async work to prevent endless loading", async () => {
    vi.useFakeTimers();
    const pending = new Promise<never>(() => {});
    const timedPromise = withTimeout(pending, 50, "timed out");
    const rejection = expect(timedPromise).rejects.toThrow("timed out");

    await vi.advanceTimersByTimeAsync(51);
    await rejection;
  });

  it("uses strict AI prompts for portfolio and free_cash", async () => {
    checkAiAvailabilityMock.mockResolvedValue({ status: "available" });
    const prompts: string[] = [];

    createAiSessionMock.mockImplementation(async () => ({
      prompt: async (input: string) => {
        prompts.push(input);
        if (input.includes('"portfolio_value"')) {
          return '{"portfolio_value":12345.67,"currency":"EUR"}';
        }
        if (input.includes('"free_cash"')) {
          return '{"free_cash":807.83,"currency":"EUR"}';
        }
        return '{"value":9.1,"currency":"EUR"}';
      },
      destroy: () => {},
    }));

    renderTab();
    const testButton = findTestButton();
    expect(testButton).toBeTruthy();
    testButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForResult();

    expect(createAiSessionMock).toHaveBeenCalled();
    expect(prompts.some((p) => p.includes("### INPUT_TEXT_TREE"))).toBe(true);
    expect(
      prompts.some((p) =>
        p.includes('{"portfolio_value": number, "currency": string}'),
      ),
    ).toBe(true);
    expect(
      prompts.some((p) => p.includes('{"free_cash": number, "currency": string}')),
    ).toBe(true);
  });

  it("prefers transferred dashboard HTML over fixtures when present", async () => {
    useDashboardStore.getState().setExtractorTransfer({
      platformId: "mintos",
      platformName: "Mintos",
      pageType: "dashboard",
      html: "<html><body><main><div>Transferred Dashboard</div></main></body></html>",
      timestamp: "2026-05-25T12:00:00.000Z",
    });

    renderTab();

    expect(container.textContent).toContain("Transferred HTML");

    const transferredTestButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="transferred-dashboard-test"]',
    );
    expect(transferredTestButton).not.toBeNull();

    transferredTestButton?.dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );

    await waitForResult();

    expect(container.textContent).toContain("Using transferred HTML");
    expect(container.textContent).not.toContain("Loaded HTML fixture");
  });

  it("can clear an invalid transferred dashboard payload and fall back to fixtures", () => {
    useDashboardStore.setState({
      extractorTransfer: {
        platformId: "mintos-missing" as never,
        platformName: "Missing Platform",
        pageType: "dashboard",
        html: "<html><body>Transferred</body></html>",
        timestamp: "2026-05-25T12:00:00.000Z",
      },
    });

    renderTab();

    expect(container.textContent).toContain("Transferred HTML is invalid");

    const clearButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="clear-dashboard-transfer"]',
    );
    expect(clearButton).not.toBeNull();

    flushSync(() => {
      clearButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).not.toContain("Transferred HTML is invalid");
    expect(container.textContent).toContain("CSS + AI fixtures");
    expect(useDashboardStore.getState().extractorTransfer).toBeNull();
  });
});
