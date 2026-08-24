import type { StoredOverviewMetrics } from "../shared/types/index.js";
import { RUNTIME_NAMES } from "../shared/runtime-names.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const SYNC_REMINDER_ALARM = RUNTIME_NAMES.syncReminderAlarm;
export const SYNC_REMINDER_BADGE_COLOR = "#f59e0b";
export const SYNC_BADGE_COLOR = "#0f766e";
export const DEFAULT_SYNC_REMINDER_DAYS = 7;

export interface SyncReminderState {
  overdue: boolean;
  lastSyncAt: string | null;
  daysSinceSync: number | null;
  badgeText: string;
}

export interface ActionBadgeState {
  text: string;
  title: string;
  color?: string;
}

export function getLatestSuccessfulSyncAt(
  metrics: Array<Pick<StoredOverviewMetrics, "fetchedAt">>,
): string | null {
  let latestTime = Number.NEGATIVE_INFINITY;
  let latest: string | null = null;

  for (const metric of metrics) {
    const time = Date.parse(metric.fetchedAt);
    if (!Number.isFinite(time)) continue;
    if (time > latestTime) {
      latestTime = time;
      latest = metric.fetchedAt;
    }
  }

  return latest;
}

/**
 * Derives the sync-reminder state from the wall-clock time of the last
 * successful sync.
 *
 * IMPORTANT: `lastSyncAt` must be the real time the user last synced (e.g. a
 * completed sync run's `finishedAt`), NOT a metrics `fetchedAt` value. Metrics
 * timestamps can be synthetic/backdated (demo mode) or reflect restored backup
 * data, which would make the reminder report a wildly wrong "days ago".
 */
export function getSyncReminderState(
  lastSyncAt: string | null,
  syncReminderDays: number,
  now = new Date(),
): SyncReminderState {
  const parsed = lastSyncAt === null ? Number.NaN : Date.parse(lastSyncAt);
  if (!Number.isFinite(parsed)) {
    return {
      overdue: false,
      lastSyncAt: null,
      daysSinceSync: null,
      badgeText: "",
    };
  }

  const elapsedMs = Math.max(0, now.getTime() - parsed);
  const daysSinceSync = Math.floor(elapsedMs / MS_PER_DAY);
  const overdue = daysSinceSync >= syncReminderDays;

  return {
    overdue,
    lastSyncAt,
    daysSinceSync,
    badgeText: overdue ? formatSyncReminderBadgeText(daysSinceSync) : "",
  };
}

export function getSyncingBadgeState(): ActionBadgeState {
  return {
    text: "SYNC",
    color: SYNC_BADGE_COLOR,
    title: "Sync in progress",
  };
}

export function getSyncReminderBadgeState(
  lastSyncAt: string | null,
  syncReminderDays: number,
  defaultTitle: string,
  now = new Date(),
): ActionBadgeState {
  const state = getSyncReminderState(lastSyncAt, syncReminderDays, now);
  if (!state.overdue || state.daysSinceSync === null) {
    return { text: "", title: defaultTitle };
  }

  return {
    text: state.badgeText,
    color: SYNC_REMINDER_BADGE_COLOR,
    title: `P2P Portfolio Tracker: last successful sync ${state.daysSinceSync} days ago`,
  };
}

function formatSyncReminderBadgeText(daysSinceSync: number): string {
  if (daysSinceSync > 999) return "999+";
  return `${daysSinceSync}d`;
}
