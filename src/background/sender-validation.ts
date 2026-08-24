/**
 * Validates that a message sender is an internal part of the extension
 * (e.g., popup, dashboard, or the background script itself).
 * Prevents content scripts from triggering sensitive operations.
 */
import { createLogger } from "../shared/logger.js";

const log = createLogger("sender-validation");

export function isInternalSender(sender: chrome.runtime.MessageSender): boolean {
  if (!sender.url || !chrome.runtime.id) return false;

  try {
    const senderUrl = new URL(sender.url);
    return (
      senderUrl.protocol === "chrome-extension:" &&
      senderUrl.host === chrome.runtime.id
    );
  } catch {
    return false;
  }
}

function isContentScriptSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    sender.tab?.id !== undefined &&
    !isInternalSender(sender)
  );
}

function isContentScriptAllowedMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const type = (message as { type?: unknown }).type;
  return type === "PROXY_CHECK_AI" || type === "PROXY_AI_PROMPT";
}

export function assertBackgroundMessageSender(
  sender: chrome.runtime.MessageSender,
  message: unknown,
): void {
  if (isInternalSender(sender)) return;
  if (isContentScriptSender(sender) && isContentScriptAllowedMessage(message)) {
    return;
  }

  log.warn("Blocked unauthorized background message sender");
  throw new Error(
    "Unauthorized: This operation is only allowed from the extension UI.",
  );
}

/**
 * Throws an error if the sender is not internal.
 */
export function assertInternalSender(sender: chrome.runtime.MessageSender): void {
  if (!isInternalSender(sender)) {
    log.warn("Blocked unauthorized message from non-internal sender");
    throw new Error(
      "Unauthorized: This operation is only allowed from the extension UI.",
    );
  }
}
