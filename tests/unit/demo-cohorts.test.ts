import { describe, expect, it } from "vitest";
import {
  DEMO_COHORT_SIZE,
  DEMO_COHORT_STORAGE_KEY,
  createDemoCohorts,
  getActiveDemoPlatformIds,
  parseDemoCohortIndex,
} from "../../src/background/demo-cohorts.js";
import { PLATFORM_IDS } from "../../src/shared/types/index.js";

function createStorage(initial: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = { ...initial };
  return {
    state,
    get: async (key: string) => ({ [key]: state[key] }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(state, items);
    },
  };
}

describe("demo cohorts", () => {
  it("groups platform ids into stable cohorts of ten in catalog order", () => {
    const cohorts = createDemoCohorts(PLATFORM_IDS);

    expect(DEMO_COHORT_SIZE).toBe(10);
    expect(cohorts).toHaveLength(6);
    expect(cohorts[0]).toEqual([
      "mintos",
      "bondora_go_grow",
      "peerberry",
      "robocash",
      "twino",
      "estateguru",
      "debitum",
      "esketit",
      "viainvest",
      "nectaro",
    ]);
    expect(cohorts.flat()).toEqual([...PLATFORM_IDS]);
    expect(cohorts.at(-1)?.length).toBeLessThanOrEqual(DEMO_COHORT_SIZE);
  });

  it("parses invalid cohort indices back to zero", () => {
    expect(parseDemoCohortIndex(undefined, 6)).toBe(0);
    expect(parseDemoCohortIndex("2", 6)).toBe(2);
    expect(parseDemoCohortIndex("99", 6)).toBe(0);
    expect(parseDemoCohortIndex("-1", 6)).toBe(0);
    expect(parseDemoCohortIndex("abc", 6)).toBe(0);
  });

  it("uses stored cohort before env and persists env only on first use", async () => {
    const stored = createStorage({ [DEMO_COHORT_STORAGE_KEY]: 3 });

    await expect(
      getActiveDemoPlatformIds([...PLATFORM_IDS], {
        storage: stored,
        envCohortIndex: "1",
      }),
    ).resolves.toEqual(PLATFORM_IDS.slice(30, 40));
    expect(stored.state[DEMO_COHORT_STORAGE_KEY]).toBe(3);

    const empty = createStorage();
    await expect(
      getActiveDemoPlatformIds([...PLATFORM_IDS], {
        storage: empty,
        envCohortIndex: "2",
      }),
    ).resolves.toEqual(PLATFORM_IDS.slice(20, 30));
    expect(empty.state[DEMO_COHORT_STORAGE_KEY]).toBe(2);
  });

  it("falls back to cohort zero when stored value is invalid", async () => {
    const storage = createStorage({ [DEMO_COHORT_STORAGE_KEY]: 200 });

    const ids = await getActiveDemoPlatformIds([...PLATFORM_IDS], {
      storage,
      envCohortIndex: "4",
    });

    expect(ids).toEqual(PLATFORM_IDS.slice(0, 10));
    expect(storage.state[DEMO_COHORT_STORAGE_KEY]).toBe(0);
  });
});
