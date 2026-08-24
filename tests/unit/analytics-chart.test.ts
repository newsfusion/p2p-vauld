import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredOverviewMetrics } from "../../src/shared/types/index.js";

const getMetricsHistoryAllMock = vi.fn();
const getPlatformAllocationMock = vi.fn();
const getCashflowSummaryMock = vi.fn();

vi.mock("../../src/shared/db/index.js", () => ({
  getMetricsHistoryAll: getMetricsHistoryAllMock,
  getPlatformAllocation: getPlatformAllocationMock,
  getCashflowSummary: getCashflowSummaryMock,
}));

vi.mock("recharts", () => {
  const leaf = (name: string) => {
    const MockComponent = ({
      children,
      data,
      dataKey,
      ...props
    }: React.PropsWithChildren<Record<string, unknown>>) =>
      React.createElement(
        `mock-${name}`,
        {
          "data-recharts": name,
          ...(data === undefined
            ? {}
            : { "data-chart-data": JSON.stringify(data) }),
          ...(dataKey === undefined
            ? {}
            : { "data-series-key": String(dataKey) }),
          ...(typeof props.formatter === "function"
            ? {
                "data-formatted-value": JSON.stringify(
                  props.formatter(70, "Value"),
                ),
              }
            : {}),
        },
        React.Children.toArray(children).filter(
          (child) => !React.isValidElement(child) || child.type !== "defs",
        ),
      );
    MockComponent.displayName = name;
    return MockComponent;
  };

  return {
    Area: leaf("area"),
    AreaChart: leaf("area-chart"),
    Bar: leaf("bar"),
    BarChart: leaf("bar-chart"),
    CartesianGrid: leaf("cartesian-grid"),
    Cell: leaf("cell"),
    Legend: leaf("legend"),
    Line: leaf("line"),
    LineChart: leaf("line-chart"),
    Pie: leaf("pie"),
    PieChart: leaf("pie-chart"),
    ReferenceLine: leaf("reference-line"),
    Tooltip: leaf("tooltip"),
    XAxis: leaf("x-axis"),
    YAxis: leaf("y-axis"),
    ResponsiveContainer: ({ children, height, width }: React.PropsWithChildren<{ height: number | string; width: number | string }>) =>
      React.createElement(
        "div",
        {
          "data-testid": "responsive-container",
          "data-height": String(height),
          "data-width": String(width),
        },
        children,
      ),
  };
});

