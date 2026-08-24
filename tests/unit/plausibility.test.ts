import { describe, expect, it } from "vitest";
import { assessValue, assessOverviewInvariants } from "../../src/shared/plausibility.js";
import type { StoredMetricsSnapshot } from "../../src/shared/types/index.js";

const history: StoredMetricsSnapshot[] = [
  {
    platformId: "mintos",
    date: "2026-06-01",
    platformValue: 1000,
    freeCash: 100,
    fetchedAt: "2026-06-01T10:00:00.000Z",
  },
  {
    platformId: "mintos",
    date: "2026-06-02",
    platformValue: 1050,
    freeCash: 90,
    fetchedAt: "2026-06-02T10:00:00.000Z",
  },
  {
    platformId: "mintos",
    date: "2026-06-03",
    platformValue: 980,
    freeCash: 110,
    fetchedAt: "2026-06-03T10:00:00.000Z",
  },
];

describe("plausibility assessment", () => {
  it("marks zero portfolio values as placeholders when history was non-zero", () => {
    const result = assessValue({
      signalKey: "portfolio_value",
      value: 0,
      history,
    });

    expect(result.status).toBe("placeholder");
    expect(result.reasons).toContain("placeholder_zero");
  });

  it("marks large portfolio jumps as suspicious", () => {
    const result = assessValue({
      signalKey: "portfolio_value",
      value: 1800,
      history,
    });

    expect(result.status).toBe("suspicious");
    expect(result.reasons).toContain("portfolio_delta_gt_40pct");
  });

  it("does not apply a delta rule to free cash", () => {
    const result = assessValue({
      signalKey: "free_cash",
      value: 900,
      history,
    });

    expect(result.status).toBe("ok");
  });

  it("flags free cash above portfolio value as a soft invariant violation", () => {
    const result = assessOverviewInvariants({
      portfolioValue: 1000,
      freeCash: 1300,
      history,
    });

    expect(result.status).toBe("suspicious");
    expect(result.reasons).toContain("free_cash_exceeds_portfolio_value");
  });

  it("does not establish the free-cash invariant without history", () => {
    const result = assessOverviewInvariants({
      portfolioValue: 1000,
      freeCash: 1300,
      history: [],
    });

    expect(result.status).toBe("unknown");
    expect(result.reasons).toContain("invariant_not_established");
  });

  it("does not flag free cash above portfolio when history already has that pattern", () => {
    const result = assessOverviewInvariants({
      portfolioValue: 1000,
      freeCash: 1300,
      history: [
        {
          platformId: "mintos",
          date: "2026-06-01",
          platformValue: 1000,
          freeCash: 1300,
          fetchedAt: "2026-06-01T10:00:00.000Z",
        },
        {
          platformId: "mintos",
          date: "2026-06-02",
          platformValue: 1000,
          freeCash: 100,
          fetchedAt: "2026-06-02T10:00:00.000Z",
        },
      ],
    });

    expect(result.status).toBe("unknown");
    expect(result.reasons).toContain("invariant_not_established");
  });
});
