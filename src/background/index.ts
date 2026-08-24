/**
 * Background service worker (MV3).
 * Handles all orchestration: sync runs, credential management, messaging with popup/dashboard.
 */

import type {
  BackgroundMessage,
  SaveCredentialsMessage,
  StartSyncMessage,
  ProxyAiPromptMessage,
  UpdatePlatformModesMessage,
} from "../shared/messages.js";
import type {
  FinancialBackupV1,
  ExtractionChoiceSignalKey,
  PlatformCatalogEntry,
  PlatformId,
  StoredSyncRun,
} from "../shared/types/index.js";
import { getPlatformCatalog } from "../shared/platforms/index.js";
import {
  checkGeminiAvailability,
  triggerGeminiDownload,
} from "../shared/ai/gemini.js";
import {
  getPromptApiLanguageModel,
  PROMPT_API_TEXT_LANGUAGE_OPTIONS,
} from "../shared/ai/provider.js";
import { createSerialQueue } from "../shared/async-queue.js";
import { isDbProxyRequest } from "../shared/db-messages.js";
import { getErrorMessage } from "../shared/error-utils.js";
import {
  isOffscreenControlMessage,
  isOffscreenHeartbeatTickMessage,
} from "../shared/offscreen-messages.js";
import { resolveSyncTargets } from "./sync-targets.js";
import {
  createLogger,
} from "../shared/logger.js";
import {
  createSyncRun,
  updateSyncRun,
  updatePlatformProgress,
  getLatestSyncRun,
  getLastSuccessfulSyncAt,
  getLatestMetrics,
  getExportData,
  createFinancialBackup,
  listFinancialDataPlatformIds,
  getPlatformBatchHistory,
  getMetricsHistory,
  updateMetricsSnapshot,
  deleteMetricsSnapshot,
  saveCredentials,
  getCredentials,
  deleteCredentials,
  resetSelectorProfiles,
  deleteNavigationProfile,
  deleteSelectorProfile,
  getSelectorProfiles,
  getSettings,
  saveSettings,
  listCredentialPlatformIds,
  listCredentialStatus,
  pruneOldData,
  cleanupStaleSyncRuns,
  revertPlatformBatch,
  restoreFinancialBackup,
} from "./db-proxy.js";
import { credentialAad, decrypt, encrypt } from "../shared/crypto/index.js";
import {
  getEncryptionKey,
  hasInvisibleKey,
  initInvisibleKey,
  hasMasterPassword,
  lockSession,
  setupMasterPassword,
  unlockWithMasterPassword,
  resetSessionTimeout,
  clearSessionTimeout,
  SESSION_TIMEOUT_ALARM_NAME,
} from "./keystore.js";
import type { LockStatusChangeReason } from "../shared/messages.js";
import {
  clearCredentialPrefill,
  getCredentialPrefill,
  removeUnsafeCredentialPrefill,
  saveCredentialPrefill,
} from "./credential-prefill.js";
import { assertBackgroundMessageSender } from "./sender-validation.js";
import { runSync, type SyncEvent } from "./sync.js";
import { resolvePendingExtractionChoice, getPersistedPendingExtractionChoice, clearPersistedPendingExtractionChoice } from "./sync/extraction-choice-action.js";
import {
  clearPersistedPendingManualAction,
  getPersistedPendingManualAction,
  resolvePendingManualAction,
} from "./sync/manual-action.js";
import { focusTabForNotification } from "./sync/manual-action-notify.js";
import { updateStoredPlatformModes } from "./platform-modes.js";
import { credentialReplacementLoginMetadata } from "./login-failure-state.js";
import {
  acquireOffscreenLease,
  closeManagedOffscreenDocumentIfIdle,
  startOffscreenHeartbeat,
  stopOffscreenHeartbeat,
} from "./offscreen-manager.js";
import { createMessageRouter } from "./message-router.js";
import {
  getDemoCredentialStatus,
  isDemoModeEnabled,
} from "../shared/demo.js";
import { getActiveDemoPlatformIds } from "./demo-cohorts.js";
import {
  createDemoTimestampProvider,
  reserveNextDemoSyncIndex,
} from "./demo-clock.js";
import { runStorageMigrations } from "./storage-migrations.js";
import {
  CancelSyncPlatformPayloadSchema,
  DeleteCredentialsPayloadSchema,
  DeleteMetricsSnapshotPayloadSchema,
  GetCredentialEditPrefillPayloadSchema,
  GetMetricsHistoryPayloadSchema,
  GetPlatformBatchHistoryPayloadSchema,
  UpdateMetricsSnapshotPayloadSchema,
  ResolveExtractionChoicePayloadSchema,
  ResolveManualActionPayloadSchema,
  RevertPlatformBatchPayloadSchema,
  ResetPlatformSelectorsPayloadSchema,
  GetSelectorProfilesPayloadSchema,
  RestoreFinancialBackupPayloadSchema,
  SaveSettingsPayloadSchema,
  SaveCredentialsPayloadSchema,
  ProxyAiPromptPayloadSchema,
  StartSyncPayloadSchema,
  SetupMasterPasswordPayloadSchema,
  UpdatePlatformModesPayloadSchema,
  ValidateFinancialBackupPayloadSchema,
  FinancialBackupV1Schema,
  UnlockPayloadSchema,
} from "../shared/validation.js";
import {
  getSyncingBadgeState,
  getSyncReminderBadgeState,
  SYNC_REMINDER_ALARM,
} from "./sync-reminder.js";
import { RUNTIME_NAMES } from "../shared/runtime-names.js";

const log = createLogger("background");
const DEFAULT_ACTION_TITLE = "P2P Portfolio Tracker";

function getEnabledPlatformIds(): PlatformId[] {
  return getPlatformCatalog()
    .filter((platform) => platform.enabled)
    .map((platform) => platform.id);
}

// ─── Helper: generate UUID ────────────────────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID();
}

function isPlatformSyncBusy(
  run: StoredSyncRun | undefined,
  platformId: PlatformId,
): boolean {
  if (!run || (run.state !== "queued" && run.state !== "running")) return false;
  const state = run.platformProgress?.[platformId];
  return state === "pending" || state === "running";
}

function isSyncRunBusy(run: StoredSyncRun | undefined): boolean {
  if (!run || (run.state !== "queued" && run.state !== "running")) return false;
  return Object.values(run.platformProgress ?? {}).some(
    (state) => state === "pending" || state === "running",
  );
}

async function openOrFocusDashboard(): Promise<void> {
  const url = chrome.runtime.getURL("dashboard.html");
  const existingTabs = await chrome.tabs.query({ url: `${url}*` });
  const existing = existingTabs.find(
    (tab) => tab.id !== undefined && tab.windowId !== undefined,
  );

  if (existing?.id !== undefined && existing.windowId !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }

  await chrome.tabs.create({ url });
}

// ─── Active sync tracking ────────────────────────────────────────────────────

let runAbortController: AbortController | null = null;
const platformAbortControllers = new Map<PlatformId, AbortController>();
let pendingSyncQueue: PlatformId[] = [];
const pendingForcedExtractionChoiceSignals = new Map<
  PlatformId,
  ExtractionChoiceSignalKey[]
>();
let acceptingSyncQueue = false;
let syncStartClaimed = false;
let masterPasswordSetupClaimed = false;
let activeSyncTask: Promise<void> | null = null;
const cancelledBeforeStartPlatformIds = new Set<PlatformId>();
const syncQueueTransition = createSerialQueue();

