import { afterEach, describe, expect, it, vi } from "vitest";

const checkGeminiAvailabilityMock = vi.fn();
const createSessionMock = vi.fn();

vi.mock("../../src/shared/ai/gemini.js", () => ({
  checkGeminiAvailability: () => checkGeminiAvailabilityMock(),
}));

vi.mock("../../src/shared/ai/provider.js", () => ({
  getPromptApiLanguageModel: () => ({
    create: createSessionMock,
  }),
  PROMPT_API_TEXT_LANGUAGE_OPTIONS: {
    expectedInputs: [{ type: "text" }],
    expectedOutputs: [{ type: "text" }],
  },
}));

describe("aiExtractSignalFromTextTree timeout handling", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("returns diagnostic failures, enters cooldown, and retries after cooldown when Gemini session creation hangs", async () => {
    vi.useFakeTimers();
    checkGeminiAvailabilityMock.mockResolvedValue({ status: "available" });
    const promptMock = vi.fn().mockResolvedValue(
      '{"free_cash":500,"currency":"EUR"}',
    );
    const destroyMock = vi.fn();
    createSessionMock
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce({
        prompt: promptMock,
        destroy: destroyMock,
      });

    const { aiExtractSignalFromTextTree } = await import(
      "../../src/background/sync/extraction-orchestrator.js"
    );

    const firstAttempt = aiExtractSignalFromTextTree(
      '["Dashboard",["Portfolio Value","€10,000.00"]]',
      "portfolio_value",
    );
    await vi.advanceTimersByTimeAsync(15_001);
    await expect(firstAttempt).resolves.toEqual({
      ok: false,
      aiLog: expect.objectContaining({
        available: true,
        error: "Gemini Nano session creation timed out",
      }),
    });

    await expect(
      aiExtractSignalFromTextTree(
        '["Dashboard",["Free Cash","€500.00"]]',
        "free_cash",
      ),
    ).resolves.toEqual({
      ok: false,
      aiLog: expect.objectContaining({
        available: false,
        reason: "unavailable",
        error: "cooldown_after_timeout",
      }),
    });

    await vi.advanceTimersByTimeAsync(60_000);
    await expect(
      aiExtractSignalFromTextTree(
        '["Dashboard",["Free Cash","€500.00"]]',
        "free_cash",
      ),
    ).resolves.toEqual({
      ok: true,
      value: 500,
      currency: "EUR",
      aiLog: expect.objectContaining({
        available: true,
        parsedValue: 500,
      }),
    });
    expect(createSessionMock).toHaveBeenCalledTimes(2);
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("returns diagnostic failures and enters cooldown when Gemini prompt hangs", async () => {
    vi.useFakeTimers();
    checkGeminiAvailabilityMock.mockResolvedValue({ status: "available" });
    const promptMock = vi.fn(() => new Promise(() => undefined));
    const destroyMock = vi.fn();
    createSessionMock.mockResolvedValue({
      prompt: promptMock,
      destroy: destroyMock,
    });

    const { aiExtractSignalFromTextTree } = await import(
      "../../src/background/sync/extraction-orchestrator.js"
    );

    const firstAttempt = aiExtractSignalFromTextTree(
      '["Dashboard",["Portfolio Value","€10,000.00"]]',
      "portfolio_value",
    );
    await vi.advanceTimersByTimeAsync(12_001);
    await expect(firstAttempt).resolves.toEqual({
      ok: false,
      aiLog: expect.objectContaining({
        available: true,
        error: "Gemini Nano prompt timed out",
      }),
    });

    await expect(
      aiExtractSignalFromTextTree(
        '["Dashboard",["Free Cash","€500.00"]]',
        "free_cash",
      ),
    ).resolves.toEqual({
      ok: false,
      aiLog: expect.objectContaining({
        available: false,
        reason: "unavailable",
        error: "cooldown_after_timeout",
      }),
    });
    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });
});
