import { afterEach, describe, expect, it, vi } from "vitest";
import { installSessionActivityTracking } from "../../src/shared/session-activity.js";

describe("extension session activity", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports relevant activity at most once per cooldown window", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const cleanup = installSessionActivityTracking(notify);

    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    document.dispatchEvent(new Event("scroll", { bubbles: false }));
    window.dispatchEvent(new Event("focus"));
    expect(notify).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
    expect(notify).toHaveBeenCalledTimes(2);

    cleanup();
    vi.advanceTimersByTime(30_000);
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