function withSyncQueueTransition<T>(
  operation: () => Promise<T> | T,
): Promise<T> {
  return syncQueueTransition.enqueue(operation);
}

function broadcastSafe(event: SyncEvent): void {
  chrome.runtime.sendMessage({ type: "SYNC_PROGRESS", payload: event }).catch(() => {});
}

function hasAbortableSyncControllers(): boolean {
  return runAbortController !== null || platformAbortControllers.size > 0;
}

function abortSyncControllers(): void {
  runAbortController?.abort();
  for (const platformController of platformAbortControllers.values()) {
    platformController.abort();
  }
}

function getQueuedPlatformIds(): PlatformId[] {
  return [...pendingSyncQueue];
}

function getQueuePosition(platformId: PlatformId): number | undefined {
  const index = pendingSyncQueue.indexOf(platformId);
  return index === -1 ? undefined : index + 1;
}

function drainSyncQueue(): PlatformId[] {
  const next = pendingSyncQueue;
  pendingSyncQueue = [];
  return next;
}

async function removeFromSyncQueue(platformId: PlatformId): Promise<boolean> {
  return withSyncQueueTransition(() => {
    const before = pendingSyncQueue.length;
    pendingSyncQueue = pendingSyncQueue.filter((id) => id !== platformId);
    if (pendingSyncQueue.length !== before) {
      pendingForcedExtractionChoiceSignals.delete(platformId);
    }
    return pendingSyncQueue.length !== before;
  });
}

async function resetSyncQueue(): Promise<void> {
  await withSyncQueueTransition(() => {
    pendingSyncQueue = [];
    pendingForcedExtractionChoiceSignals.clear();
    acceptingSyncQueue = false;
    cancelledBeforeStartPlatformIds.clear();
  });
}

function uniqueForcedExtractionChoiceSignals(
  signals: ExtractionChoiceSignalKey[] | undefined,
): ExtractionChoiceSignalKey[] {
  return [...new Set(signals ?? [])];
}

function createForcedExtractionChoiceMap(
  platforms: PlatformCatalogEntry[],
  signals: ExtractionChoiceSignalKey[] | undefined,
): Map<PlatformId, ExtractionChoiceSignalKey[]> {
  const forcedSignals = uniqueForcedExtractionChoiceSignals(signals);
  if (forcedSignals.length === 0) return new Map();
  return new Map(platforms.map((platform) => [platform.id, forcedSignals]));
}

function mergePendingForcedExtractionChoiceSignals(
  platformId: PlatformId,
  signals: ExtractionChoiceSignalKey[] | undefined,
): void {
  const forcedSignals = uniqueForcedExtractionChoiceSignals(signals);
  if (forcedSignals.length === 0) return;
  const existing = pendingForcedExtractionChoiceSignals.get(platformId) ?? [];
  pendingForcedExtractionChoiceSignals.set(platformId, [
    ...new Set([...existing, ...forcedSignals]),
  ]);
}

async function consumePendingForcedExtractionChoiceMap(
  platformIds: PlatformId[],
): Promise<Map<PlatformId, ExtractionChoiceSignalKey[]>> {
  return withSyncQueueTransition(() => {
    const forcedSignalsByPlatform = new Map<
      PlatformId,
      ExtractionChoiceSignalKey[]
    >();
    for (const platformId of platformIds) {
      const forcedSignals = pendingForcedExtractionChoiceSignals.get(platformId);
      if (forcedSignals !== undefined) {
        forcedSignalsByPlatform.set(platformId, forcedSignals);
        pendingForcedExtractionChoiceSignals.delete(platformId);
      }
    }
    return forcedSignalsByPlatform;
  });
}

async function markQueuedPlatformsCancelled(
  runId: string,
  platformIds: PlatformId[],
  message: string,
): Promise<void> {
  for (const platformId of platformIds) {
    pendingForcedExtractionChoiceSignals.delete(platformId);
    cancelledBeforeStartPlatformIds.add(platformId);
    await updatePlatformProgress(runId, platformId, "cancelled");
    broadcastSafe({
      type: "platform_cancelled",
      platformId,
      runId,
      message,
      state: "cancelled",
    });
  }
}

const ACTIVE_SYNC_KEY = RUNTIME_NAMES.activeSync;
const PENDING_AUTO_LOCK_KEY = RUNTIME_NAMES.pendingAutoLock;

async function getActiveSyncRunId(): Promise<string | null> {
  const result = await chrome.storage.session.get(ACTIVE_SYNC_KEY);
  return (result[ACTIVE_SYNC_KEY] as string) ?? null;
}

async function setActiveSyncRunId(runId: string | null): Promise<void> {
  if (runId) {
    await chrome.storage.session.set({ [ACTIVE_SYNC_KEY]: runId });
  } else {
    await chrome.storage.session.remove(ACTIVE_SYNC_KEY);
  }
}

async function setPendingAutoLock(pending: boolean): Promise<void> {
  if (pending) {
    await chrome.storage.session.set({ [PENDING_AUTO_LOCK_KEY]: true });
  } else {
    await chrome.storage.session.remove(PENDING_AUTO_LOCK_KEY);
  }
}

async function hasPendingAutoLock(): Promise<boolean> {
  const result = await chrome.storage.session.get(PENDING_AUTO_LOCK_KEY);
  return result[PENDING_AUTO_LOCK_KEY] === true;
}

async function broadcastLockStatus(
  locked: boolean,
  reason: LockStatusChangeReason,
): Promise<void> {
  await chrome.runtime.sendMessage({
    type: "LOCK_STATUS_CHANGED",
    payload: { locked, hasMasterPassword: true, reason },
  }).catch(() => {});
}

async function lockAndBroadcast(reason: LockStatusChangeReason): Promise<void> {
  await setPendingAutoLock(false);
  await lockSession();
  await broadcastLockStatus(true, reason);
}

async function completePendingAutoLock(): Promise<void> {
  if (!(await hasPendingAutoLock())) return;

  let isMaster = true;
  try {
    isMaster = await hasMasterPassword();
  } catch (error: unknown) {
    log.warn("Could not verify master-password state for pending auto-lock", {
      error: getErrorMessage(error),
    });
  }
  if (!isMaster) {
    await setPendingAutoLock(false);
    return;
  }

  let autoLockEnabled = true;
  try {
    autoLockEnabled = (await getSettings()).autoLockEnabled;
  } catch (error: unknown) {
    log.warn("Could not read settings for pending auto-lock; locking session", {
      error: getErrorMessage(error),
    });
  }
  if (!autoLockEnabled) {
    await setPendingAutoLock(false);
    return;
  }

  await lockAndBroadcast("timeout");
}

async function resetAutoLockForActivity(): Promise<void> {
  if (!(await hasMasterPassword())) return;
  const [settings, key] = await Promise.all([getSettings(), getEncryptionKey()]);
  if (!settings.autoLockEnabled || !key) return;
  await setPendingAutoLock(false);
  await resetSessionTimeout(settings.sessionTimeoutMinutes);
}

// ─── Data cleanup alarm ──────────────────────────────────────────────────────

const CLEANUP_ALARM = RUNTIME_NAMES.cleanupAlarm;
const DAILY_ALARM_MINUTES = 60 * 24;

// ─── Sync keepalive alarm ────────────────────────────────────────────────────

const SYNC_KEEPALIVE_ALARM = RUNTIME_NAMES.syncKeepaliveAlarm;

