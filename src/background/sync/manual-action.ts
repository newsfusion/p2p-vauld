import type {
  CheckLoginResponse,
  CheckLoginMessage,
} from "../../shared/messages.js";
import type {
  ManualActionRequest,
  PlatformCatalogEntry,
  SyncEvent,
} from "../../shared/types/index.js";
import { getErrorMessage } from "../../shared/error-utils.js";
import { CancelledError, abortableDelay } from "./cancellation.js";
import { sendToTabWithTimeout } from "./content-messaging.js";
import { focusTabForManualAction } from "./tab-session.js";
import {
  clearManualActionNotification,
  notifyManualAction,
} from "./manual-action-notify.js";
import type { PlatformLogger } from "./debug-logger.js";
import { RUNTIME_NAMES } from "../../shared/runtime-names.js";

export type ManualActionType = "captcha" | "2fa";

export interface ManualActionResolveOptions {
  code?: string;
  /**
   * Skip the CHECK_LOGIN verification and continue the sync regardless. Offered
   * in the dashboard only after a normal confirmation failed, and only for
   * captcha — continuing a 2FA step without a live session is pointless.
   */
  force?: boolean;
}

export interface ManualActionResolveResult {
  success: boolean;
  /** User-facing reason shown in the dashboard modal when `success` is false. */
  error?: string;
  /** The pending request is gone for good — the dashboard should close the modal. */
  gone?: boolean;
}

interface PendingManualAction {
  request: ManualActionRequest;
  resolve: (
    options: ManualActionResolveOptions,
  ) => Promise<ManualActionResolveResult>;
  reject: (err: Error) => void;
}

export const PENDING_MANUAL_ACTION_SESSION_KEY =
  RUNTIME_NAMES.pendingManualAction;

const pendingManualActions = new Map<string, PendingManualAction>();

/**
 * Request ids whose confirmation is currently being verified. They are absent
 * from `pendingManualActions` for the duration, so this is what tells a
 * duplicate click apart from a request that is genuinely gone.
 */
const resolvesInFlight = new Set<string>();

export async function persistPendingManualAction(
  request: ManualActionRequest,
): Promise<void> {
  await chrome.storage.session.set({ [PENDING_MANUAL_ACTION_SESSION_KEY]: request });
}

export async function clearPersistedPendingManualAction(): Promise<void> {
  await chrome.storage.session.remove(PENDING_MANUAL_ACTION_SESSION_KEY);
}

export async function getPersistedPendingManualAction(): Promise<
  ManualActionRequest | undefined
> {
  const result = await chrome.storage.session.get(PENDING_MANUAL_ACTION_SESSION_KEY);
  const request = result?.[PENDING_MANUAL_ACTION_SESSION_KEY] as
    | ManualActionRequest
    | undefined;
  if (!request) return undefined;
  if (new Date(request.expiresAt).getTime() <= Date.now()) {
    await clearPersistedPendingManualAction();
    return undefined;
  }
  return request;
}

export async function resolvePendingManualAction(
  requestId: string,
  options: ManualActionResolveOptions = {},
): Promise<ManualActionResolveResult> {
  const pending = pendingManualActions.get(requestId);
  if (!pending) {
    // A verification takes a full CHECK_LOGIN round-trip, during which the
    // request is out of the map. An impatient second click must not be mistaken
    // for a dead run — reporting `gone` would close the modal and record a sync
    // error while the first attempt is still on its way to succeeding.
    if (resolvesInFlight.has(requestId)) {
      return { success: false, error: VERIFICATION_IN_PROGRESS_ERROR };
    }
    // The in-memory map does not survive a service worker restart, while the
    // request in chrome.storage.session does. A dashboard that restored the
    // modal from storage would otherwise be stuck on an unresolvable prompt.
    try {
      const persisted = await getPersistedPendingManualAction();
      if (persisted?.requestId === requestId) {
        await clearPersistedPendingManualAction();
      }
    } catch {
      // Session storage unavailable — the request is unresolvable either way.
    }
    return { success: false, gone: true, error: RUN_GONE_ERROR };
  }
  pendingManualActions.delete(requestId);
  resolvesInFlight.add(requestId);
  try {
    return await pending.resolve(options);
  } finally {
    resolvesInFlight.delete(requestId);
  }
}

