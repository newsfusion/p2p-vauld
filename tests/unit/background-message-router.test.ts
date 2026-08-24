import { describe, expect, it, vi } from "vitest";
import { createMessageRouter } from "../../src/background/message-router.js";

type TestMessage =
  | { type: "PING"; payload: { value: number } }
  | { type: "RESET" };

describe("background message router", () => {
  it("dispatches messages to a registered functional handler", async () => {
    const sendResponse = vi.fn();
    const router = createMessageRouter<TestMessage>({
      PING: async (message, respond) => {
        respond({ pong: message.payload.value });
      },
    });

    await router({ type: "PING", payload: { value: 42 } }, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ pong: 42 });
  });

  it("keeps the existing unknown-message response shape", async () => {
    const sendResponse = vi.fn();
    const router = createMessageRouter<TestMessage>({});

    await router({ type: "RESET" }, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      error: "Unknown message type",
    });
  });
});
