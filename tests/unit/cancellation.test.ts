import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TimeoutError,
  createTimeoutSignal,
} from "../../src/background/sync/cancellation.js";

describe("createTimeoutSignal", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts after the configured timeout", async () => {
    vi.useFakeTimers();
    const timeout = createTimeoutSignal(1000, "Too slow");

    await vi.advanceTimersByTimeAsync(999);
    expect(timeout.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.signal.reason).toBeInstanceOf(TimeoutError);
    expect((timeout.signal.reason as Error).message).toBe("Too slow");
  });

  it("does not abort while paused and resumes with the remaining time", async () => {
    vi.useFakeTimers();
    const timeout = createTimeoutSignal(1000);

    await vi.advanceTimersByTimeAsync(400);
    timeout.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(timeout.signal.aborted).toBe(false);

    timeout.resume();
    await vi.advanceTimersByTimeAsync(599);
    expect(timeout.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(timeout.signal.aborted).toBe(true);
  });

  it("keeps the timeout paused until all pause holders resume", async () => {
    vi.useFakeTimers();
    const timeout = createTimeoutSignal(1000);

    await vi.advanceTimersByTimeAsync(250);
    timeout.pause();
    timeout.pause();

    timeout.resume();
    await vi.advanceTimersByTimeAsync(5000);
    expect(timeout.signal.aborted).toBe(false);

    timeout.resume();
    await vi.advanceTimersByTimeAsync(750);
    expect(timeout.signal.aborted).toBe(true);
  });

  it("does not abort after clear while paused", async () => {
    vi.useFakeTimers();
    const timeout = createTimeoutSignal(1000);

    timeout.pause();
    timeout.clear();
    timeout.resume();
    await vi.advanceTimersByTimeAsync(5000);

    expect(timeout.signal.aborted).toBe(false);
  });

  it("treats pause and resume after abort as no-ops", async () => {
    vi.useFakeTimers();
    const timeout = createTimeoutSignal(1000);

    await vi.advanceTimersByTimeAsync(1000);
    expect(timeout.signal.aborted).toBe(true);

    timeout.pause();
    timeout.resume();
    await vi.advanceTimersByTimeAsync(5000);

    expect(timeout.signal.aborted).toBe(true);
  });
});
