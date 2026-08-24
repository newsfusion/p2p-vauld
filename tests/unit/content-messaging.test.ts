import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendToTabWithTimeout } from "../../src/background/sync/content-messaging.js";

describe("content messaging timeout cancellation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not inject and retry after timeout aborts a delayed connection failure", async () => {
    const port = {
      executeScript: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(
              () => reject(new Error("Could not establish connection")),
              20,
            );
          }),
      ),
    };

    const result = sendToTabWithTimeout(
      7,
      { type: "LOGIN" },
      5,
      port,
    );
    const rejection = expect(result).rejects.toThrow(
      "Content script response timeout after 5ms (LOGIN): tabId=7",
    );

    await vi.advanceTimersByTimeAsync(5);
    await rejection;

    await vi.advanceTimersByTimeAsync(20);
    await Promise.resolve();
    expect(port.executeScript).not.toHaveBeenCalled();
    expect(port.sendMessage).toHaveBeenCalledTimes(1);
  });
});
