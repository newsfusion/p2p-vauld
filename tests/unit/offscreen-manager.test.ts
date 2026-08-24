import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("offscreen manager", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  function mockChrome() {
    let hasDocument = false;
    const createDocument = vi.fn().mockImplementation(async () => {
      hasDocument = true;
    });
    const closeDocument = vi.fn().mockImplementation(async () => {
      hasDocument = false;
    });
    const getContexts = vi.fn().mockImplementation(async () =>
      hasDocument ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : [],
    );
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    (globalThis as Record<string, unknown>).chrome = {
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
        getContexts,
        sendMessage,
      },
      offscreen: {
        createDocument,
        closeDocument,
        Reason: { DOM_PARSER: "DOM_PARSER" },
      },
    };

    return { createDocument, closeDocument, getContexts, sendMessage };
  }

  it("creates one offscreen document and closes it after the final lease", async () => {
    const chromeMocks = mockChrome();
    const manager = await import("../../src/background/offscreen-manager.js");

    const releaseSync = await manager.acquireOffscreenLease("sync");
    await manager.withOffscreenLease("db", async () => undefined);

    expect(chromeMocks.createDocument).toHaveBeenCalledTimes(1);
    expect(chromeMocks.closeDocument).not.toHaveBeenCalled();

    await releaseSync();

    expect(chromeMocks.closeDocument).toHaveBeenCalledTimes(1);
  });

  it("sends heartbeat control messages through runtime messaging", async () => {
    const chromeMocks = mockChrome();
    const manager = await import("../../src/background/offscreen-manager.js");

    await manager.startOffscreenHeartbeat(12_345);
    await manager.stopOffscreenHeartbeat();

    expect(chromeMocks.sendMessage).toHaveBeenNthCalledWith(1, {
      type: "OFFSCREEN_START_HEARTBEAT",
      payload: { intervalMs: 12_345 },
    });
    expect(chromeMocks.sendMessage).toHaveBeenNthCalledWith(2, {
      type: "OFFSCREEN_STOP_HEARTBEAT",
    });
  });
});
