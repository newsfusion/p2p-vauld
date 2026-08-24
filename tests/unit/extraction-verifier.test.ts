import { describe, expect, it, vi } from "vitest";
import { CancelledError } from "../../src/background/sync/cancellation.js";
import { runConvergentExtraction } from "../../src/background/sync/extraction-verifier.js";
import type { ExtractSignalResult } from "../../src/background/sync/debug-logger.js";

function result(value: number, score = 4): ExtractSignalResult {
  return {
    value,
    confidence: 0.7,
    candidate: {
      selector: ".value",
      text: `${value}`,
      value,
      score,
      origin: "heuristic",
    },
    allCandidates: [
      {
        selector: ".value",
        text: `${value}`,
        value,
        score,
        origin: "heuristic",
      },
    ],
    elementsScanned: 10,
  };
}

describe("convergent extraction verifier", () => {
  it("waits for two stable non-placeholder polls", async () => {
    const extract = vi
      .fn()
      .mockResolvedValueOnce({
        portfolio_value: result(0),
        free_cash: result(0),
      })
      .mockResolvedValueOnce({
        portfolio_value: result(1000),
        free_cash: result(100),
      })
      .mockResolvedValueOnce({
        portfolio_value: result(1000),
        free_cash: result(100),
      });

    const verified = await runConvergentExtraction({
      extract,
      history: [
        {
          platformId: "mintos",
          date: "2026-06-01",
          platformValue: 1000,
          freeCash: 100,
          fetchedAt: "2026-06-01T10:00:00.000Z",
        },
      ],
      intervalMs: 1,
      maxWaitMs: 100,
    });

    expect(verified.portfolio.value).toBe(1000);
    expect(verified.freeCash.value).toBe(100);
    expect(verified.pollCount).toBe(3);
  });

  it("marks unresolved placeholder convergence as suspect instead of accepting it", async () => {
    const extract = vi.fn().mockResolvedValue({
      portfolio_value: result(0),
      free_cash: result(0),
    });

    const verified = await runConvergentExtraction({
      extract,
      history: [
        {
          platformId: "mintos",
          date: "2026-06-01",
          platformValue: 1000,
          freeCash: 100,
          fetchedAt: "2026-06-01T10:00:00.000Z",
        },
      ],
      intervalMs: 1,
      maxWaitMs: 5,
    });

    expect(verified.converged).toBe(false);
    expect(verified.warnings).toContain("placeholder_zero");
  });

  it("does not converge when both signals use the same heuristic DOM candidate", async () => {
    const duplicate = result(15800.7, 4.2);
    const extract = vi.fn().mockResolvedValue({
      portfolio_value: duplicate,
      free_cash: duplicate,
    });

    const verified = await runConvergentExtraction({
      extract,
      history: [],
      intervalMs: 1,
      maxWaitMs: 5,
    });

    expect(verified.converged).toBe(false);
    expect(verified.warnings).toContain("duplicate_signal_candidate");
  });

  it("allows equal values from different heuristic DOM candidates", async () => {
    const extract = vi.fn().mockResolvedValue({
      portfolio_value: result(1000),
      free_cash: {
        ...result(1000),
        candidate: {
          selector: ".cash",
          text: "1000",
          value: 1000,
          score: 4,
          origin: "heuristic",
          context: "Available cash 1000",
        },
        allCandidates: [
          {
            selector: ".cash",
            text: "1000",
            value: 1000,
            score: 4,
            origin: "heuristic",
            context: "Available cash 1000",
          },
        ],
      },
    });

    const verified = await runConvergentExtraction({
      extract,
      history: [],
      intervalMs: 1,
      maxWaitMs: 20,
    });

    expect(verified.converged).toBe(true);
    expect(verified.warnings).not.toContain("duplicate_signal_candidate");
  });

  it("warns when free cash exceeds the portfolio value", async () => {
    const extract = vi.fn().mockResolvedValue({
      portfolio_value: result(1000),
      free_cash: {
        ...result(5000),
        candidate: {
          selector: ".cash",
          text: "5000",
          value: 5000,
          score: 4,
          origin: "heuristic",
          context: "Available cash 5000",
        },
        allCandidates: [
          {
            selector: ".cash",
            text: "5000",
            value: 5000,
            score: 4,
            origin: "heuristic",
            context: "Available cash 5000",
          },
        ],
      },
    });

    const verified = await runConvergentExtraction({
      extract,
      history: [],
      intervalMs: 1,
      maxWaitMs: 5,
    });

    expect(verified.converged).toBe(false);
    expect(verified.warnings).toContain("free_cash_exceeds_portfolio");
  });

  it("rejects promptly when cancelled during the poll delay", async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = runConvergentExtraction({
        extract: vi.fn().mockResolvedValue({
          portfolio_value: result(1000),
          free_cash: result(100),
        }),
        history: [],
        intervalMs: 1000,
        maxWaitMs: 15_000,
        signal: controller.signal,
      });

      await Promise.resolve();
      controller.abort();

      await expect(pending).rejects.toBeInstanceOf(CancelledError);
    } finally {
      vi.useRealTimers();
    }
  });
});