async function startSyncKeepalive(): Promise<void> {
  await chrome.alarms.create(SYNC_KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
}

async function stopSyncKeepalive(): Promise<void> {
  await chrome.alarms.clear(SYNC_KEEPALIVE_ALARM);
}

async function ensureDailyAlarms(): Promise<void> {
  await Promise.all([
    chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: DAILY_ALARM_MINUTES }),
    chrome.alarms.create(SYNC_REMINDER_ALARM, { periodInMinutes: DAILY_ALARM_MINUTES }),
  ]);
}

async function applyActionBadge(state: {
  text: string;
  title: string;
  color?: string;
}): Promise<void> {
  const operations: Array<Promise<void>> = [
    chrome.action.setBadgeText({ text: state.text }),
    chrome.action.setTitle({ title: state.title }),
  ];

  if (state.color) {
    operations.push(chrome.action.setBadgeBackgroundColor({ color: state.color }));
  }

  await Promise.all(operations);
}

async function refreshSyncReminderBadge(): Promise<void> {
  if (runAbortController) {
    await applyActionBadge(getSyncingBadgeState());
    return;
  }

  const [lastSyncAt, settings] = await Promise.all([
    getLastSuccessfulSyncAt(),
    getSettings(),
  ]);

  await applyActionBadge(
    getSyncReminderBadgeState(
      lastSyncAt,
      settings.syncReminderDays,
      DEFAULT_ACTION_TITLE,
    ),
  );
}

async function setSyncActionState(syncing: boolean): Promise<void> {
  if (syncing) {
    await applyActionBadge(getSyncingBadgeState());
    return;
  }

  await refreshSyncReminderBadge();
}

async function startSyncRuntimeSupport(): Promise<void> {
  await Promise.all([
    startSyncKeepalive(),
    startOffscreenHeartbeat(),
    setSyncActionState(true),
  ]);
}

async function stopSyncRuntimeSupport(): Promise<void> {
  await Promise.all([
    stopSyncKeepalive(),
    stopOffscreenHeartbeat(),
    setSyncActionState(false),
  ]);
}

async function broadcastMetricsUpdate(): Promise<{
  metrics: Awaited<ReturnType<typeof getLatestMetrics>>;
  dataPlatformIds: Awaited<ReturnType<typeof listFinancialDataPlatformIds>>;
}> {
  const metrics = await getLatestMetrics();
  const dataPlatformIds = await listFinancialDataPlatformIds();
  await chrome.runtime
    .sendMessage({ type: "METRICS_UPDATED", payload: { metrics, dataPlatformIds } })
    .catch(() => {});
  return { metrics, dataPlatformIds };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_KEEPALIVE_ALARM) {
    reconcileOrphanedSyncRuns().catch(() => {});
  } else if (alarm.name === CLEANUP_ALARM) {
    getSettings()
      .then((settings) => pruneOldData(settings.historyRetentionDays))
      .catch((error: unknown) => {
        log.error("Data cleanup failed", { error: getErrorMessage(error) });
      });
  } else if (alarm.name === SYNC_REMINDER_ALARM) {
    refreshSyncReminderBadge().catch((error: unknown) => {
      log.error("Sync reminder badge update failed", { error: getErrorMessage(error) });
    });
  } else if (alarm.name === SESSION_TIMEOUT_ALARM_NAME) {
    void (async () => {
      let isMaster = true;
      try {
        isMaster = await hasMasterPassword();
      } catch (error: unknown) {
        log.warn("Could not verify master-password state at auto-lock timeout", {
          error: getErrorMessage(error),
        });
      }
      if (!isMaster) return;

      let autoLockEnabled = true;
      try {
        autoLockEnabled = (await getSettings()).autoLockEnabled;
      } catch (error: unknown) {
        log.warn("Could not read settings at auto-lock timeout; locking session", {
          error: getErrorMessage(error),
        });
      }
      if (!autoLockEnabled) return;

      const activeSyncRunId = await getActiveSyncRunId();
      if (activeSyncRunId) {
        await setPendingAutoLock(true);
        log.info("Session auto-lock deferred until sync completes");
        return;
      }

      await lockAndBroadcast("timeout");
      log.info("Session auto-locked after timeout");
    })().catch((error: unknown) => {
      log.error("Session auto-lock failed", { error: getErrorMessage(error) });
    });
  }
});

// ─── Sync recovery on SW restart ────────────────────────────────────────────

async function cleanupStaleSyncRun(
  runId: string,
  terminalState: "failed" | "cancelled",
  message: string,
): Promise<void> {
  await resetSyncQueue();
  const run = await getLatestSyncRun();
  if (run && run.runId === runId && run.platformProgress) {
    for (const [platformId, state] of Object.entries(run.platformProgress)) {
      if (state === "running" || state === "pending") {
        const pState = terminalState === "cancelled" ? "cancelled" : "failed_timeout";
        await updatePlatformProgress(runId, platformId as PlatformId, pState);
        broadcastSafe({
          type: terminalState === "failed" ? "platform_error" : "platform_cancelled",
          platformId: platformId as PlatformId,
          runId,
          message,
          state: pState,
        });
      }
    }
  }

  await updateSyncRun(runId, {
    state: terminalState,
    finishedAt: new Date().toISOString(),
    message,
  });

  try {
    await clearPersistedPendingExtractionChoice();
    await clearPersistedPendingManualAction();
    await stopSyncRuntimeSupport();
    await closeManagedOffscreenDocumentIfIdle();

    broadcastSafe({
      type: terminalState === "failed" ? "sync_failed" : "sync_cancelled",
      platformId: "",
      runId,
      message,
    });
    await broadcastMetricsUpdate();
  } finally {
    await setActiveSyncRunId(null);
    await completePendingAutoLock();
  }
}

async function cancelActiveSyncRun(runId: string): Promise<void> {
  const controller = runAbortController;
  const syncTask = activeSyncTask;
  const run = await getLatestSyncRun();
  const activePlatformStates = run?.platformProgress
    ? Object.fromEntries(
        Object.entries(run.platformProgress).filter(([, state]) =>
          state === "running" || state === "pending",
        ),
      )
    : {};

  log.warn("Cancel all requested", {
    runId,
    hasRunAbortController: controller !== null,
    platformAbortControllerCount: platformAbortControllers.size,
    activePlatformStates,
  });

  abortSyncControllers();

  if (syncTask) {
    await syncTask.catch(() => undefined);
  } else {
    await cleanupStaleSyncRun(
      runId,
      "cancelled",
      "Sync cancelled by user",
    );
  }

  if (controller === null || runAbortController === controller) {
    runAbortController = null;
    platformAbortControllers.clear();
  }

  log.warn("Cancel all cleanup completed", {
    runId,
    activeSyncCleared: true,
  });
}

async function recoverStaleSyncRun(): Promise<void> {
  const activeSyncRunId = await getActiveSyncRunId();
  if (activeSyncRunId) {
    log.debug("Recovering specifically tracked active sync run", {
      runId: activeSyncRunId,
    });
    await cleanupStaleSyncRun(activeSyncRunId, "failed", "Sync interrupted by service worker restart");
  } else {
    // Fallback: clean up any other abandoned sync runs in the DB
    try {
      log.debug("Checking DB for orphaned sync runs after restart");
      await cleanupStaleSyncRuns();
      await clearPersistedPendingExtractionChoice();
      await clearPersistedPendingManualAction();
    } catch (err) {
      log.error("Failed to clean up stale syncs", {
        error: getErrorMessage(err),
      });
    }
  }
}

