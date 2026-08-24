import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abortableDelay, CancelledError } from "../../src/background/sync/cancellation.js";
import {
  runPlatforms,
  runPlatformsSequentially,
} from "../../src/background/sync/sync-runner.js";

describe("runPlatformsSequentially", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for each platform runner before starting the next one", async () => {
    const events: string[] = [];

    const done = runPlatformsSequentially(["mintos", "debitum", "peerberry"], async (platform) => {
      events.push(`start:${platform}`);
      await Promise.resolve();
      events.push(`end:${platform}`);
    });

    // Flush microtasks + jitter timers for each platform
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(4_000);
    }

    await done;

    expect(events).toEqual([
      "start:mintos",
      "end:mintos",
      "start:debitum",
      "end:debitum",
      "start:peerberry",
      "end:peerberry",
    ]);
  });

  it("caps concurrent platform starts when parallel mode is enabled", async () => {
    const starts: string[] = [];
    const releases = new Map<string, () => void>();
    let active = 0;
    let maxActive = 0;

    const done = runPlatforms(
      ["mintos", "debitum", "peerberry"],
      async (platform) => {
        starts.push(platform);
        active += 1;
        maxActive = Math.max(maxActive, active);

        await new Promise<void>((resolve) => {
          releases.set(platform, () => {
            active -= 1;
            resolve();
          });
        });
      },
      { concurrency: 2 },
    );

    await vi.advanceTimersByTimeAsync(4_000);
    expect(starts).toEqual(["mintos", "debitum"]);
    expect(maxActive).toBe(2);

    releases.get("mintos")?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);

    expect(starts).toEqual(["mintos", "debitum", "peerberry"]);
    expect(maxActive).toBe(2);

    releases.get("debitum")?.();
    releases.get("peerberry")?.();
    await done;
  });

  it("waits for manual-action gate before starting next platform", async () => {
    const starts: string[] = [];
    let gateBlocked = false;
    let releaseGate: (() => void) | undefined;

    const done = runPlatforms(
      ["mintos", "debitum"],
      async (platform) => {
        starts.push(platform);
      },
      {
        concurrency: 2,
        waitForClear: async () => {
          if (!gateBlocked) return;
          await new Promise<void>((resolve) => {
            releaseGate = resolve;
          });
        },
      },
    );

    await Promise.resolve();
    gateBlocked = true;
    await vi.advanceTimersByTimeAsync(4_000);

    expect(starts).toEqual(["mintos"]);

    gateBlocked = false;
    const currentReleaseGate = releaseGate;
    if (currentReleaseGate) {
      currentReleaseGate();
    }
    await Promise.resolve();
    await Promise.resolve();
    await done;

    expect(starts).toEqual(["mintos", "debitum"]);
  });

  it("aborts while second launch is waiting through jitter", async () => {
    const controller = new AbortController();
    const starts: string[] = [];

    const done = runPlatforms(
      ["mintos", "debitum"],
      async (platform) => {
        starts.push(platform);
      },
      { concurrency: 2, signal: controller.signal },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual(["mintos"]);

    controller.abort();

    await expect(done).rejects.toBeInstanceOf(CancelledError);
    expect(starts).toEqual(["mintos"]);
  });

  it("aborts while waiting for manual-action gate to clear", async () => {
    const controller = new AbortController();
    const starts: string[] = [];

    const done = runPlatforms(
      ["mintos", "debitum"],
      async (platform) => {
        starts.push(platform);
        if (platform === "mintos") {
          await new Promise(() => {});
        }
      },
      {
        concurrency: 2,
        signal: controller.signal,
        waitForClear: (signal) =>
          starts.length === 0 ? Promise.resolve() : abortableDelay(10_000, signal),
      },
    );

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(starts).toEqual(["mintos"]);

    controller.abort();

    await expect(done).rejects.toBeInstanceOf(CancelledError);
    expect(starts).toEqual(["mintos"]);
  });

  it("fails fast without starting later platforms after runner error", async () => {
    const starts: string[] = [];
    let rejectMintos: ((reason?: unknown) => void) | undefined;
    let releaseDebitum: (() => void) | undefined;

    const done = runPlatforms(
      ["mintos", "debitum", "peerberry"],
      async (platform) => {
        starts.push(platform);

        if (platform === "mintos") {
          await new Promise<void>((_, reject) => {
            rejectMintos = reject;
          });
        }

        if (platform === "debitum") {
          await new Promise<void>((resolve) => {
            releaseDebitum = resolve;
          });
        }
      },
      { concurrency: 2 },
    );

    await vi.advanceTimersByTimeAsync(4_000);
    expect(starts).toEqual(["mintos", "debitum"]);

    rejectMintos?.(new Error("boom"));

    await expect(done).rejects.toThrow("boom");
    expect(starts).toEqual(["mintos", "debitum"]);

    releaseDebitum?.();
  });

  it("aborts active parallel workers after the first runner error", async () => {
    const starts: string[] = [];
    const aborted: string[] = [];
    let rejectMintos: ((reason?: unknown) => void) | undefined;
    let releaseDebitum: (() => void) | undefined;

    const done = runPlatforms(
      ["mintos", "debitum", "peerberry"],
      async (platform, signal) => {
        starts.push(platform);

        if (platform === "mintos") {
          await new Promise<void>((_, reject) => {
            rejectMintos = reject;
          });
        }

        if (platform === "debitum") {
          await new Promise<void>((resolve) => {
            releaseDebitum = resolve;
            signal?.addEventListener(
              "abort",
              () => {
                aborted.push(platform);
                resolve();
              },
              { once: true },
            );
          });
        }
      },
      { concurrency: 2 },
    );

    await vi.advanceTimersByTimeAsync(4_000);
    expect(starts).toEqual(["mintos", "debitum"]);

    rejectMintos?.(new Error("boom"));

    await expect(done).rejects.toThrow("boom");
    expect(aborted).toEqual(["debitum"]);
    expect(starts).toEqual(["mintos", "debitum"]);

    releaseDebitum?.();
  });

  it("blocks third launch while another platform holds manual-action gate", async () => {
    const starts: string[] = [];
    let gateBlocked = false;
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    let releaseGate: (() => void) | undefined;

    const done = runPlatforms(
      ["mintos", "debitum", "peerberry"],
      async (platform) => {
        starts.push(platform);

        if (platform === "mintos") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          return;
        }

        if (platform === "debitum") {
          gateBlocked = true;
          await new Promise<void>((resolve) => {
            releaseSecond = resolve;
          });
        }
      },
      {
        concurrency: 2,
        waitForClear: async () => {
          if (!gateBlocked) return;
          await new Promise<void>((resolve) => {
            releaseGate = resolve;
          });
        },
      },
    );

    await vi.advanceTimersByTimeAsync(4_000);
    expect(starts).toEqual(["mintos", "debitum"]);

    releaseFirst?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);
    expect(starts).toEqual(["mintos", "debitum"]);

    gateBlocked = false;
    releaseGate?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(4_000);

    expect(starts).toEqual(["mintos", "debitum", "peerberry"]);

    releaseSecond?.();
    await done;
  });
});
