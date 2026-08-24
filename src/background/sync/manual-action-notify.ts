import type { ManualActionType } from "./manual-action.js";
import { focusTabForManualAction } from "./tab-session.js";

const notificationTabIds = new Map<string, number>();

function getManualActionNotificationMessage(actionType: ManualActionType): string {
  return actionType === "2fa"
    ? "Enter your 2FA code to continue the sync"
    : "Solve the security challenge in the opened tab";
}

export function isManualActionNotificationAvailable(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.notifications?.create === "function"
  );
}

export async function notifyManualAction(
  platformName: string,
  actionType: ManualActionType,
  tabId: number,
): Promise<string | undefined> {
  if (!isManualActionNotificationAvailable()) {
    return undefined;
  }

  const notificationId = crypto.randomUUID();
  try {
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: `Action required: ${platformName}`,
      message: getManualActionNotificationMessage(actionType),
      priority: 2,
    });
    notificationTabIds.set(notificationId, tabId);
    return notificationId;
  } catch {
    return undefined;
  }
}

export async function clearManualActionNotification(
  notificationId: string | undefined,
): Promise<void> {
  if (!notificationId) return;
  notificationTabIds.delete(notificationId);
  if (!isManualActionNotificationAvailable()) return;
  try {
    await chrome.notifications.clear(notificationId);
  } catch {
    // Notification may already be dismissed.
  }
}

export async function focusTabForNotification(
  notificationId: string,
): Promise<void> {
  const tabId = notificationTabIds.get(notificationId);
  if (tabId === undefined) return;
  await focusTabForManualAction(tabId);
}
