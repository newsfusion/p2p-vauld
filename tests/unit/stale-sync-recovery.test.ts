import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupStaleSyncRuns,
  db,
  getLastSuccessfulSyncAt,
} from "../../src/shared/db/index.js";
import type { StoredSyncRun } from "../../src/shared/types/index.js";

describe("cleanupStaleSyncRuns", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recovers only queued and running sync runs on startup", async () => {
    const runs: StoredSyncRun[] = [
      {
        id: 1,
        runId: "completed",
        state: "completed",
        startedAt: "2026-03-30T08:00:00.000Z",
        finishedAt: "2026-03-30T08:05:00.000Z",
        platformProgress: { mintos: "success" },
      },
      {
        id: 2,
        runId: "queued",
        state: "queued",
        startedAt: "2026-03-30T08:10:00.000Z",
        platformProgress: { mintos: "pending" },
      },
      {
        id: 3,
        runId: "running",
        state: "running",
        startedAt: "2026-03-30T08:15:00.000Z",
        platformProgress: { peerberry: "running" },
      },
      {
        id: 4,
        runId: "paused-2fa",
        state: "paused_2fa",
        startedAt: "2026-03-30T08:20:00.000Z",
        platformProgress: { indemo: "failed_2fa" },
      },
      {
        id: 5,
        runId: "paused-captcha",
        state: "paused_security_challenge",
        startedAt: "2026-03-30T08:25:00.000Z",
        platformProgress: { triple_dragon: "failed_captcha" },
      },
      {
        id: 6,
        runId: "failed",
        state: "failed",
        startedAt: "2026-03-30T08:30:00.000Z",
        platformProgress: { estateguru: "failed_login" },
      },
      {
        id: 7,
        runId: "cancelled",
        state: "cancelled",
        startedAt: "2026-03-30T08:35:00.000Z",
        platformProgress: { debitum: "cancelled" },
      },
    ];

    const updates: Array<{ id: number; update: Record<string, unknown> }> = [];

    vi
      .spyOn(db, "transaction")
      .mockImplementation((async (...args: any[]) => {
        const callback = args.at(-1) as () => Promise<void>;
        return callback();
      }) as any);

    vi
      .spyOn(db.syncRuns, "filter")
      .mockImplementation((((predicate: (run: StoredSyncRun) => boolean) => ({
        toArray: vi.fn().mockResolvedValue(runs.filter(predicate)),
      })) as unknown) as any);

    vi
      .spyOn(db.syncRuns, "update")
      .mockImplementation((async (id: number, update: Record<string, unknown>) => {
        updates.push({ id, update });
        return 1;
      }) as any);

    await cleanupStaleSyncRuns();

    expect(updates.map(({ id }) => id)).toEqual([2, 3]);
    expect(updates.every(({ update }) => update.state === "failed")).toBe(true);
    expect(
      updates.every(
        ({ update }) => update.message === "Sync interrupted by extension restart",
      ),
    ).toBe(true);
    expect(
      updates.every(
        ({ update }) =>
          typeof update.finishedAt === "string" && (update.finishedAt as string).length > 0,
      ),
    ).toBe(true);
  });

  it("marks only pending and running platform progress entries as timed out", async () => {
    const runs: StoredSyncRun[] = [
      {
        id: 10,
        runId: "mixed-progress",
        state: "running",
        startedAt: "2026-03-30T09:00:00.000Z",
        platformProgress: {
          mintos: "running",
          peerberry: "failed_2fa",
          indemo: "pending",
          triple_dragon: "success",
        },
      },
    ];

    const updates: Array<Record<string, unknown>> = [];

    vi
      .spyOn(db, "transaction")
      .mockImplementation((async (...args: any[]) => {
        const callback = args.at(-1) as () => Promise<void>;
        return callback();
      }) as any);

    vi
      .spyOn(db.syncRuns, "filter")
      .mockImplementation((((predicate: (run: StoredSyncRun) => boolean) => ({
        toArray: vi.fn().mockResolvedValue(runs.filter(predicate)),
      })) as unknown) as any);

    vi
      .spyOn(db.syncRuns, "update")
      .mockImplementation((async (_id: number, update: Record<string, unknown>) => {
        updates.push(update);
        return 1;
      }) as any);

    await cleanupStaleSyncRuns();

    expect(updates).toHaveLength(1);
    expect(updates[0]?.platformProgress).toEqual({
      mintos: "failed_timeout",
      peerberry: "failed_2fa",
      indemo: "failed_timeout",
      triple_dragon: "success",
    });
  });
});

describe("getLastSuccessfulSyncAt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockLatestCompletedRun(run: StoredSyncRun | undefined) {
    vi.spyOn(db.syncRuns, "where").mockImplementation(((index: string) => {
      expect(index).toBe("state");
      return {
        equals: (value: string) => {
          expect(value).toBe("completed");
          return { last: async () => run };
        },
      };
    }) as never);
  }

  it("returns the wall-clock finishedAt of the latest completed run", async () => {
    mockLatestCompletedRun({
      id: 42,
      runId: "latest",
      state: "completed",
      startedAt: "2026-06-16T08:00:00.000Z",
      finishedAt: "2026-06-16T08:05:00.000Z",
      platformProgress: { mintos: "success" },
    });

    expect(await getLastSuccessfulSyncAt()).toBe("2026-06-16T08:05:00.000Z");
  });

  it("falls back to startedAt when finishedAt is missing", async () => {
    mockLatestCompletedRun({
      id: 42,
      runId: "latest",
      state: "completed",
      startedAt: "2026-06-16T08:00:00.000Z",
      platformProgress: { mintos: "success" },
    });

    expect(await getLastSuccessfulSyncAt()).toBe("2026-06-16T08:00:00.000Z");
  });

  it("returns null when no successful sync run exists", async () => {
    mockLatestCompletedRun(undefined);

    expect(await getLastSuccessfulSyncAt()).toBeNull();
  });
});