const ALREADY_FINISHED_ERROR = "This security check has already been completed.";
const OTP_REJECTED_ERROR =
  "That code wasn't accepted. Please check it and try again.";
const LOGIN_NOT_CONFIRMED_ERROR =
  "Couldn't confirm the login — the page still reports a security check.";
const TAB_GONE_ERROR =
  "The platform tab is no longer open. Please start the sync again.";
const RUN_GONE_ERROR =
  "The sync run was interrupted and is no longer waiting. Please start the sync again.";
const VERIFICATION_IN_PROGRESS_ERROR =
  "Still verifying your last confirmation — please wait a moment.";

/** Distinguishes "tab is gone" from other messaging failures for the modal. */
function describeTabFailure(err: unknown): string {
  const message = getErrorMessage(err);
  if (
    /no tab with id|receiving end does not exist|tab.*closed|frame.*removed/i.test(
      message,
    )
  ) {
    return TAB_GONE_ERROR;
  }
  return `Couldn't check the page: ${message}`;
}

export function getManualActionProgressMessage(
  actionType: ManualActionType,
): string {
  return actionType === "captcha"
    ? "Captcha detected — please solve it in the open tab"
    : "2FA required — please enter code in the open tab";
}

function buildManualActionMessage(
  actionType: ManualActionType,
  tabFocused: boolean,
): string {
  if (actionType === "2fa") return "Enter the 2FA code in the dashboard";
  return tabFocused
    ? "Please solve the Captcha in the opened tab"
    : "Please solve the Captcha in the platform's tab — it could not be brought to the front automatically.";
}

function defaultWatchTabRemoval(
  tabId: number,
  onRemoved: () => void,
): () => void {
  const listener = (closedTabId: number) => {
    if (closedTabId === tabId) onRemoved();
  };
  chrome.tabs.onRemoved.addListener(listener);
  return () => {
    chrome.tabs.onRemoved.removeListener(listener);
  };
}

