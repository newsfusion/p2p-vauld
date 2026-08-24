import { describe, expect, it } from "vitest";
import {
  getLatestSuccessfulSyncAt,
  getSyncingBadgeState,
  getSyncReminderBadgeState,
  getSyncReminderState,
} from "../../src/background/sync-reminder.js";
import type { StoredOverviewMetrics } from "../../src/shared/types/index.js";

function metric(fetchedAt: string): StoredOverviewMetrics {
  return {
    platformId: "mintos",
    fetchedAt,
    platformValue: 1000,
    freeCash: 25,
    currency: "EUR",
    confidence: 1,
  };
}

describe("sync reminder badge", () => {
  it("picks newest successful metrics timestamp", () => {
    expect(
      getLatestSuccessfulSyncAt([
        metric("2026-05-10T08:00:00.000Z"),
        metric("2026-05-17T08:00:00.000Z"),
        metric("2026-05-12T08:00:00.000Z"),
      ]),
    ).toBe("2026-05-17T08:00:00.000Z");
  });

  it("does not become overdue before threshold", () => {
    const state = getSyncReminderState(
      "2026-05-12T12:00:00.000Z",
      7,
      new Date("2026-05-19T11:59:59.000Z"),
    );

    expect(state.overdue).toBe(false);
    expect(state.daysSinceSync).toBe(6);
    expect(state.badgeText).toBe("");
  });

  it("becomes overdue at threshold and formats days badge", () => {
    const state = getSyncReminderState(
      "2026-05-12T12:00:00.000Z",
      7,
      new Date("2026-05-19T12:00:00.000Z"),
    );

    expect(state.overdue).toBe(true);
    expect(state.daysSinceSync).toBe(7);
    expect(state.badgeText).toBe("7d");
  });

  it("keeps badge clear until first successful sync exists", () => {
    expect(
      getSyncReminderBadgeState(null, 7, "P2P Portfolio Tracker"),
    ).toEqual({
      text: "",
      title: "P2P Portfolio Tracker",
    });
  });

  it("keeps badge clear when the last sync timestamp is invalid", () => {
    expect(
      getSyncReminderBadgeState("not-a-date", 7, "P2P Portfolio Tracker"),
    ).toEqual({
      text: "",
      title: "P2P Portfolio Tracker",
    });
  });

  it("returns warning badge state when data is stale", () => {
    expect(
      getSyncReminderBadgeState(
        "2026-05-10T12:00:00.000Z",
        7,
        "P2P Portfolio Tracker",
        new Date("2026-05-19T12:00:00.000Z"),
      ),
    ).toEqual({
      text: "9d",
      color: "#f59e0b",
      title: "P2P Portfolio Tracker: last successful sync 9 days ago",
    });
  });

  it("uses the wall-clock sync time, not backdated metrics timestamps", () => {
    // Regression: in demo mode metrics `fetchedAt` is backdated ~1 year, which
    // previously made the badge report hundreds of stale days right after a
    // successful sync. The reminder must rely on the real last-sync time.
    const justSyncedAt = "2026-06-16T08:00:00.000Z";
    const now = new Date("2026-06-16T09:00:00.000Z");

    expect(getSyncReminderBadgeState(justSyncedAt, 7, "P2P", now)).toEqual({
      text: "",
      title: "P2P",
    });
  });

  it("uses sync badge state while sync is running", () => {
    expect(getSyncingBadgeState()).toEqual({
      text: "SYNC",
      color: "#0f766e",
      title: "Sync in progress",
    });
  });
});