async function reconcileOrphanedSyncRuns(): Promise<void> {
  const activeSyncRunId = await getActiveSyncRunId();
  if (activeSyncRunId && !runAbortController) {
    await recoverStaleSyncRun();
    return;
  }

  const run = await getLatestSyncRun();
  if (
    run &&
    (run.state === "running" || run.state === "queued") &&
    !activeSyncRunId &&
    !runAbortController
  ) {
    log.debug("Recovering orphaned sync run without active session key", {
      runId: run.runId,
    });
    await cleanupStaleSyncRuns();
    await clearPersistedPendingExtractionChoice();
    await clearPersistedPendingManualAction();
  }
}

// ─── Extension installed / startup ───────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await removeUnsafeCredentialPrefill().catch(() => {});
  const migrationResult = await runStorageMigrations();
  if (migrationResult.appliedVersions.length > 0) {
    log.info("Applied storage migrations during install", migrationResult);
  }

  await ensureDailyAlarms();
  await refreshSyncReminderBadge().catch((error: unknown) => {
    log.error("Initial sync reminder badge update failed", {
      error: getErrorMessage(error),
    });
  });

  const existing = await chrome.storage.local.get([
    RUNTIME_NAMES.hasMasterPassword,
    RUNTIME_NAMES.onboardingComplete,
  ]);
  const onboardingDone = existing[RUNTIME_NAMES.onboardingComplete];
  if (!onboardingDone) {
    // Don't init key yet — wait for user onboarding choice in dashboard.
    // But if a key already exists (upgrade scenario), mark onboarding done.
    const hasKey =
      (await hasInvisibleKey()) || existing[RUNTIME_NAMES.hasMasterPassword];
    if (hasKey) {
      await chrome.storage.local.set({
        [RUNTIME_NAMES.onboardingComplete]: true,
      });
    }
    return;
  }
  const firstRun =
    !(await hasInvisibleKey()) && !existing[RUNTIME_NAMES.hasMasterPassword];
  if (firstRun) {
    await initInvisibleKey();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const migrationResult = await runStorageMigrations();
  if (migrationResult.appliedVersions.length > 0) {
    log.info("Applied storage migrations during startup", migrationResult);
  }

  await ensureDailyAlarms();

  // Recover any sync run that was interrupted by SW termination
  await recoverStaleSyncRun();

  const hasMaster = await hasMasterPassword();
  if (!hasMaster) {
    // Restore invisible key into session
    if (await hasInvisibleKey()) {
      await initInvisibleKey();
    }
  }
  // If master password mode, session key is null until user unlocks
  await refreshSyncReminderBadge().catch((error: unknown) => {
    log.error("Startup sync reminder badge update failed", {
      error: getErrorMessage(error),
    });
  });
});

chrome.action.onClicked.addListener(() => {
  void openOrFocusDashboard();
});

if (typeof chrome.notifications?.onClicked !== "undefined") {
  chrome.notifications.onClicked.addListener((notificationId) => {
    void focusTabForNotification(notificationId);
  });
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundMessage | unknown,
    sender,
    sendResponse: (response: unknown) => void,
  ) => {
    if (isDbProxyRequest(message) || isOffscreenControlMessage(message)) {
      // These are either internal or handled by offscreen
      return false;
    }

    if (isOffscreenHeartbeatTickMessage(message)) {
      sendResponse({ ok: true });
      return false;
    }

    // Secure by default: most background messages MUST come from popup/dashboard
    try {
      assertBackgroundMessageSender(sender, message);
    } catch (error) {
      const messageType =
        typeof message === "object" && message !== null && "type" in message
          ? String((message as { type?: unknown }).type)
          : undefined;
      log.warn("Blocked unauthorized message", {
        type: messageType,
        sender: sender.url,
      });
      sendResponse({ success: false, error: (error as Error).message });
      return false;
    }

    handleMessage(message as BackgroundMessage, sendResponse).catch(
      (error: unknown) => {
        const err = getErrorMessage(error);
        log.error("Background message handling failed", { error: err });
        sendResponse({ error: err });
      },
    );
    return true; // Always keep channel open for async
  },
);

async function handleMessage(
  message: BackgroundMessage,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  if (SESSION_ACTIVITY_MESSAGE_TYPES.has(message.type)) {
    try {
      await resetAutoLockForActivity();
    } catch (error: unknown) {
      log.warn("Could not reset auto-lock timer for extension activity", {
        error: getErrorMessage(error),
      });
    }
  }

  await routeBackgroundMessage(message, sendResponse);
}

const SESSION_ACTIVITY_MESSAGE_TYPES = new Set<BackgroundMessage["type"]>([
  "START_SYNC",
  "GET_EXPORT_DATA",
  "CREATE_FINANCIAL_BACKUP",
  "RESTORE_FINANCIAL_BACKUP",
  "SAVE_CREDENTIALS",
  "UPDATE_PLATFORM_MODES",
  "DELETE_CREDENTIALS",
  "RESET_PLATFORM_SELECTORS",
  "OPEN_DASHBOARD",
  "SAVE_SETTINGS",
  "CANCEL_SYNC_PLATFORM",
  "CANCEL_SYNC_ALL",
  "REVERT_PLATFORM_BATCH",
  "UPDATE_METRICS_SNAPSHOT",
  "DELETE_METRICS_SNAPSHOT",
  "RESOLVE_EXTRACTION_CHOICE",
  "RESOLVE_MANUAL_ACTION",
  "SESSION_ACTIVITY",
]);

