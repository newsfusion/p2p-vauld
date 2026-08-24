import type { PlatformId } from "../shared/types/index.js";

import { RUNTIME_NAMES } from "../shared/runtime-names.js";

export const DEMO_CLOCK_STORAGE_KEY = RUNTIME_NAMES.demoClock;

const DEMO_SYNC_MIN_DAYS = 14;
const DEMO_SYNC_DAY_RANGE = 21; // 14..34 inclusive
const demoCumulativeDayCache = new Map<number, number>([[0, 0]]);

export interface DemoClockStorage {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

export async function reserveNextDemoSyncIndex(
  storage: DemoClockStorage = chrome.storage.local,
): Promise<number> {
  const stored = await storage.get(DEMO_CLOCK_STORAGE_KEY);
  const storedValue = stored[DEMO_CLOCK_STORAGE_KEY];
  const current = typeof storedValue === "number" ? storedValue : 0;
  await storage.set({ [DEMO_CLOCK_STORAGE_KEY]: current + 1 });
  return current;
}

export function getDemoTodayUtcStart(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function getDemoClockBaseIso(now = new Date()): string {
  const base = getDemoTodayUtcStart(now);
  base.setUTCFullYear(base.getUTCFullYear() - 1);
  return base.toISOString();
}

export function getDemoStepDays(syncIndex: number): number {
  return DEMO_SYNC_MIN_DAYS + ((syncIndex * 17 + 11) % DEMO_SYNC_DAY_RANGE);
}

export function getDemoCumulativeDays(
  syncIndex: number,
  cache: Map<number, number> = demoCumulativeDayCache,
): number {
  const normalizedIndex = Math.max(0, Math.trunc(syncIndex));
  const cached = cache.get(normalizedIndex);
  if (cached !== undefined) {
    return cached;
  }

  let cursor = normalizedIndex - 1;
  while (cursor > 0 && !cache.has(cursor)) {
    cursor -= 1;
  }

  let total = cache.get(cursor) ?? 0;
  for (let i = cursor; i < normalizedIndex; i += 1) {
    total += getDemoStepDays(i);
    cache.set(i + 1, total);
  }
  return total;
}

function resolveDemoBaseDate(baseIso: string, now: Date): Date {
  const baseMs = Date.parse(baseIso);
  const fallbackBaseMs = Date.parse(getDemoClockBaseIso(now));
  return new Date(Number.isFinite(baseMs) ? baseMs : fallbackBaseMs);
}

function resolveDemoSyncDay(
  baseIso: string,
  cumulativeDays: number,
  now: Date,
): { day: Date; isFutureDay: boolean } {
  const base = resolveDemoBaseDate(baseIso, now);
  base.setUTCDate(base.getUTCDate() + cumulativeDays);

  const todayStart = getDemoTodayUtcStart(now);
  // Synthetic cadence can overshoot "today" after enough demo syncs.
  // Clamp back to current UTC day so demo history never lands in future.
  const isFutureDay = base.getTime() > todayStart.getTime();
  return {
    day: isFutureDay ? new Date(todayStart) : base,
    isFutureDay,
  };
}

function resolveDemoMinuteOffset(
  platformIndex: number,
  isFutureDay: boolean,
  now: Date,
): number {
  const rawMinuteOffset = Math.max(0, Math.trunc(platformIndex));
  const maxAllowedMinuteOffset = isFutureDay
    ? now.getUTCHours() * 60 + now.getUTCMinutes()
    : rawMinuteOffset;
  return Math.min(rawMinuteOffset, maxAllowedMinuteOffset);
}

export function getDemoFetchedAt(
  syncIndex: number,
  platformIndex: number,
  baseIso = getDemoClockBaseIso(),
  now = new Date(),
): string {
  const { day: effectiveDay, isFutureDay } = resolveDemoSyncDay(
    baseIso,
    getDemoCumulativeDays(syncIndex),
    now,
  );
  const minuteOffset = resolveDemoMinuteOffset(platformIndex, isFutureDay, now);
  effectiveDay.setUTCMinutes(effectiveDay.getUTCMinutes() + minuteOffset);
  return effectiveDay.toISOString();
}

export function createDemoTimestampProvider(
  syncIndex: number,
  platformIds: PlatformId[],
  baseIso?: string,
  now = new Date(),
): (platformId: PlatformId) => string {
  const platformIndexById = new Map(
    platformIds.map((platformId, index) => [platformId, index]),
  );
  const resolvedBaseIso = baseIso ?? getDemoClockBaseIso(now);
  const { day: syncDay, isFutureDay } = resolveDemoSyncDay(
    resolvedBaseIso,
    getDemoCumulativeDays(syncIndex),
    now,
  );

  return (platformId) => {
    const fetchedAt = new Date(syncDay);
    fetchedAt.setUTCMinutes(
      fetchedAt.getUTCMinutes() +
        resolveDemoMinuteOffset(
          platformIndexById.get(platformId) ?? 0,
          isFutureDay,
          now,
        ),
    );
    return fetchedAt.toISOString();
  };
}
