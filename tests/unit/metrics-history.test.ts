import { describe, expect, it } from "vitest";
import type { StoredMetricsSnapshot } from "../../src/shared/types/index.js";

describe("StoredMetricsSnapshot type", () => {
  it("accepts a valid snapshot without netAnnualReturnPct", () => {
    const snapshot: StoredMetricsSnapshot = {
      platformId: "mintos",
      date: "2026-03-06",
      platformValue: 1200,
      freeCash: 50,
      fetchedAt: "2026-03-06T10:00:00Z",
    };

    expect(snapshot.platformId).toBe("mintos");
    expect(snapshot.netAnnualReturnPct).toBeUndefined();
  });

  it("accepts a valid snapshot with netAnnualReturnPct", () => {
    const snapshot: StoredMetricsSnapshot = {
      platformId: "peerberry",
      date: "2026-03-06",
      platformValue: 5000,
      freeCash: 120,
      netAnnualReturnPct: 9.5,
      fetchedAt: "2026-03-06T11:00:00Z",
    };

    expect(snapshot.netAnnualReturnPct).toBe(9.5);
  });
});
