import type { PlatformSyncState } from "./types/index.js";

export interface SyncFailureDescription {
  reason: string;
  hint: string;
}

const REASON_BY_RAW_MESSAGE: Record<string, string> = {
  "Login form fields not found": "Couldn't find the login form on the page.",
  "Login verification timeout — could not confirm post-login state":
    "Login submitted but the platform never confirmed a logged-in state.",
  "2FA not solved in time": "Two-factor authentication wasn't completed in time.",
  "Captcha not solved in time": "Captcha wasn't completed in time.",
  "Could not extract portfolio value or free cash":
    "Couldn't read portfolio value or free cash from the page.",
  "Conflicting extraction candidates":
    "Found conflicting values on the page and couldn't pick one.",
};

const HINT_BY_STATE: Partial<Record<PlatformSyncState, string>> = {
  failed_login:
    "Try again — Safe Mode was turned on automatically, so the login window will stay visible next time.",
  failed_2fa:
    "Open the platform and complete the manual step, then sync again.",
  failed_captcha:
    "Open the platform and complete the manual step, then sync again.",
  failed_timeout:
    "Platform didn't respond in time. Showing last known value — try again later.",
  failed_extract: "Values couldn't be read reliably.",
};

function normalizeReason(rawMessage: string | undefined, state: PlatformSyncState): string {
  const trimmed = rawMessage?.trim();
  if (!trimmed) {
    switch (state) {
      case "failed_login":
        return "Login failed.";
      case "failed_2fa":
        return "Two-factor authentication is required.";
      case "failed_captcha":
        return "Captcha is required.";
      case "failed_timeout":
        return "The platform didn't respond in time.";
      case "failed_extract":
        return "Couldn't extract portfolio data.";
      default:
        return "Sync failed.";
    }
  }

  return REASON_BY_RAW_MESSAGE[trimmed] ?? trimmed;
}

export function describeSyncFailure(
  state: PlatformSyncState,
  rawMessage?: string,
): SyncFailureDescription {
  const reason = normalizeReason(rawMessage, state);
  const hint =
    HINT_BY_STATE[state] ??
    "Try syncing again or check your credentials in Settings.";

  return { reason, hint };
}

export function formatSyncFailureTooltip(
  description: SyncFailureDescription,
  rawMessage?: string,
): string {
  const trimmed = rawMessage?.trim();
  const parts = [description.reason, description.hint];
  if (trimmed && trimmed !== description.reason) {
    parts.push(`Details: ${trimmed}`);
  }
  return parts.join(" ");
}