const routeBackgroundMessage = createMessageRouter<BackgroundMessage>({
  START_SYNC: async (message, sendResponse) => {
    StartSyncPayloadSchema.parse(message.payload);
    await handleStartSync(message, sendResponse);
  },

  GET_SYNC_STATUS: async (_message, sendResponse) => {
    await reconcileOrphanedSyncRuns();
    const run = await getLatestSyncRun();
    const pendingChoice =
      run?.state === "running"
        ? await getPersistedPendingExtractionChoice()
        : undefined;
    const pendingManualAction =
      run?.state === "running"
        ? await getPersistedPendingManualAction()
        : undefined;
    sendResponse({
      run,
      pendingChoice,
      pendingManualAction,
      queuedPlatformIds: run?.state === "running" ? getQueuedPlatformIds() : [],
    });
  },

  GET_METRICS: async (_message, sendResponse) => {
    const metrics = await getLatestMetrics();
    const dataPlatformIds = await listFinancialDataPlatformIds();
    sendResponse({ metrics, dataPlatformIds });
  },

  GET_EXPORT_DATA: async (_message, sendResponse) => {
    const data = await getExportData();
    sendResponse({ data });
  },

  CREATE_FINANCIAL_BACKUP: async (_message, sendResponse) => {
    const appVersion = chrome.runtime.getManifest?.().version ?? "unknown";
    const backup = await createFinancialBackup(appVersion);
    sendResponse({ backup });
  },

  VALIDATE_FINANCIAL_BACKUP: async (message, sendResponse) => {
    const validated = ValidateFinancialBackupPayloadSchema.parse(message.payload);
    const result = FinancialBackupV1Schema.safeParse(validated.backup);
    if (!result.success) {
      sendResponse({ valid: false, error: "Invalid financial backup file" });
      return;
    }
    sendResponse({ valid: true, backup: result.data as FinancialBackupV1 });
  },

  RESTORE_FINANCIAL_BACKUP: async (message, sendResponse) => {
    const validated = RestoreFinancialBackupPayloadSchema.parse(message.payload);
    const currentRun = await getLatestSyncRun();
    if (isSyncRunBusy(currentRun)) {
      sendResponse({
        success: false,
        error: "Cannot restore a backup while sync is running",
      });
      return;
    }

    try {
      await restoreFinancialBackup(validated.backup as FinancialBackupV1);
      const { metrics, dataPlatformIds } = await broadcastMetricsUpdate();
      sendResponse({ success: true, metrics, dataPlatformIds });
    } catch (error) {
      sendResponse({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },

  SAVE_CREDENTIALS: async (message, sendResponse) => {
    SaveCredentialsPayloadSchema.parse(message.payload);
    await handleSaveCredentials(message, sendResponse);
  },

  UPDATE_PLATFORM_MODES: async (message, sendResponse) => {
    const validated = UpdatePlatformModesPayloadSchema.parse(message.payload);
    await handleUpdatePlatformModes(
      { ...message, payload: validated },
      sendResponse,
    );
  },

  DELETE_CREDENTIALS: async (message, sendResponse) => {
    const validated = DeleteCredentialsPayloadSchema.parse(message.payload);
    await deleteCredentials(validated.platformId);
    sendResponse({ success: true });
  },

  GET_SELECTOR_PROFILES: async (message, sendResponse) => {
    const validated = GetSelectorProfilesPayloadSchema.parse(message.payload);
    try {
      sendResponse({
        success: true,
        profiles: await getSelectorProfiles(validated.platformId),
      });
    } catch (error) {
      sendResponse({
        success: false,
        profiles: [],
        error: getErrorMessage(error),
      });
    }
  },

  RESET_PLATFORM_SELECTORS: async (message, sendResponse) => {
    const validated = ResetPlatformSelectorsPayloadSchema.parse(message.payload);
    try {
      if (validated.signalKey) {
        await deleteSelectorProfile(validated.platformId, validated.signalKey);
      } else {
        await resetSelectorProfiles(validated.platformId);
        // A full reset also forgets which page we learned to extract from.
        await deleteNavigationProfile(validated.platformId);
      }
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },

  OPEN_DASHBOARD: async (_message, sendResponse) => {
    await openOrFocusDashboard();
    sendResponse({});
  },

  GET_CREDENTIAL_STATUS: async (_message, sendResponse) => {
    const credentials = isDemoModeEnabled
      ? getDemoCredentialStatus(
          await getActiveDemoPlatformIds(getEnabledPlatformIds()),
        )
      : await listCredentialStatus();
    sendResponse({
      platformIds: credentials.map((entry) => entry.platformId),
      credentials,
    });
  },

  GET_SETTINGS: async (_message, sendResponse) => {
    const settings = await getSettings();
    sendResponse({ settings });
  },

  GET_CREDENTIAL_PREFILL: async (_message, sendResponse) => {
    const key = await getEncryptionKey();
    const username = key ? await getCredentialPrefill(key) : "";
    sendResponse({ username });
  },

  GET_CREDENTIAL_EDIT_PREFILL: async (message, sendResponse) => {
    const { platformId } = GetCredentialEditPrefillPayloadSchema.parse(
      message.payload,
    );
    const username = await getCredentialEditPrefill(platformId);
    sendResponse({ username });
  },

  SAVE_SETTINGS: async (message, sendResponse) => {
    const validated = SaveSettingsPayloadSchema.parse(message.payload);
    const previous = await getSettings();
    await saveSettings(validated);
    const next = { ...previous, ...validated };
    if (await hasMasterPassword()) {
      const key = await getEncryptionKey();
      if (next.autoLockEnabled && key) {
        await setPendingAutoLock(false);
        await resetSessionTimeout(next.sessionTimeoutMinutes);
      } else {
        await setPendingAutoLock(false);
        await clearSessionTimeout();
      }
    }
    await refreshSyncReminderBadge();
    sendResponse({ success: true });
  },

  SETUP_MASTER_PASSWORD: async (message, sendResponse) => {
    const validated = SetupMasterPasswordPayloadSchema.parse(message.payload);
    if (masterPasswordSetupClaimed) {
      sendResponse({
        success: false,
        error: "Master password setup is already in progress.",
      });
      return;
    }
    masterPasswordSetupClaimed = true;
    try {
      const alreadySet = await hasMasterPassword();
      if (alreadySet) {
        sendResponse({
          success: false,
          error: "Master password already configured",
        });
        return;
      }
      if (
        syncStartClaimed ||
        runAbortController !== null ||
        activeSyncTask !== null ||
        (await getActiveSyncRunId())
      ) {
        sendResponse({
          success: false,
          error: "Wait for the current sync to finish before setting a master password.",
        });
        return;
      }

      await saveSettings({
        autoLockEnabled: true,
        sessionTimeoutMinutes: 15,
      });
      await setupMasterPassword(validated.password);

      const followUpResults = await Promise.allSettled([
        clearCredentialPrefill(),
        chrome.storage.local.set({
          [RUNTIME_NAMES.onboardingComplete]: true,
        }),
        setPendingAutoLock(false),
        resetSessionTimeout(15),
        broadcastLockStatus(false, "setup"),
      ]);
      for (const result of followUpResults) {
        if (result.status === "rejected") {
          log.warn("Master-password setup follow-up failed", {
            error: getErrorMessage(result.reason),
          });
        }
      }
      sendResponse({ success: true });
    } finally {
      masterPasswordSetupClaimed = false;
    }
  },

  UNLOCK: async (message, sendResponse) => {
    const validated = UnlockPayloadSchema.parse(message.payload);
    const ok = await unlockWithMasterPassword(validated.password);
    if (ok) {
      const s = await getSettings();
      await setPendingAutoLock(false);
      if (s.autoLockEnabled) {
        await resetSessionTimeout(s.sessionTimeoutMinutes);
      }
      await broadcastLockStatus(false, "unlock");
    }
    sendResponse({
      success: ok,
      ...(!ok ? { error: "Incorrect password" } : {}),
    });
  },

  GET_LOCK_STATUS: async (_message, sendResponse) => {
    const hasMaster = await hasMasterPassword();
    const key = await getEncryptionKey();
    sendResponse({
      locked: hasMaster && key === null,
      hasMasterPassword: hasMaster,
    });
  },

  LOCK: async (_message, sendResponse) => {
    const activeSyncRunId = await getActiveSyncRunId();
    if (activeSyncRunId) {
      await cancelActiveSyncRun(activeSyncRunId);
    } else {
      abortSyncControllers();
    }
    await lockAndBroadcast("manual");
    sendResponse({ success: true });
  },

  SESSION_ACTIVITY: async (_message, sendResponse) => {
    sendResponse({ success: true });
  },

  INIT_INVISIBLE_KEY: async (_message, sendResponse) => {
    await initInvisibleKey();
    await chrome.storage.local.set({
      [RUNTIME_NAMES.onboardingComplete]: true,
    });
    sendResponse({ success: true });
  },

  GET_GEMINI_STATUS: async (_message, sendResponse) => {
    const { status } = await checkGeminiAvailability();
    sendResponse({ status });
  },

  TRIGGER_GEMINI_DOWNLOAD: (_message, sendResponse) => {
    triggerGeminiDownload({ broadcast: true }).catch((error: unknown) => {
      log.error("Gemini download trigger failed", {
        error: getErrorMessage(error),
      });
    });
    sendResponse({ success: true });
  },

  PROXY_CHECK_AI: async (_message, sendResponse) => {
    const { status } = await checkGeminiAvailability();
    sendResponse({ status });
  },

  PROXY_AI_PROMPT: async (message, sendResponse) => {
    const validated = ProxyAiPromptPayloadSchema.parse(message.payload);
    await handleProxyAiPrompt({ ...message, payload: validated }, sendResponse);
  },

  CANCEL_SYNC_PLATFORM: async (message, sendResponse) => {
    const validated = CancelSyncPlatformPayloadSchema.parse(message.payload);
    const activeSyncRunId = await getActiveSyncRunId();
    if (!activeSyncRunId) {
      sendResponse({ success: false, error: "No active sync" });
      return;
    }
    if (await removeFromSyncQueue(validated.platformId)) {
      await markQueuedPlatformsCancelled(
        activeSyncRunId,
        [validated.platformId],
        "Cancelled by user",
      );
      sendResponse({ success: true });
      return;
    }
    const controller = platformAbortControllers.get(validated.platformId);
    if (controller) {
      controller.abort();
      sendResponse({ success: true });
      return;
    }

    cancelledBeforeStartPlatformIds.add(validated.platformId);
    await updatePlatformProgress(
      activeSyncRunId,
      validated.platformId,
      "cancelled",
    );
    broadcastSafe({
      type: "platform_cancelled",
      platformId: validated.platformId,
      runId: activeSyncRunId,
      message: "Cancelled by user",
      state: "cancelled",
    });

    const run = await getLatestSyncRun();
    if (run && run.runId === activeSyncRunId && run.platformProgress) {
      const anyActive = Object.values(run.platformProgress).some(
        (s) => s === "running" || s === "pending",
      );
      if (!anyActive) {
        await cleanupStaleSyncRun(
          activeSyncRunId,
          "cancelled",
          "Sync cancelled by user",
        );
      }
    }
    sendResponse({ success: true });
  },

  CANCEL_SYNC_ALL: async (_message, sendResponse) => {
    const activeSyncRunId = await getActiveSyncRunId();
    log.warn("CANCEL_SYNC_ALL message received", {
      activeSyncRunId,
      hasRunAbortController: runAbortController !== null,
      platformAbortControllerCount: platformAbortControllers.size,
    });
    if (!activeSyncRunId) {
      if (hasAbortableSyncControllers()) {
        abortSyncControllers();
        sendResponse({ success: true });
        return;
      }
      await resetSyncQueue();
      await cleanupStaleSyncRuns();
      await clearPersistedPendingExtractionChoice();
      await clearPersistedPendingManualAction();
      sendResponse({ success: true });
      return;
    }
    await cancelActiveSyncRun(activeSyncRunId);
    sendResponse({ success: true });
  },

  CLEANUP_STALE_SYNCS: async (_message, sendResponse) => {
    await cleanupStaleSyncRuns();
    sendResponse({ success: true });
  },

  GET_PLATFORM_BATCH_HISTORY: async (message, sendResponse) => {
    const validated = GetPlatformBatchHistoryPayloadSchema.parse(message.payload);
    const batches = await getPlatformBatchHistory(validated.platformId);
    sendResponse({ batches });
  },

  REVERT_PLATFORM_BATCH: async (message, sendResponse) => {
    const validated = RevertPlatformBatchPayloadSchema.parse(message.payload);
    const currentRun = await getLatestSyncRun();
    if (isPlatformSyncBusy(currentRun, validated.platformId)) {
      sendResponse({
        success: false,
        error: "Cannot revert an import while this platform is syncing",
      });
      return;
    }

    try {
      await revertPlatformBatch(validated.platformId, validated.batchId);
      await broadcastMetricsUpdate();
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },

  GET_METRICS_HISTORY: async (message, sendResponse) => {
    const validated = GetMetricsHistoryPayloadSchema.parse(message.payload);
    const snapshots = await getMetricsHistory(
      validated.platformId,
      validated.limit,
    );
    sendResponse({ snapshots });
  },

  UPDATE_METRICS_SNAPSHOT: async (message, sendResponse) => {
    const validated = UpdateMetricsSnapshotPayloadSchema.parse(message.payload);
    const currentRun = await getLatestSyncRun();
    if (isPlatformSyncBusy(currentRun, validated.platformId)) {
      sendResponse({
        success: false,
        error: "Cannot edit history while this platform is syncing",
      });
      return;
    }

    try {
      await updateMetricsSnapshot(validated.platformId, validated.date, {
        platformValue: validated.platformValue,
        freeCash: validated.freeCash,
      });
      await broadcastMetricsUpdate();
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },

  DELETE_METRICS_SNAPSHOT: async (message, sendResponse) => {
    const validated = DeleteMetricsSnapshotPayloadSchema.parse(message.payload);
    const currentRun = await getLatestSyncRun();
    if (isPlatformSyncBusy(currentRun, validated.platformId)) {
      sendResponse({
        success: false,
        error: "Cannot delete history while this platform is syncing",
      });
      return;
    }

    try {
      await deleteMetricsSnapshot(validated.platformId, validated.date);
      // Deleting the latest snapshot changes the platform's "last sync" age.
      await setSyncActionState(false);
      await broadcastMetricsUpdate();
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: getErrorMessage(error),
      });
    }
  },

  RESOLVE_EXTRACTION_CHOICE: async (message, sendResponse) => {
    const validated = ResolveExtractionChoicePayloadSchema.parse(message.payload);
    const success = await resolvePendingExtractionChoice(
      validated.requestId,
      validated.candidateId,
    );
    sendResponse(
      success
        ? { success: true }
        : { success: false, error: "Extraction choice request not found" },
    );
  },

  RESOLVE_MANUAL_ACTION: async (message, sendResponse) => {
    const validated = ResolveManualActionPayloadSchema.parse(message.payload);
    const result = await resolvePendingManualAction(validated.requestId, {
      ...(validated.code === undefined ? {} : { code: validated.code }),
      // Only captcha waits can be overridden — continuing a 2FA step without a
      // live session would just extract from a logged-out page.
      ...(validated.force === true && validated.actionType === "captcha"
        ? { force: true }
        : {}),
    });
    sendResponse(
      result.success
        ? { success: true }
        : {
            success: false,
            error: result.error ?? "Manual action verification failed",
            ...(result.gone === true ? { gone: true } : {}),
          },
    );
  },
});

// ─── Save credentials ─────────────────────────────────────────────────────────

async function handleSaveCredentials(
  message: SaveCredentialsMessage,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const key = await getEncryptionKey();
  if (!key) {
    sendResponse({
      success: false,
      error: "Encryption key not available. Unlock required.",
    });
    return;
  }

  const { platformId, credentials, config } = message.payload;
  const encryptedUsername = await encrypt(
    key,
    credentials.username,
    credentialAad(platformId, "username"),
  );
  const encryptedPassword = await encrypt(
    key,
    credentials.password,
    credentialAad(platformId, "password"),
  );
  const now = new Date().toISOString();
  const existing = await getCredentials(platformId);

  await saveCredentials({
    platformId,
    encryptedUsername,
    encryptedPassword,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(config?.safeModeEnabled === undefined
      ? {}
      : { safeModeEnabled: config.safeModeEnabled }),
    ...(config?.stealthModeEnabled === undefined
      ? {}
      : { stealthModeEnabled: config.stealthModeEnabled }),
    ...credentialReplacementLoginMetadata(existing),
  });
  await saveCredentialPrefill(key, credentials.username);

  // Zero out plain-text credentials from scope (GC will handle)
  sendResponse({ success: true });
}

async function getCredentialEditPrefill(platformId: PlatformId): Promise<string> {
  const key = await getEncryptionKey();
  if (!key) return "";

  const stored = await getCredentials(platformId);
  if (!stored) return "";

  try {
    return await decrypt(
      key,
      stored.encryptedUsername,
      credentialAad(platformId, "username"),
    );
  } catch {
    return "";
  }
}

async function handleUpdatePlatformModes(
  message: UpdatePlatformModesMessage,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  try {
    await updateStoredPlatformModes(
      message.payload.platformId,
      message.payload.config,
      { getCredentials, saveCredentials },
    );
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : "Failed to update modes",
    });
  }
}

// ─── Start sync ───────────────────────────────────────────────────────────────

async function resolveStartSyncTargets(
  message: StartSyncMessage,
): Promise<{
  settings: Awaited<ReturnType<typeof getSettings>>;
  platforms: PlatformCatalogEntry[];
}> {
  const settings = await getSettings();
  const configuredPlatformIds = isDemoModeEnabled
    ? await getActiveDemoPlatformIds(getEnabledPlatformIds())
    : await listCredentialPlatformIds();
  const platforms = resolveSyncTargets({
    catalog: getPlatformCatalog(),
    configuredPlatformIds,
    disabledPlatformIds: settings.disabledPlatformIds ?? [],
    ...(message.payload.platformIds !== undefined
      ? { requestedPlatformIds: message.payload.platformIds }
      : {}),
  });

  return { settings, platforms };
}

function getNoSyncTargetsError(message: StartSyncMessage): string {
  return message.payload.platformIds
    ? "No matching platforms to sync"
    : "No configured platforms to sync";
}

async function enqueueSyncTargets(
  runId: string,
  platforms: PlatformCatalogEntry[],
  forceExtractionChoiceForSignals?: ExtractionChoiceSignalKey[],
): Promise<{ enqueued: PlatformId[]; rejected: PlatformId[] }> {
  return withSyncQueueTransition(async () => {
    const enqueued: PlatformId[] = [];
    const rejected: PlatformId[] = [];
    if (!acceptingSyncQueue) {
      return {
        enqueued,
        rejected: platforms.map((platform) => platform.id),
      };
    }

    const run = await getLatestSyncRun();
    if (!acceptingSyncQueue) {
      return {
        enqueued,
        rejected: platforms.map((platform) => platform.id),
      };
    }

    const activePlatformIds = new Set<PlatformId>();
    if (run?.runId === runId) {
      for (const [platformId, state] of Object.entries(run.platformProgress ?? {})) {
        if (state === "pending" || state === "running") {
          activePlatformIds.add(platformId as PlatformId);
        }
      }
    }

    for (const platform of platforms) {
      if (activePlatformIds.has(platform.id)) {
        continue;
      }
      if (!acceptingSyncQueue) {
        rejected.push(platform.id);
        continue;
      }
      if (pendingSyncQueue.includes(platform.id)) {
        mergePendingForcedExtractionChoiceSignals(
          platform.id,
          forceExtractionChoiceForSignals,
        );
        continue;
      }

      cancelledBeforeStartPlatformIds.delete(platform.id);
      pendingSyncQueue.push(platform.id);
      mergePendingForcedExtractionChoiceSignals(
        platform.id,
        forceExtractionChoiceForSignals,
      );
      const queuePosition = getQueuePosition(platform.id);
      await updatePlatformProgress(runId, platform.id, "pending");
      enqueued.push(platform.id);
      broadcastSafe({
        type: "platform_queued",
        platformId: platform.id,
        runId,
        message:
          queuePosition === undefined
            ? "In Queue"
            : `In Queue #${queuePosition}`,
        ...(queuePosition === undefined ? {} : { queuePosition }),
        state: "pending",
      });
    }

    return { enqueued, rejected };
  });
}

async function handleStartSync(
  message: StartSyncMessage,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  if (masterPasswordSetupClaimed) {
    sendResponse({ error: "Security setup is in progress. Please try again shortly." });
    return;
  }
  if (syncStartClaimed) {
    sendResponse({ error: "A sync is starting. Please try again shortly." });
    return;
  }
  syncStartClaimed = true;
  try {
    await handleStartSyncClaimed(message, sendResponse);
  } finally {
    syncStartClaimed = false;
  }
}

async function handleStartSyncClaimed(
  message: StartSyncMessage,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const createdPreStartController = runAbortController === null;
  if (createdPreStartController) {
    runAbortController = new AbortController();
  }
  if (!runAbortController) {
    throw new Error("Unable to create sync cancellation controller");
  }
  const currentRunAbortController = runAbortController;

  const clearCurrentRunControllers = () => {
    if (runAbortController === currentRunAbortController) {
      runAbortController = null;
      platformAbortControllers.clear();
    }
  };

  const throwIfStartCancelled = () => {
    if (currentRunAbortController.signal.aborted) {
      throw new Error("Sync cancelled by user");
    }
  };

  let activeSyncRunId: string | null;
  try {
    activeSyncRunId = await getActiveSyncRunId();
    throwIfStartCancelled();
  } catch (error) {
    if (createdPreStartController) {
      clearCurrentRunControllers();
    }
    throw error;
  }
  if (activeSyncRunId) {
    if (createdPreStartController) {
      clearCurrentRunControllers();
    }
    if (!acceptingSyncQueue || !runAbortController) {
      sendResponse({ error: "A sync is finishing. Please try again shortly." });
      return;
    }
    const { platforms } = await resolveStartSyncTargets(message);
    throwIfStartCancelled();
    if (!acceptingSyncQueue || !runAbortController) {
      sendResponse({ error: "A sync is finishing. Please try again shortly." });
      return;
    }
    if (!platforms.length) {
      sendResponse({ error: getNoSyncTargetsError(message) });
      return;
    }
    const queueResult = await enqueueSyncTargets(
      activeSyncRunId,
      platforms,
      message.payload.forceExtractionChoiceForSignals,
    );
    if (queueResult.rejected.length > 0 && queueResult.enqueued.length === 0) {
      sendResponse({ error: "Sync finished while queueing — try again" });
      return;
    }
    sendResponse({
      runId: activeSyncRunId,
      queued: true,
      queuedPlatformIds: getQueuedPlatformIds(),
    });
    return;
  }

  platformAbortControllers.clear();

  const demoMode = isDemoModeEnabled;
  let settings: Awaited<ReturnType<typeof resolveStartSyncTargets>>["settings"];
  let platforms: PlatformCatalogEntry[];
  let runId: string;
  let demoSyncIndex: number | undefined;
  let releaseSyncLease: (() => Promise<void>) | null = null;

  try {
    const key = demoMode ? true : await getEncryptionKey();
    throwIfStartCancelled();
    if (!key) {
      sendResponse({
        error: "Encryption key not available. Please unlock first.",
      });
      clearCurrentRunControllers();
      return;
    }

    const resolved = await resolveStartSyncTargets(message);
    throwIfStartCancelled();
    settings = resolved.settings;
    platforms = resolved.platforms;

    if (!platforms.length) {
      sendResponse({ error: getNoSyncTargetsError(message) });
      clearCurrentRunControllers();
      return;
    }

    runId = generateId();
    demoSyncIndex = demoMode ? await reserveNextDemoSyncIndex() : undefined;
    throwIfStartCancelled();
  } catch (error) {
    clearCurrentRunControllers();
    throw error;
  }

  function getPlatformSignal(platformId: PlatformId): AbortSignal {
    let controller = platformAbortControllers.get(platformId);
    if (!controller || controller.signal.aborted) {
      controller = new AbortController();
      platformAbortControllers.set(platformId, controller);
      if (
        currentRunAbortController.signal.aborted ||
        cancelledBeforeStartPlatformIds.delete(platformId)
      ) {
        controller.abort();
      } else {
        // Chain: if the run is cancelled, also cancel this platform
        currentRunAbortController.signal.addEventListener("abort", () => controller!.abort(), { once: true });
      }
    }
    return controller.signal;
  }

  try {
    releaseSyncLease = await acquireOffscreenLease("sync");
    throwIfStartCancelled();
    await setActiveSyncRunId(runId);
    await startSyncRuntimeSupport();

    await createSyncRun(
      runId,
      platforms.map((p) => p.id),
    );
    await updateSyncRun(runId, { state: "running" });
    acceptingSyncQueue = true;
  } catch (error) {
    await Promise.allSettled([
      setActiveSyncRunId(null),
      stopSyncRuntimeSupport(),
      releaseSyncLease ? releaseSyncLease() : Promise.resolve(),
    ]);
    acceptingSyncQueue = false;
    clearCurrentRunControllers();
    await closeManagedOffscreenDocumentIfIdle();
    throw error;
  }

  sendResponse({ runId });

  // Broadcast progress to all extension views
  function broadcast(event: SyncEvent): void {
    chrome.runtime
      .sendMessage({ type: "SYNC_PROGRESS", payload: event })
      .catch(() => {
        // No listener (popup closed) — ignore
      });
  }

  const syncTask = (async () => {
    try {
      const catalogById = new Map(
        getPlatformCatalog().map((platform) => [platform.id, platform]),
      );
      let currentBatch = platforms;
      let currentForcedExtractionChoiceSignals =
        createForcedExtractionChoiceMap(
          currentBatch,
          message.payload.forceExtractionChoiceForSignals,
        );
      let finalSyncEvent: SyncEvent | null = null;

      while (currentBatch.length > 0) {
        let batchTerminalEvent: SyncEvent | null = null;
        await runSync(
          runId,
          currentBatch,
          settings.stealthModeEnabled,
          (event) => {
            if (
              event.type === "sync_complete" ||
              event.type === "sync_cancelled"
            ) {
              batchTerminalEvent = event;
              return;
            }
            broadcast(event);
          },
          currentRunAbortController.signal,
          getPlatformSignal,
          demoSyncIndex === undefined
            ? undefined
            : createDemoTimestampProvider(
                demoSyncIndex,
                currentBatch.map((platform) => platform.id),
              ),
          (platformId) =>
            currentForcedExtractionChoiceSignals.get(platformId) ?? [],
        );

        if (currentRunAbortController.signal.aborted) {
          const queuedIds = await withSyncQueueTransition(() => {
            acceptingSyncQueue = false;
            return drainSyncQueue();
          });
          if (queuedIds.length > 0) {
            await markQueuedPlatformsCancelled(
              runId,
              queuedIds,
              "Sync cancelled by user",
            );
          }
          finalSyncEvent = { type: "sync_cancelled", platformId: "", runId };
          break;
        }

        const queuedIds = await withSyncQueueTransition(() => {
          const next = drainSyncQueue();
          if (next.length === 0) {
            acceptingSyncQueue = false;
          }
          return next;
        });
        if (queuedIds.length === 0) {
          finalSyncEvent =
            batchTerminalEvent ?? { type: "sync_complete", platformId: "", runId };
          break;
        }

        currentBatch = queuedIds
          .map((platformId) => catalogById.get(platformId))
          .filter(
            (platform): platform is PlatformCatalogEntry =>
              platform !== undefined,
          );
        currentForcedExtractionChoiceSignals =
          await consumePendingForcedExtractionChoiceMap(
            currentBatch.map((platform) => platform.id),
          );

        if (currentBatch.length === 0) {
          await withSyncQueueTransition(() => {
            acceptingSyncQueue = false;
          });
          finalSyncEvent =
            batchTerminalEvent ?? { type: "sync_complete", platformId: "", runId };
          break;
        }
      }

      broadcast(
        finalSyncEvent ??
          (currentRunAbortController.signal.aborted
            ? { type: "sync_cancelled", platformId: "", runId }
            : { type: "sync_complete", platformId: "", runId }),
      );
      // runSync handles CancelledError internally and emits sync_cancelled
      // Check if it was cancelled to set the right DB state
      if (currentRunAbortController.signal.aborted) {
        await updateSyncRun(runId, {
          state: "cancelled",
          finishedAt: new Date().toISOString(),
          message: "Sync cancelled by user",
        });
      } else {
        await updateSyncRun(runId, {
          state: "completed",
          finishedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      const queuedIds = await withSyncQueueTransition(() => {
        acceptingSyncQueue = false;
        return drainSyncQueue();
      });
      const errMessage = getErrorMessage(err);
      if (queuedIds.length > 0) {
        await markQueuedPlatformsCancelled(
          runId,
          queuedIds,
          "Sync failed before queued platforms started",
        );
      }
      await updateSyncRun(runId, {
        state: "failed",
        finishedAt: new Date().toISOString(),
        message: errMessage,
      });
    } finally {
      try {
        clearCurrentRunControllers();
        await stopSyncRuntimeSupport();
        await resetSyncQueue();
        // Always broadcast latest metrics so UI can update and clear syncing state.
        await broadcastMetricsUpdate();
      } finally {
        try {
          await releaseSyncLease?.();
          await closeManagedOffscreenDocumentIfIdle();
        } finally {
          await setActiveSyncRunId(null);
          await completePendingAutoLock();
        }
      }
    }
  })();
  activeSyncTask = syncTask;
  void syncTask.catch((error: unknown) => {
    log.error("Detached sync task failed", {
      error: getErrorMessage(error),
    });
  }).finally(() => {
    if (activeSyncTask === syncTask) {
      activeSyncTask = null;
    }
  });
}

// ─── AI Proxy ─────────────────────────────────────────────────────────────────

async function handleProxyAiPrompt(
  message: ProxyAiPromptMessage,
  sendResponse: (response: unknown) => void,
): Promise<void> {
  const { systemPrompt, examples, input, options } = message.payload;
  const languageModel = getPromptApiLanguageModel();
  if (!languageModel) {
    sendResponse({ error: "LanguageModel not available in background script" });
    return;
  }

  let session: LanguageModelSession | undefined;
  try {
    session = await languageModel.create({
      ...PROMPT_API_TEXT_LANGUAGE_OPTIONS,
      initialPrompts: [{ role: "system", content: systemPrompt }, ...examples],
      temperature: 0.1,
      topK: 3,
    });

    let text: string;
    if (options?.responseConstraint) {
      try {
        text = await session.prompt(input, {
          responseConstraint: options.responseConstraint,
        });
      } catch {
        text = await session.prompt(input);
      }
    } else {
      text = await session.prompt(input);
    }

    sendResponse({ text });
  } catch (err) {
    sendResponse({ error: getErrorMessage(err) });
  } finally {
    session?.destroy();
  }
}