async function settleUi(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe("Analytics charts", () => {
  let container: HTMLDivElement;
  let root: Root;
  let Analytics: typeof import("../../src/dashboard/components/Analytics.js").Analytics;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    getMetricsHistoryAllMock.mockResolvedValue({
      cutoffDate: "2026-02-28",
      snapshots: [
        { date: "2026-02-28", platformId: "mintos", platformValue: 900 },
        { date: "2026-03-01", platformId: "mintos", platformValue: 1000 },
      ],
    });
    getPlatformAllocationMock.mockResolvedValue([
      { platformId: "mintos", name: "Mintos", totalValue: 1000 },
    ]);
    getCashflowSummaryMock.mockResolvedValue([
      { period: "Mar 26", interestEur: 10, netContributionEur: 100 },
    ]);

    ({ Analytics } = await import("../../src/dashboard/components/Analytics.js"));
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.clearAllMocks();
  });

  it("passes explicit numeric heights to ResponsiveContainer", async () => {
    const metrics: StoredOverviewMetrics[] = [
      {
        platformId: "mintos",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 1000,
        freeCash: 50,
        netAnnualReturnPct: 8.5,
        currency: "EUR",
        confidence: 0.9,
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(Analytics, {
          metrics,
          privacyMode: false,
        }),
      );
    });
    await settleUi();

    const chartContainers = Array.from(
      container.querySelectorAll<HTMLElement>('[data-testid="responsive-container"]'),
    );

    expect(chartContainers).toHaveLength(4);
    expect(chartContainers.map((node) => node.dataset.height)).toEqual([
      "280",
      "200",
      "280",
      "280",
    ]);
    expect(chartContainers.every((node) => node.dataset.width === "100%")).toBe(true);
  });

  it("renders portfolio-health labels instead of risk-event placeholders", async () => {
    const metrics: StoredOverviewMetrics[] = [
      {
        platformId: "mintos",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 7_000,
        freeCash: 500,
        netAnnualReturnPct: 8.5,
        currency: "EUR",
        confidence: 0.9,
      },
      {
        platformId: "peerberry",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 3_000,
        freeCash: 100,
        netAnnualReturnPct: 9.5,
        currency: "EUR",
        confidence: 0.8,
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(Analytics, {
          metrics,
          privacyMode: false,
        }),
      );
    });
    await settleUi();

    expect(container.textContent).toContain("Portfolio Value");
    expect(container.textContent).not.toContain("Total Portfolio");
    expect(container.textContent).toContain("Largest Platform Exposure");
    expect(container.textContent).toContain("Exposure Trend");
    expect(container.textContent).toContain("Excess Concentration");
    expect(container.textContent).not.toContain("Risk Exposure");
    expect(container.textContent).not.toContain("Risk Trend");
    expect(container.textContent).not.toContain("Risk Inventory");
  });

  it("masks concentration values in privacy mode", async () => {
    getMetricsHistoryAllMock.mockResolvedValue({
      cutoffDate: "2026-02-28",
      snapshots: [
        { date: "2026-02-28", platformId: "mintos", platformValue: 6_000 },
        { date: "2026-03-01", platformId: "mintos", platformValue: 7_000 },
        { date: "2026-02-28", platformId: "peerberry", platformValue: 3_000 },
        { date: "2026-03-01", platformId: "peerberry", platformValue: 3_000 },
      ],
    });
    const metrics: StoredOverviewMetrics[] = [
      {
        platformId: "mintos",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 7_000,
        freeCash: 500,
        netAnnualReturnPct: 8.5,
        currency: "EUR",
        confidence: 0.9,
      },
      {
        platformId: "peerberry",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 3_000,
        freeCash: 100,
        netAnnualReturnPct: 9.5,
        currency: "EUR",
        confidence: 0.8,
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(Analytics, {
          metrics,
          privacyMode: true,
        }),
      );
    });
    await settleUi();

    expect(container.textContent).toContain("**%");
    expect(container.textContent).not.toContain("70.0%");
    expect(container.textContent).not.toContain("8.50%");
    expect(container.textContent).not.toContain("11.1%");
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>("[data-formatted-value]"),
      ).every((node) => !node.dataset.formattedValue?.includes("70%")),
    ).toBe(true);
  });

  it("weights average return by platform value and shows no value when returns are missing", async () => {
    const metrics: StoredOverviewMetrics[] = [
      {
        platformId: "mintos",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 7_000,
        freeCash: 500,
        netAnnualReturnPct: 8,
        currency: "EUR",
        confidence: 0.9,
      },
      {
        platformId: "peerberry",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 3_000,
        freeCash: 100,
        netAnnualReturnPct: 12,
        currency: "EUR",
        confidence: 0.8,
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(Analytics, { metrics, privacyMode: false }),
      );
    });
    await settleUi();

    expect(container.textContent).toContain("9.20%");

    flushSync(() => {
      root.render(
        React.createElement(Analytics, {
          metrics: metrics.map(({ netAnnualReturnPct: _return, ...metric }) =>
            metric,
          ),
          privacyMode: false,
        }),
      );
    });

    const avgReturnCard = Array.from(container.querySelectorAll("article")).find(
      (article) => article.textContent?.includes("Avg Return"),
    );
    expect(avgReturnCard?.textContent).toContain("—");
  });

  it("renders effective platforms, an FX warning, and empty cashflow summaries", async () => {
    getCashflowSummaryMock.mockResolvedValue([]);
    const metrics: StoredOverviewMetrics[] = [
      {
        platformId: "mintos",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 5_000,
        freeCash: 500,
        currency: "USD",
        confidence: 0.9,
      },
      {
        platformId: "peerberry",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 5_000,
        freeCash: 100,
        currency: "EUR",
        confidence: 0.8,
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(Analytics, { metrics, privacyMode: false }),
      );
    });
    await settleUi();

    expect(container.textContent).toContain("Effective Platforms");
    expect(container.textContent).toContain("HHI 5000");
    expect(container.textContent).toContain(
      "Values from Mintos are not in EUR and are summed without currency conversion.",
    );
    const interestCards = Array.from(container.querySelectorAll("article")).filter(
      (article) =>
        article.textContent?.includes("Total Interest") ||
        article.textContent?.includes("Monthly Avg Interest"),
    );
    expect(interestCards).toHaveLength(2);
    expect(interestCards.every((card) => card.textContent?.includes("—"))).toBe(
      true,
    );
  });

  it("changes the shared history period and derives monthly value changes", async () => {
    getMetricsHistoryAllMock.mockResolvedValue({
      cutoffDate: "2026-01-31",
      snapshots: [
        { date: "2026-01-31", platformId: "mintos", platformValue: 100 },
        { date: "2026-02-28", platformId: "mintos", platformValue: 130 },
        { date: "2026-03-31", platformId: "mintos", platformValue: 120 },
      ],
    });
    getCashflowSummaryMock.mockResolvedValue([
      { period: "2026-02", interestEur: 5, netContributionEur: 0 },
      { period: "2026-03", interestEur: 7, netContributionEur: 0 },
    ]);

    flushSync(() => {
      root.render(
        React.createElement(Analytics, {
          metrics: [
            {
              platformId: "mintos",
              fetchedAt: "2026-03-31T12:00:00.000Z",
              platformValue: 120,
              freeCash: 10,
              currency: "EUR",
              confidence: 0.9,
            },
          ],
          privacyMode: false,
        }),
      );
    });
    await settleUi();

    expect(container.textContent).toContain("Monthly Value Change");
    const monthlyChart = Array.from(
      container.querySelectorAll<HTMLElement>('[data-recharts="bar-chart"]'),
    ).find((chart) => chart.dataset.chartData?.includes("valueChangeEur"));
    expect(JSON.parse(monthlyChart?.dataset.chartData ?? "[]")).toMatchObject([
      { valueChangeEur: 30, interestEur: 5 },
      { valueChangeEur: -10, interestEur: 7 },
    ]);

    const allButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent === "All");
    const allocationCallsBeforeRangeChange =
      getPlatformAllocationMock.mock.calls.length;
    const cashflowCallsBeforeRangeChange = getCashflowSummaryMock.mock.calls.length;
    allButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settleUi();

    expect(getMetricsHistoryAllMock).toHaveBeenLastCalledWith(0, undefined);
    expect(allButton?.getAttribute("aria-pressed")).toBe("true");
    expect(getPlatformAllocationMock).toHaveBeenCalledTimes(
      allocationCallsBeforeRangeChange,
    );
    expect(getCashflowSummaryMock).toHaveBeenCalledTimes(
      cashflowCallsBeforeRangeChange,
    );
  });

  it("passes visible platform ids to financial history helpers", async () => {
    const metrics: StoredOverviewMetrics[] = [
      {
        platformId: "mintos",
        fetchedAt: "2026-03-01T12:00:00.000Z",
        platformValue: 1000,
        freeCash: 50,
        currency: "EUR",
        confidence: 0.9,
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(Analytics, {
          metrics,
          privacyMode: false,
          visiblePlatformIds: ["mintos"],
        }),
      );
    });
    await settleUi();

    expect(getMetricsHistoryAllMock).toHaveBeenCalledWith(90, ["mintos"]);
    expect(getPlatformAllocationMock).toHaveBeenCalledWith(["mintos"]);
    expect(getCashflowSummaryMock).toHaveBeenCalledWith(12, ["mintos"]);
  });

  it("uses predecessor snapshots at the left boundary for wealth and exposure", async () => {
    getMetricsHistoryAllMock.mockResolvedValue({
      cutoffDate: "2026-03-05",
      snapshots: [
        { date: "2026-03-04", platformId: "peerberry", platformValue: 50 },
        { date: "2026-03-05", platformId: "mintos", platformValue: 100 },
        { date: "2026-03-07", platformId: "peerberry", platformValue: 55 },
      ],
    });

    flushSync(() => {
      root.render(
        React.createElement(Analytics, {
          metrics: [],
          privacyMode: false,
          visiblePlatformIds: ["mintos", "peerberry"],
        }),
      );
    });
    await settleUi();

    const wealthChart = container.querySelector<HTMLElement>(
      '[data-recharts="area-chart"]',
    );
    const exposureChart = container.querySelector<HTMLElement>(
      '[data-recharts="line-chart"]',
    );
    expect(JSON.parse(wealthChart?.dataset.chartData ?? "[]")).toMatchObject([
      { date: "2026-03-05", value: 150 },
      { date: "2026-03-06", value: 150 },
      { date: "2026-03-07", value: 155 },
    ]);
    expect(JSON.parse(exposureChart?.dataset.chartData ?? "[]")).toMatchObject([
      { date: "2026-03-05", exposurePct: 66.7 },
      { date: "2026-03-06", exposurePct: 66.7 },
      { date: "2026-03-07", exposurePct: 64.5 },
    ]);
  });
});
