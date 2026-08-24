import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  setLoggerProductionModeForTests,
} from "../../src/shared/logger.js";

function useLoggerMode(production: boolean): void {
  setLoggerProductionModeForTests(production);
}

describe("structured logger", () => {
  afterEach(() => {
    setLoggerProductionModeForTests(null);
    vi.restoreAllMocks();
  });

  it("emits debug entries with module + context", () => {
    useLoggerMode(false);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = createLogger("content");

    log.debug("content loaded", { url: "https://example.com" });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      "[P2P] content: content loaded",
      expect.objectContaining({
        level: "debug",
        module: "content",
        msg: "content loaded",
      }),
      { url: "https://example.com" },
    );
  });

  it("suppresses debug entries in production", () => {
    useLoggerMode(true);
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const log = createLogger("content");

    log.debug("content loaded", { url: "https://example.com/dashboard" });

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("routes error level to console.error", () => {
    useLoggerMode(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger("background");

    log.error("sync failed", { runId: "run-123" });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "[P2P] background: sync failed",
      expect.objectContaining({
        level: "error",
        module: "background",
        msg: "sync failed",
      }),
      { runId: "run-123" },
    );
  });

  it("puts the module and message in the first console argument for extension error pages", () => {
    useLoggerMode(false);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = createLogger("background");

    log.error("Failed to clean up stale syncs", { error: "boom" });

    expect(errorSpy).toHaveBeenCalledWith(
      "[P2P] background: Failed to clean up stale syncs",
      expect.objectContaining({
        level: "error",
        module: "background",
        msg: "Failed to clean up stale syncs",
      }),
      { error: "boom" },
    );
  });

  it("redacts sensitive warn context in production", () => {
    useLoggerMode(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("background");

    log.warn("Sync warning for https://example.com/dashboard", {
      url: "https://example.com/dashboard",
      username: "user@example.com",
      portfolioValue: 12345.67,
      encryptedPassword: { ciphertext: "secret" },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[P2P] background: Sync warning for [redacted-url]",
      expect.objectContaining({
        level: "warn",
        msg: "Sync warning for [redacted-url]",
      }),
      {
        url: "[redacted-url]",
        username: "[redacted-email]",
        portfolioValue: "[redacted-financial-value]",
        encryptedPassword: "[redacted-secret]",
      },
    );
  });

  it("keeps generic value-like keys visible in production", () => {
    useLoggerMode(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("background");

    log.warn("generic payload", {
      value: "error code 404",
      amount: 3,
      balance: "stale",
      platformValue: 12345.67,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[P2P] background: generic payload",
      expect.objectContaining({
        level: "warn",
        msg: "generic payload",
      }),
      {
        value: "error code 404",
        amount: 3,
        balance: "stale",
        platformValue: "[redacted-financial-value]",
      },
    );
  });

  it("handles cyclic objects without throwing", () => {
    useLoggerMode(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("background");
    const context: Record<string, unknown> = { label: "root" };

    context.self = context;

    expect(() => log.warn("cycle", context)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(
      "[P2P] background: cycle",
      expect.objectContaining({
        level: "warn",
        msg: "cycle",
      }),
      {
        label: "root",
        self: "[redacted-circular]",
      },
    );
  });

  it("caps deep nested structures during redaction", () => {
    useLoggerMode(true);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = createLogger("background");

    log.warn("deep context", {
      nested: {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: "too deep",
                },
              },
            },
          },
        },
      },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "[P2P] background: deep context",
      expect.objectContaining({
        level: "warn",
        msg: "deep context",
      }),
      {
        nested: {
          level1: {
            level2: {
              level3: {
                level4: "[redacted-depth-limit]",
              },
            },
          },
        },
      },
    );
  });
});