export async function waitForManualAction({
  tabId,
  platform,
  runId,
  log,
  onEvent,
  actionType = "captcha",
  signal,
  timeoutMs,
  pollMs,
  focusTab = focusTabForManualAction,
  sendCheckLogin = defaultSendCheckLogin,
  delay = abortableDelay,
  notify = notifyManualAction,
  clearNotification = clearManualActionNotification,
  showDashboardPrompt = true,
  watchTabRemoval = defaultWatchTabRemoval,
}: {
  tabId: number;
  platform: PlatformCatalogEntry;
  runId: string;
  log: PlatformLogger;
  onEvent: (event: SyncEvent) => void;
  actionType?: ManualActionType;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
  pollMs: number;
  focusTab?: (tabId: number) => Promise<boolean | void>;
  sendCheckLogin?: (
    tabId: number,
    payload: CheckLoginMessage["payload"],
  ) => Promise<CheckLoginResponse>;
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
  notify?: (
    platformName: string,
    actionType: ManualActionType,
    tabId: number,
  ) => Promise<string | undefined>;
  clearNotification?: (notificationId: string | undefined) => Promise<void>;
  showDashboardPrompt?: boolean;
  /** Registers a tab-closed callback; returns an unsubscribe function. */
  watchTabRemoval?: (tabId: number, onRemoved: () => void) => () => void;
}): Promise<boolean> {
  const focused = await focusTab(tabId);

  const requestId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
  const deadline = Date.now() + timeoutMs;
  const shouldShowDashboardPrompt = actionType !== "2fa" || showDashboardPrompt;
  const request: ManualActionRequest = {
    requestId,
    runId,
    platformId: platform.id,
    platformName: platform.name,
    actionType,
    expiresAt,
    message: buildManualActionMessage(actionType, focused !== false),
  };

  if (shouldShowDashboardPrompt) {
    await persistPendingManualAction(request);
  }

  return new Promise<boolean>((resolve, reject) => {
    let finished = false;
    let notificationId: string | undefined;
    let unwatchTabRemoval: (() => void) | undefined;

    const cleanup = async () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", handleAbort);
      unwatchTabRemoval?.();
      unwatchTabRemoval = undefined;
      try {
        if (shouldShowDashboardPrompt) {
          await clearPersistedPendingManualAction();
        }
      } catch (error) {
        log(
          "Failed to clear persisted manual action",
          getErrorMessage(error),
          "warn",
        );
      }
      if (shouldShowDashboardPrompt) {
        pendingManualActions.delete(requestId);
      }
      if (notificationId !== undefined) {
        void clearNotification(notificationId);
      }
    };

    const handleAbort = () => {
      void cleanup();
      reject(new CancelledError("Manual action cancelled"));
    };

    const requeueIfActive = () => {
      if (!finished) {
        pendingManualActions.set(requestId, pendingAction);
      }
    };

    // Without this the wait polls a dead tab for the full timeout while the
    // dashboard shows a prompt that can never be satisfied.
    try {
      unwatchTabRemoval = watchTabRemoval(tabId, () => {
        if (finished) return;
        log("Platform tab closed while waiting for manual action", undefined, "warn");
        onEvent({
          type: "platform_progress",
          platformId: platform.id,
          runId,
          message: "Tab was closed before the security check was completed",
        });
        void cleanup().then(() => resolve(false));
      });
    } catch (error) {
      log("Could not watch tab for closure", getErrorMessage(error), "warn");
    }

    const pendingAction: PendingManualAction = {
      request,
      resolve: async ({ code, force }: ManualActionResolveOptions = {}) => {
        if (finished) {
          return { success: false, gone: true, error: ALREADY_FINISHED_ERROR };
        }

        if (force && actionType === "captcha") {
          log("Captcha wait overridden by user — continuing without verification", undefined, "warn");
          await cleanup();
          resolve(true);
          return { success: true };
        }

        if (actionType === "2fa" && code) {
          log("OTP code received from dashboard, submitting to tab...");
          try {
            const successMsg = await sendToTabWithTimeout<{ success: boolean }>(
              tabId,
              {
                type: "SUBMIT_OTP",
                payload: {
                  code,
                  otpSelectors: platform.login.otpSelectors,
                  submitSelectors: platform.login.submitSelectors,
                  postLoginIndicators: platform.login.postLoginIndicators,
                },
              },
              20000,
              undefined,
              signal,
            );
            if (finished) {
              return { success: false, gone: true, error: ALREADY_FINISHED_ERROR };
            }
            if (successMsg && successMsg.success) {
              log("OTP submitted successfully, login verified");
              await cleanup();
              resolve(true);
              return { success: true };
            } else {
              log("OTP submission failed, waiting for user to try again", undefined, "warn");
              // Re-register pending action so they can try again if they failed
              requeueIfActive();
              return { success: false, error: OTP_REJECTED_ERROR };
            }
          } catch (err) {
            log("Error submitting OTP to tab", String(err), "error");
            // Re-register so they can retry
            requeueIfActive();
            return { success: false, error: describeTabFailure(err) };
          }
        } else {
          // If captcha solved confirmation from dashboard, check login state
          try {
            const payload = {
              postLoginIndicators: platform.login.postLoginIndicators,
              usernameSelectors: platform.login.usernameSelectors,
              passwordSelectors: platform.login.passwordSelectors,
              otpSelectors: platform.login.otpSelectors,
              afterSubmission: true,
              entryUrl: platform.login.entryUrl,
            };
            const checkResult = await sendCheckLogin(tabId, payload);
            if (finished) {
              return { success: false, gone: true, error: ALREADY_FINISHED_ERROR };
            }
            if (checkResult.loggedIn) {
              log("Login confirmed after manual action dashboard confirmation");
              await cleanup();
              resolve(true);
              return { success: true };
            } else {
              log("Dashboard manual action confirmation, but login check failed", undefined, "warn");
              // Re-register
              requeueIfActive();
              return { success: false, error: LOGIN_NOT_CONFIRMED_ERROR };
            }
          } catch (err) {
            log("Error checking login on dashboard confirmation", String(err), "error");
            // Re-register
            requeueIfActive();
            return { success: false, error: describeTabFailure(err) };
          }
        }
      },
      reject: (err: Error) => {
        if (finished) return;
        void cleanup();
        reject(err);
      },
    };

    if (shouldShowDashboardPrompt) {
      pendingManualActions.set(requestId, pendingAction);
    }

    if (signal) {
      if (signal.aborted) {
        void cleanup();
        reject(new CancelledError("Manual action cancelled"));
        return;
      }
      signal.addEventListener("abort", handleAbort, { once: true });
    }

    const message = getManualActionProgressMessage(actionType);
    onEvent({
      type: "platform_progress",
      platformId: platform.id,
      runId,
      message,
    });

    if (shouldShowDashboardPrompt) {
      onEvent({
        type: "manual_action_required",
        platformId: platform.id,
        platformName: platform.name,
        runId,
        requestId,
        actionType,
        expiresAt,
        ...(request.message === undefined ? {} : { message: request.message }),
      });
    }

    void notify(platform.name, actionType, tabId)
      .then((createdNotificationId) => {
        if (createdNotificationId === undefined) return;
        notificationId = createdNotificationId;
        if (finished) {
          void clearNotification(createdNotificationId);
        }
      })
      .catch((err) => {
        log("Manual action notification failed", String(err), "warn");
      });

    log(`Waiting for ${actionType} solve`, `timeout ${timeoutMs / 1000}s, requestId=${requestId}`);

    // 1. Polling verification process
    const runPoll = async () => {
      while (!finished && Date.now() < deadline) {
        try {
          const payload = {
            postLoginIndicators: platform.login.postLoginIndicators,
            usernameSelectors: platform.login.usernameSelectors,
            passwordSelectors: platform.login.passwordSelectors,
            otpSelectors: platform.login.otpSelectors,
            afterSubmission: true,
            entryUrl: platform.login.entryUrl,
          };
          const checkResult = await sendCheckLogin(tabId, payload);
          log(
            `${actionType} poll CHECK_LOGIN`,
            `loggedIn=${checkResult.loggedIn}, captcha=${checkResult.requiresCaptcha ?? false}, 2fa=${checkResult.requires2FA ?? false}`,
          );

          if (checkResult.loggedIn) {
            log(`${actionType} solved via tab — login confirmed`);
            await cleanup();
            resolve(true);
            return;
          }
        } catch (err) {
          const errMsg = getErrorMessage(err);
          log(`${actionType} poll failed (retrying)`, errMsg, "warn");
        }

        if (!finished) {
          try {
            await delay(pollMs, signal);
          } catch {
            break;
          }
        }
      }

      if (!finished) {
        log(`${actionType} solve timeout`, undefined, "warn");
        await cleanup();
        resolve(false);
      }
    };

    // Start polling in background
    runPoll();
  });
}

async function defaultSendCheckLogin(
  tabId: number,
  payload: CheckLoginMessage["payload"],
): Promise<CheckLoginResponse> {
  return sendToTabWithTimeout<CheckLoginResponse>(
    tabId,
    {
      type: "CHECK_LOGIN",
      payload,
    },
    10_000,
  );
}
