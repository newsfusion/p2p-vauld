import { describe, expect, it, vi } from "vitest";
import { getFaviconUrl } from "../../src/shared/platforms/favicon.js";

const runtimeGetURL = (path: string) => `chrome-extension://test-extension${path}`;

describe("getFaviconUrl", () => {
  it("builds a Chrome extension favicon URL with an encoded page URL and default size", () => {
    expect(
      getFaviconUrl("https://www.mintos.com/de/?ref=dashboard&lang=de", {
        runtimeGetURL,
      }),
    ).toBe(
      "chrome-extension://test-extension/_favicon/?pageUrl=https%3A%2F%2Fwww.mintos.com%2Fde%2F%3Fref%3Ddashboard%26lang%3Dde&size=32",
    );
  });

  it("allows an explicit positive integer favicon size", () => {
    expect(
      getFaviconUrl("https://peerberry.com/", {
        runtimeGetURL,
        size: 64,
      }),
    ).toBe(
      "chrome-extension://test-extension/_favicon/?pageUrl=https%3A%2F%2Fpeerberry.com%2F&size=64",
    );
  });

  it("returns null for invalid, unsafe, or unsupported inputs", () => {
    expect(getFaviconUrl("", { runtimeGetURL })).toBeNull();
    expect(getFaviconUrl("not a url", { runtimeGetURL })).toBeNull();
    expect(getFaviconUrl("javascript:alert(1)", { runtimeGetURL })).toBeNull();
    expect(getFaviconUrl("chrome://extensions", { runtimeGetURL })).toBeNull();
    expect(
      getFaviconUrl("https://peerberry.com/", {
        runtimeGetURL,
        size: 0,
      }),
    ).toBeNull();
  });

  it("returns null when the Chrome runtime URL helper is unavailable", () => {
    vi.stubGlobal("chrome", { runtime: {} });

    expect(getFaviconUrl("https://peerberry.com/")).toBeNull();
  });
});
