import type { AppSettings } from "./types/index.js";

export const AUTO_LOCK_TIMEOUT_OPTIONS = [5, 15, 30, 60] as const;

export type AutoLockTimeoutMinutes =
  (typeof AUTO_LOCK_TIMEOUT_OPTIONS)[number];

export function isAutoLockTimeoutMinutes(
  value: unknown,
): value is AutoLockTimeoutMinutes {
  return AUTO_LOCK_TIMEOUT_OPTIONS.some((option) => option === value);
}

export function normalizeAutoLockSettings(
  settings: {
    autoLockEnabled?: unknown;
    sessionTimeoutMinutes?: unknown;
  },
): Pick<AppSettings, "autoLockEnabled" | "sessionTimeoutMinutes"> {
  const hasCurrentToggle = typeof settings.autoLockEnabled === "boolean";
  const timeout = isAutoLockTimeoutMinutes(settings.sessionTimeoutMinutes)
    ? settings.sessionTimeoutMinutes
    : 15;

  if (hasCurrentToggle) {
    return {
      autoLockEnabled: settings.autoLockEnabled as boolean,
      sessionTimeoutMinutes: timeout,
    };
  }

  return {
    autoLockEnabled: settings.sessionTimeoutMinutes !== 0,
    sessionTimeoutMinutes: timeout,
  };
}
