import type { PlatformId } from "../shared/types/index.js";
import { RUNTIME_NAMES } from "../shared/runtime-names.js";

export const DEMO_COHORT_SIZE = 10;
export const DEMO_COHORT_STORAGE_KEY = RUNTIME_NAMES.demoPlatformCohort;

export interface DemoCohortStorage {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

export function createDemoCohorts(
  platformIds: readonly PlatformId[],
  size = DEMO_COHORT_SIZE,
): PlatformId[][] {
  const normalizedSize = Math.max(1, Math.trunc(size));
  const cohorts: PlatformId[][] = [];
  for (let index = 0; index < platformIds.length; index += normalizedSize) {
    cohorts.push([...platformIds.slice(index, index + normalizedSize)]);
  }
  return cohorts;
}

export function parseDemoCohortIndex(
  value: unknown,
  cohortCount: number,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(typeof value === "string" ? value : "", 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed < cohortCount
    ? parsed
    : 0;
}

export async function getActiveDemoPlatformIds(
  platformIds: readonly PlatformId[],
  options: {
    storage?: DemoCohortStorage;
    envCohortIndex?: string;
  } = {},
): Promise<PlatformId[]> {
  const cohorts = createDemoCohorts(platformIds);
  const storage = options.storage ?? chrome.storage.local;
  const stored = await storage.get(DEMO_COHORT_STORAGE_KEY);
  const storedValue = stored[DEMO_COHORT_STORAGE_KEY];

  if (typeof storedValue === "number" || typeof storedValue === "string") {
    const cohortIndex = parseDemoCohortIndex(storedValue, cohorts.length);
    if (cohortIndex !== storedValue) {
      await storage.set({ [DEMO_COHORT_STORAGE_KEY]: cohortIndex });
    }
    return cohorts[cohortIndex] ?? [];
  }

  const cohortIndex = parseDemoCohortIndex(
    options.envCohortIndex ?? import.meta.env.VITE_DEMO_COHORT_INDEX,
    cohorts.length,
  );
  await storage.set({ [DEMO_COHORT_STORAGE_KEY]: cohortIndex });
  return cohorts[cohortIndex] ?? [];
}
