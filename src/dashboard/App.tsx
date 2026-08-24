import { useEffect, useState, useCallback, useRef } from "react";
import { Eye, EyeOff, LogOut, Shield } from "lucide-react";
import type {
  StoredOverviewMetrics,
  StoredSyncRun,
  PlatformId,
  PlatformSyncState,
  SyncEvent,
  DebugPlatformSnapshot,
  GeminiStatus,
  GeminiDownloadProgress,
  ExtractionChoiceRequest,
  ManualActionRequest,
  CredentialStatusEntry,
  ExtractionChoiceSignalKey,
} from "../shared/types/index.js";
import { getPlatformCatalog } from "../shared/platforms/index.js";
import { getErrorMessage } from "../shared/error-utils.js";
import { installSessionActivityTracking } from "../shared/session-activity.js";
import { ThemeToggle } from "../shared/theme.js";
import { PlatformTable } from "./components/PlatformTable.js";
import { PortfolioHeader } from "./components/PortfolioHeader.js";
import { SettingsPanel } from "./components/SettingsPanel.js";
import { SyncProgressDetail } from "./components/SyncProgressDetail.js";
import { OnboardingModal } from "./components/OnboardingModal.js";
import { UnlockScreen } from "./components/UnlockScreen.js";
import { Analytics } from "./components/Analytics.js";
import { ExportPanel } from "./components/ExportPanel.js";
import { DebugPanel } from "./components/DebugPanel.js";
import { ExtractorTestPanel } from "./components/ExtractorTestPanel.js";
import { LoginExtractorTab } from "./components/LoginExtractorTab.js";
import { DashboardExtractorTab } from "./components/DashboardExtractorTab.js";
import { ExtractionChoiceModal } from "./components/ExtractionChoiceModal.js";
import { GeminiActivationBanner } from "./components/GeminiActivationBanner.js";
import { ManualActionModal } from "./components/ManualActionModal.js";
import { ModalShell } from "./components/ui/index.js";
import { sendBackground } from "../shared/messages.js";
import type { LockStatusResponse } from "../shared/messages.js";
import { BrandBanner } from "../shared/BrandBanner.js";
import { hydrateSyncUiState } from "../shared/sync-ui-state.js";
import { useDashboardStore } from "./store.js";
import { RUNTIME_NAMES } from "../shared/runtime-names.js";

function createDebugSnapshot(
  platformId: PlatformId,
  platformName: string,
  timestamp = new Date().toISOString(),
): DebugPlatformSnapshot {
  return {
    platformId,
    platformName,
    timestamp,
    signals: [],
    loginSuccess: false,
    logs: [],
  };
}

function getActiveConfiguredPlatformIds(
  configuredPlatformIds: PlatformId[],
  disabledPlatformIds: PlatformId[],
): PlatformId[] {
  const disabledSet = new Set(disabledPlatformIds);
  return configuredPlatformIds.filter((platformId) => !disabledSet.has(platformId));
}

function uniqueKnownPlatformIds(platformIds: PlatformId[]): PlatformId[] {
  const selected = new Set(platformIds);
  return getPlatformCatalog()
    .map((platform) => platform.id)
    .filter((platformId) => selected.has(platformId));
}

function getVisiblePlatformIds(
  credentialPlatformIds: PlatformId[],
  dataPlatformIds: PlatformId[],
  disabledPlatformIds: PlatformId[],
): PlatformId[] {
  return getActiveConfiguredPlatformIds(
    uniqueKnownPlatformIds([...credentialPlatformIds, ...dataPlatformIds]),
    disabledPlatformIds,
  );
}

function credentialModesByPlatform(
  credentials: CredentialStatusEntry[] | undefined,
): Partial<Record<PlatformId, CredentialStatusEntry>> {
  return Object.fromEntries(
    (credentials ?? []).map((entry) => [entry.platformId, entry]),
  ) as Partial<Record<PlatformId, CredentialStatusEntry>>;
}

function restorePersistedLoginErrors(
  credentials: CredentialStatusEntry[] | undefined,
): void {
  const store = useDashboardStore.getState();
  for (const credential of credentials ?? []) {
    const message = credential.lastLoginError?.trim();
    if (!message) continue;
    const currentState = store.syncStates[credential.platformId];
    if (currentState === "pending" || currentState === "running") continue;
    store.setSyncState(credential.platformId, "failed_login");
    store.setSyncError(credential.platformId, message);
  }
}

function isSafeModeActive(
  platformId: PlatformId,
  credentialModes: Partial<Record<PlatformId, CredentialStatusEntry>>,
): boolean {
  const platform = getPlatformCatalog().find((entry) => entry.id === platformId);
  return (
    credentialModes[platformId]?.safeModeEnabled ??
    platform?.login.safeMode ??
    false
  );
}

interface SafeModePrompt {
  platformId: PlatformId;
  platformName: string;
}

const FORCED_CORRECTION_SIGNALS: ExtractionChoiceSignalKey[] = [
  "portfolio_value",
  "free_cash",
];

function SafeModePromptModal({
  prompt,
  saving,
  onEnable,
  onDismiss,
}: {
  prompt: SafeModePrompt;
  saving: boolean;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  const titleId = "safe-mode-prompt-title";
  const descriptionId = "safe-mode-prompt-description";

  return (
    <ModalShell
      titleId={titleId}
      descriptionId={descriptionId}
      panelClassName="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning">
          <Shield className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            {prompt.platformName}
          </p>
          <h2 id={titleId} className="mt-1 text-lg font-semibold text-foreground">
            Enable Safe Mode?
          </h2>
          <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Scraping could not read reliable values. Safe Mode uses more
            careful navigation and inputs during the next sync.
          </p>
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          disabled={saving}
          className="inline-flex h-10 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onEnable}
          disabled={saving}
          className="inline-flex h-10 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
        >
          Enable Safe Mode
        </button>
      </div>
    </ModalShell>
  );
}

function hydrateSyncState(
  run: StoredSyncRun | undefined,
  queuedPlatformIds: PlatformId[] = [],
): void {
  const store = useDashboardStore.getState();
  const snapshot = hydrateSyncUiState(run, queuedPlatformIds);
  store.resetSyncStates();
  store.resetSyncSteps();
  store.resetQueue();

  if (!snapshot.isSyncing) {
    store.setIsSyncing(false);
    return;
  }

  store.setIsSyncing(true);
  store.setQueuedPlatformIds(snapshot.queuedPlatformIds);
  for (const [platformId, state] of Object.entries(snapshot.syncStates)) {
    if (state) {
      store.setSyncState(platformId as PlatformId, state);
    }
  }
  for (const [platformId, step] of Object.entries(snapshot.syncSteps)) {
    store.setSyncStep(platformId as PlatformId, step);
  }
}

interface SyncUiSnapshot {
  isSyncing: boolean;
  queuedPlatformIds: PlatformId[];
  syncStates: Partial<Record<PlatformId, PlatformSyncState>>;
  syncSteps: Partial<Record<PlatformId, string>>;
  syncErrors: Partial<Record<PlatformId, string>>;
}

function getSyncUiSnapshot(): SyncUiSnapshot {
  const { isSyncing, queuedPlatformIds, syncStates, syncSteps, syncErrors } =
    useDashboardStore.getState();
  return {
    isSyncing,
    queuedPlatformIds: [...queuedPlatformIds],
    syncStates: { ...syncStates },
    syncSteps: { ...syncSteps },
    syncErrors: { ...syncErrors },
  };
}

function restoreSyncUiSnapshot(snapshot: SyncUiSnapshot): void {
  useDashboardStore.setState({
    isSyncing: snapshot.isSyncing,
    queuedPlatformIds: [...snapshot.queuedPlatformIds],
    syncStates: { ...snapshot.syncStates },
    syncSteps: { ...snapshot.syncSteps },
    syncErrors: { ...snapshot.syncErrors },
  });
}

async function refreshSyncStatusAfterRejectedStart(
  fallback: SyncUiSnapshot,
): Promise<void> {
  try {
    const syncResponse = await sendBackground({ type: "GET_SYNC_STATUS" });
    hydrateSyncState(syncResponse.run, syncResponse.queuedPlatformIds ?? []);
  } catch {
    restoreSyncUiSnapshot(fallback);
  }
}

function shouldRestorePendingChoice(
  run: StoredSyncRun | undefined,
  pendingChoice: ExtractionChoiceRequest | undefined,
): pendingChoice is ExtractionChoiceRequest {
  return pendingChoice !== undefined && run?.state === "running";
}

function shouldRestorePendingManualAction(
  run: StoredSyncRun | undefined,
  pendingManualAction: ManualActionRequest | undefined,
): pendingManualAction is ManualActionRequest {
  return pendingManualAction !== undefined && run?.state === "running";
}

export function App() {
  const {
    lockStatus,
    setLockStatus,
    metrics,
    setMetrics,
    upsertMetric,
    configuredPlatformIds,
    credentialPlatformIds,
    setCredentialPlatformIds,
    dataPlatformIds,
    setDataPlatformIds,
    visiblePlatformIds,
    setVisiblePlatformIds,
    syncablePlatformIds,
    setSyncablePlatformIds,
    isSyncing,
    setIsSyncing,
    queuedPlatformIds,
    addQueuedPlatform,
    removeQueuedPlatform,
    setQueuedPlatformIds,
    resetQueue,
    privacyMode,
    togglePrivacyMode,
    view,
    setView,
    syncStates,
    syncSteps,
    syncErrors,
    setSyncState,
    setSyncStep,
    clearSyncStep,
    setSyncError,
    clearSyncError,
    resetSyncStates,
    resetSyncSteps,
    showOnboarding,
    setShowOnboarding,
    debugMode,
    setDebugMode,
    geminiStatus,
    setGeminiStatus,
    setGeminiDownloadProgress,
    setGeminiDownloadError,
    geminiBannerDismissed,
    setGeminiBannerDismissed,
    requestGeminiSettingsFocus,
    debugSnapshots,
    upsertDebugSnapshot,
    clearDebugSnapshots,
  } = useDashboardStore();

  const [choiceRequest, setChoiceRequest] =
    useState<ExtractionChoiceRequest | null>(null);
  const [manualActionRequest, setManualActionRequest] =
    useState<ManualActionRequest | null>(null);
  const [manualActionError, setManualActionError] = useState<string | null>(null);
  const choiceRequestRef = useRef<ExtractionChoiceRequest | null>(null);
  const manualActionRequestRef = useRef<ManualActionRequest | null>(null);
  const [credentialModes, setCredentialModes] = useState<
    Partial<Record<PlatformId, CredentialStatusEntry>>
  >({});
  const [disabledPlatformIds, setDisabledPlatformIds] = useState<PlatformId[]>(
    [],
  );
  const [safeModePrompt, setSafeModePrompt] = useState<SafeModePrompt | null>(
    null,
  );
  const [safeModePromptSaving, setSafeModePromptSaving] = useState(false);

  const enabledPlatforms = getPlatformCatalog().filter((p) => p.enabled);
  const configuredPlatforms = enabledPlatforms.filter((platform) =>
    visiblePlatformIds.includes(platform.id),
  );
  const syncablePlatforms = enabledPlatforms.filter((platform) =>
    syncablePlatformIds.includes(platform.id),
  );
  const visibleMetrics = metrics.filter((metric) =>
    visiblePlatformIds.includes(metric.platformId),
  );

  useEffect(() => {
    choiceRequestRef.current = choiceRequest;
  }, [choiceRequest]);

  useEffect(() => {
    manualActionRequestRef.current = manualActionRequest;
    // A new (or dismissed) request must not inherit the previous attempt's
    // error — that would also wrongly reveal the "continue anyway" override.
    setManualActionError(null);
  }, [manualActionRequest]);

  useEffect(() => {
    sendBackground({ type: "GET_LOCK_STATUS" }).then((response) => {
      setLockStatus(response);
    });
  }, [setLockStatus]);

  useEffect(() => {
    if (!lockStatus || lockStatus.locked) return;
    let cancelled = false;

    Promise.all([
      sendBackground({ type: "GET_METRICS" }),
      sendBackground({ type: "GET_CREDENTIAL_STATUS" }),
      sendBackground({ type: "GET_SETTINGS" }),
      sendBackground({ type: "GET_SYNC_STATUS" }),
      sendBackground({ type: "GET_GEMINI_STATUS" }),
    ]).then(([metricsResponse, credentialStatus, settingsResponse, syncResponse, geminiResponse]) => {
      if (cancelled || useDashboardStore.getState().lockStatus?.locked) return;
      const nextMetrics = metricsResponse.metrics ?? [];
      const nextCredentialPlatformIds = credentialStatus?.platformIds ?? [];
      const nextDataPlatformIds =
        metricsResponse.dataPlatformIds ??
        nextMetrics.map((metric) => metric.platformId);
      setMetrics(nextMetrics);
      setCredentialModes(credentialModesByPlatform(credentialStatus?.credentials));
      hydrateSyncState(syncResponse.run, syncResponse.queuedPlatformIds ?? []);
      restorePersistedLoginErrors(credentialStatus?.credentials);
      if (shouldRestorePendingChoice(syncResponse.run, syncResponse.pendingChoice)) {
        setChoiceRequest(syncResponse.pendingChoice);
        setSyncState(syncResponse.pendingChoice.platformId, "running");
        setSyncStep(
          syncResponse.pendingChoice.platformId,
          "Waiting for value selection...",
        );
      }
      if (
        shouldRestorePendingManualAction(
          syncResponse.run,
          syncResponse.pendingManualAction,
        )
      ) {
        setManualActionRequest(syncResponse.pendingManualAction);
        setSyncState(syncResponse.pendingManualAction.platformId, "running");
        setSyncStep(
          syncResponse.pendingManualAction.platformId,
          syncResponse.pendingManualAction.actionType === "2fa"
            ? "2FA code required..."
            : "Solve Captcha in tab...",
        );
      }
      setGeminiStatus(geminiResponse?.status ?? "unavailable");

      const settings = settingsResponse?.settings;
      const nextDisabledPlatformIds = settings?.disabledPlatformIds ?? [];
      setDisabledPlatformIds(nextDisabledPlatformIds);
      const nextVisiblePlatformIds = getVisiblePlatformIds(
        nextCredentialPlatformIds,
        nextDataPlatformIds,
        nextDisabledPlatformIds,
      );
      const nextSyncablePlatformIds = getActiveConfiguredPlatformIds(
        nextCredentialPlatformIds,
        nextDisabledPlatformIds,
      );
      setCredentialPlatformIds(nextCredentialPlatformIds);
      setDataPlatformIds(nextDataPlatformIds);
      setVisiblePlatformIds(nextVisiblePlatformIds);
      setSyncablePlatformIds(nextSyncablePlatformIds);

      if (settings) {
        const currentPrivacyMode = useDashboardStore.getState().privacyMode;
        if ((settings.privacyModeEnabled ?? false) !== currentPrivacyMode) {
          togglePrivacyMode();
        }
        setDebugMode(settings.debugModeEnabled ?? false);
        setGeminiBannerDismissed(settings.geminiActivationBannerDismissed ?? false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    lockStatus,
    setCredentialPlatformIds,
    setDataPlatformIds,
    setDebugMode,
    setGeminiBannerDismissed,
    setGeminiStatus,
    setMetrics,
    setSyncablePlatformIds,
    setSyncState,
    setSyncStep,
    setVisiblePlatformIds,
    togglePrivacyMode,
  ]);

  useEffect(() => {
    chrome.storage.local.get(RUNTIME_NAMES.onboardingComplete).then((result) => {
      if (!result[RUNTIME_NAMES.onboardingComplete]) {
        setShowOnboarding(true);
      }
    });
  }, [setShowOnboarding]);

  const maybeShowSafeModePrompt = useCallback(
    async (platformId: PlatformId, platformName: string) => {
      try {
        const credentialStatus = await sendBackground({
          type: "GET_CREDENTIAL_STATUS",
        });
        const nextCredentialModes = credentialModesByPlatform(
          credentialStatus?.credentials,
        );
        setCredentialModes(nextCredentialModes);

        if (isSafeModeActive(platformId, nextCredentialModes)) return;
        setSafeModePrompt({ platformId, platformName });
      } catch {
        if (isSafeModeActive(platformId, credentialModes)) return;
        setSafeModePrompt({ platformId, platformName });
      }
    },
    [credentialModes],
  );

  const applyMetricsUpdate = useCallback(
    (
      nextMetrics: StoredOverviewMetrics[],
      nextDataPlatformIds?: PlatformId[],
    ) => {
      const resolvedDataPlatformIds =
        nextDataPlatformIds ?? nextMetrics.map((metric) => metric.platformId);
      const nextVisiblePlatformIds = getVisiblePlatformIds(
        credentialPlatformIds,
        resolvedDataPlatformIds,
        disabledPlatformIds,
      );
      const nextSyncablePlatformIds = getActiveConfiguredPlatformIds(
        credentialPlatformIds,
        disabledPlatformIds,
      );

      setMetrics(nextMetrics);
      setDataPlatformIds(resolvedDataPlatformIds);
      setVisiblePlatformIds(nextVisiblePlatformIds);
      setSyncablePlatformIds(nextSyncablePlatformIds);
    },
    [
      credentialPlatformIds,
      disabledPlatformIds,
      setDataPlatformIds,
      setMetrics,
      setSyncablePlatformIds,
      setVisiblePlatformIds,
    ],
  );

  useEffect(() => {
    function handleMessage(message: { type: string; payload: unknown }) {
      if (message.type === "SYNC_PROGRESS") {
        const event = message.payload as SyncEvent;
        const eventType = event.type as string;
        const platformId = event.platformId;
        const hasPlatformId = platformId !== "";
        const platformName =
          platformId === ""
            ? ""
            : (getPlatformCatalog().find(
                (platform) => platform.id === platformId,
              )?.name ?? platformId);

        const { debugMode: currentDebugMode } = useDashboardStore.getState();
        const shouldTrackDebug =
          event.type !== "sync_complete" &&
          hasPlatformId &&
          (currentDebugMode ||
            (event.debug !== undefined && event.debug.length > 0) ||
            (event.debugLogs !== undefined && event.debugLogs.length > 0) ||
            event.rawLoginHtml !== undefined ||
            event.rawHtml !== undefined);

        if (event.type === "platform_queued" && hasPlatformId) {
          addQueuedPlatform(platformId);
          const queuePosition =
            event.queuePosition ??
            useDashboardStore.getState().queuedPlatformIds.indexOf(platformId) + 1;
          setSyncState(platformId, "pending");
          setSyncStep(
            platformId,
            queuePosition > 0 ? `In Queue #${queuePosition}` : "In Queue",
          );
        } else if (event.type === "extraction_choice_required" && hasPlatformId) {
          setSyncState(platformId, "running");
          setSyncStep(platformId, "Waiting for value selection...");
          if (
            event.requestId &&
            event.signalKey &&
            event.candidates &&
            event.expiresAt
          ) {
            setChoiceRequest({
              requestId: event.requestId,
              runId: event.runId,
              platformId,
              platformName,
              signalKey: event.signalKey,
              candidates: event.candidates,
              expiresAt: event.expiresAt,
            });
          }
        } else if (event.type === "manual_action_required" && hasPlatformId) {
          setSyncState(platformId, "running");
          setSyncStep(platformId, event.actionType === "2fa" ? "2FA code required..." : "Solve Captcha in tab...");
          if (
            event.requestId &&
            event.actionType &&
            event.expiresAt
          ) {
            setManualActionRequest({
              requestId: event.requestId,
              runId: event.runId,
              platformId,
              platformName,
              actionType: event.actionType,
              expiresAt: event.expiresAt,
              ...(event.message === undefined ? {} : { message: event.message }),
            });
          }
        } else if (
          (event.type === "platform_start" ||
            event.type === "platform_progress") &&
          hasPlatformId
        ) {
          if (event.type === "platform_start") {
            removeQueuedPlatform(platformId);
            clearSyncError(platformId);
          }
          setSyncState(platformId, "running");
          if (event.type === "platform_start") {
            setSyncStep(platformId, "Starting sync...");
          } else {
            setSyncStep(
              platformId,
              event.message?.trim() || "In progress...",
            );
          }
        } else if (event.type === "platform_done" && hasPlatformId) {
          removeQueuedPlatform(platformId);
          if (event.result?.overviewMetrics) {
            upsertMetric({
              ...event.result.overviewMetrics,
              platformId,
              fetchedAt: event.result.fetchedAt,
            });
          }
          setSyncState(platformId, "success");
          clearSyncStep(platformId);
          clearSyncError(platformId);
          setChoiceRequest((current) =>
            current?.platformId === platformId ? null : current,
          );
          setManualActionRequest((current) =>
            current?.platformId === platformId ? null : current,
          );
        } else if (event.type === "platform_error" && hasPlatformId) {
          removeQueuedPlatform(platformId);
          const state: PlatformSyncState = event.state ?? "failed_login";
          setSyncState(platformId, state);
          clearSyncStep(platformId);
          if (event.message) {
            setSyncError(platformId, event.message);
          }
          if (state === "failed_extract") {
            void maybeShowSafeModePrompt(platformId, platformName);
          }
          setChoiceRequest((current) =>
            current?.platformId === platformId ? null : current,
          );
          setManualActionRequest((current) =>
            current?.platformId === platformId ? null : current,
          );
        } else if (event.type === "platform_cancelled" && hasPlatformId) {
          removeQueuedPlatform(platformId);
          setSyncState(platformId, "cancelled");
          clearSyncStep(platformId);
          clearSyncError(platformId);
          setChoiceRequest((current) =>
            current?.platformId === platformId ? null : current,
          );
          setManualActionRequest((current) =>
            current?.platformId === platformId ? null : current,
          );
        } else if (
          event.type === "sync_complete" ||
          event.type === "sync_cancelled" ||
          eventType === "sync_failed"
        ) {
          setIsSyncing(false);
          resetQueue();
          resetSyncSteps();
          setChoiceRequest(null);
          setManualActionRequest(null);
        }

        if (shouldTrackDebug && hasPlatformId) {
          if (event.type === "platform_start") {
            upsertDebugSnapshot(createDebugSnapshot(platformId, platformName));
          } else if (
            event.type === "platform_progress" &&
            event.debugLogs &&
            event.debugLogs.length > 0
          ) {
            const progressLogs = event.debugLogs;
            const { debugSnapshots: currentSnapshots } =
              useDashboardStore.getState();
            const existing =
              currentSnapshots.find(
                (snapshot) => snapshot.platformId === platformId,
              ) ??
              createDebugSnapshot(
                platformId,
                platformName,
                progressLogs[0]?.timestamp ?? new Date().toISOString(),
              );
            const latestTimestamp =
              progressLogs[progressLogs.length - 1]?.timestamp ??
              new Date().toISOString();

            upsertDebugSnapshot({
              ...existing,
              platformName,
              timestamp: latestTimestamp,
              logs: [...existing.logs, ...progressLogs],
            });
          } else if (
            event.type === "platform_done" ||
            event.type === "platform_error" ||
            event.type === "platform_cancelled"
          ) {
            const { debugSnapshots: currentSnapshots } =
              useDashboardStore.getState();
            const existing =
              currentSnapshots.find(
                (snapshot) => snapshot.platformId === platformId,
              ) ?? createDebugSnapshot(platformId, platformName);

            const nextSnapshot: DebugPlatformSnapshot = {
              ...existing,
              platformName,
              timestamp: new Date().toISOString(),
              signals: event.debug ?? existing.signals,
              loginSuccess: event.type === "platform_done",
              ...(event.rawLoginHtml !== undefined
                ? { rawLoginHtml: event.rawLoginHtml }
                : {}),
              ...(event.rawHtml !== undefined
                ? { rawHtml: event.rawHtml }
                : {}),
            };

            if (event.type === "platform_cancelled") {
              const snapshotCancelled = { ...nextSnapshot, cancelled: true };
              delete (snapshotCancelled as any).error;
              upsertDebugSnapshot(snapshotCancelled as DebugPlatformSnapshot);
            } else if (event.type === "platform_error" && event.message) {
              upsertDebugSnapshot({ ...nextSnapshot, error: event.message });
            } else {
              const snapshotWithoutError = { ...nextSnapshot };
              delete (snapshotWithoutError as any).error;
              delete (snapshotWithoutError as any).cancelled;
              upsertDebugSnapshot(snapshotWithoutError as DebugPlatformSnapshot);
            }
          }
        }
      }
      if (message.type === "METRICS_UPDATED") {
        const payload = message.payload as
          | StoredOverviewMetrics[]
          | { metrics?: StoredOverviewMetrics[]; dataPlatformIds?: PlatformId[] }
          | undefined;
        const nextMetrics = Array.isArray(payload)
          ? payload
          : (payload?.metrics ?? []);
        const nextDataPlatformIds = Array.isArray(payload)
          ? undefined
          : payload?.dataPlatformIds;
        applyMetricsUpdate(nextMetrics, nextDataPlatformIds);
        setIsSyncing(false);
        resetQueue();
        resetSyncSteps();
      }
      if (message.type === "LOCK_STATUS_CHANGED") {
        const payload = message.payload as LockStatusResponse | undefined;
        if (payload) setLockStatus(payload);
      }
      if (message.type === "GEMINI_STATUS_CHANGED") {
        const payload = message.payload as { status?: GeminiStatus } | undefined;
        if (payload?.status) {
          setGeminiStatus(payload.status);
        }
      }
      if (message.type === "GEMINI_DOWNLOAD_PROGRESS") {
        const payload = message.payload as GeminiDownloadProgress | undefined;
        if (payload) {
          setGeminiDownloadProgress(payload);
        }
      }
      if (message.type === "GEMINI_DOWNLOAD_FAILED") {
        const payload = message.payload as { error?: string } | undefined;
        setGeminiDownloadError(payload?.error ?? "Download failed");
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [
    addQueuedPlatform,
    clearSyncError,
    clearSyncStep,
    applyMetricsUpdate,
    maybeShowSafeModePrompt,
    removeQueuedPlatform,
    resetQueue,
    resetSyncSteps,
    setGeminiDownloadError,
    setGeminiDownloadProgress,
    setGeminiStatus,
    setIsSyncing,
    setLockStatus,
    upsertMetric,
    setSyncState,
    setSyncError,
    setSyncStep,
    upsertDebugSnapshot,
  ]);

  useEffect(() => {
    if (!lockStatus?.hasMasterPassword || lockStatus.locked) return undefined;
    return installSessionActivityTracking(() => {
      void sendBackground({ type: "SESSION_ACTIVITY" }).catch(() => {});
    });
  }, [lockStatus?.hasMasterPassword, lockStatus?.locked]);

  async function handleOnboardingComplete(): Promise<void> {
    setShowOnboarding(false);
    try {
      setLockStatus(await sendBackground({ type: "GET_LOCK_STATUS" }));
    } catch {
      // The next dashboard load will recover the authoritative lock state.
    }
  }

  function handleSyncAll() {
    const currentState = useDashboardStore.getState();
    const syncSnapshot = getSyncUiSnapshot();
    const wasSyncing = currentState.isSyncing;
    const busyPlatformIds = new Set<PlatformId>(currentState.queuedPlatformIds);
    for (const [platformId, state] of Object.entries(currentState.syncStates)) {
      if (state === "pending" || state === "running") {
        busyPlatformIds.add(platformId as PlatformId);
      }
    }

    if (!wasSyncing) {
      resetSyncStates();
      clearDebugSnapshots();
      resetSyncSteps();
      resetQueue();
    }

    for (const platform of syncablePlatforms) {
      if (!wasSyncing || !busyPlatformIds.has(platform.id)) {
        setSyncState(platform.id, "pending");
        if (wasSyncing) {
          setSyncStep(platform.id, "Queued");
        }
      }
    }
    setIsSyncing(true);
    sendBackground({
      type: "START_SYNC",
      payload: { platformIds: syncablePlatformIds },
    }).then((response) => {
      if (response?.error) {
        restoreSyncUiSnapshot(syncSnapshot);
        if (wasSyncing) {
          void refreshSyncStatusAfterRejectedStart(syncSnapshot);
        }
        return;
      }
      if (response?.queuedPlatformIds) {
        setQueuedPlatformIds(response.queuedPlatformIds);
      }
    });
  }

  function handleSyncPlatform(platformId: PlatformId) {
    if (!syncablePlatformIds.includes(platformId)) return;
    const syncSnapshot = getSyncUiSnapshot();
    const wasSyncing = syncSnapshot.isSyncing;
    setSyncState(platformId, "pending");
    if (wasSyncing) {
      setSyncStep(platformId, "Queued");
    } else {
      clearSyncStep(platformId);
    }
    setIsSyncing(true);
    sendBackground({
      type: "START_SYNC",
      payload: { platformIds: [platformId] },
    }).then((response) => {
      if (response?.error) {
        restoreSyncUiSnapshot(syncSnapshot);
        if (wasSyncing) {
          void refreshSyncStatusAfterRejectedStart(syncSnapshot);
        }
        return;
      }
      if (response?.queuedPlatformIds) {
        setQueuedPlatformIds(response.queuedPlatformIds);
      }
    });
  }

  async function handleReportWrongImport({
    platformId,
    batchId,
  }: {
    platformId: PlatformId;
    batchId: number;
  }): Promise<void> {
    if (!syncablePlatformIds.includes(platformId)) {
      throw new Error("Cannot resync imported-only platform");
    }

    const syncSnapshot = getSyncUiSnapshot();
    const wasSyncing = syncSnapshot.isSyncing;
    setSyncState(platformId, "pending");
    if (wasSyncing) {
      setSyncStep(platformId, "Queued");
    } else {
      clearSyncStep(platformId);
    }
    setIsSyncing(true);

    const revertResponse = await sendBackground({
      type: "REVERT_PLATFORM_BATCH",
      payload: { platformId, batchId },
    });
    if (!revertResponse.success) {
      restoreSyncUiSnapshot(syncSnapshot);
      throw new Error(revertResponse.error ?? "Could not revert import");
    }

    const resetSelectorsResponse = await sendBackground({
      type: "RESET_PLATFORM_SELECTORS",
      payload: { platformId },
    });
    if (!resetSelectorsResponse.success) {
      restoreSyncUiSnapshot(syncSnapshot);
      throw new Error(
        resetSelectorsResponse.error ?? "Could not reset platform selectors",
      );
    }

    setSyncState(platformId, "pending");
    if (wasSyncing) {
      setSyncStep(platformId, "Queued");
    } else {
      clearSyncStep(platformId);
    }
    setIsSyncing(true);

    const syncResponse = await sendBackground({
      type: "START_SYNC",
      payload: {
        platformIds: [platformId],
        forceExtractionChoiceForSignals: FORCED_CORRECTION_SIGNALS,
      },
    });
    if (syncResponse?.error) {
      restoreSyncUiSnapshot(syncSnapshot);
      if (wasSyncing) {
        void refreshSyncStatusAfterRejectedStart(syncSnapshot);
      }
      throw new Error(syncResponse.error);
    }
    if (syncResponse?.queuedPlatformIds) {
      setQueuedPlatformIds(syncResponse.queuedPlatformIds);
    }
  }

  function handleCancelAll() {
    const { syncStates: currentSyncStates } = useDashboardStore.getState();
    console.warn("[P2P] dashboard: Cancel all requested", {
      syncStates: currentSyncStates,
      syncablePlatformIds,
    });

    for (const [platformId, state] of Object.entries(currentSyncStates)) {
      if (state === "pending" || state === "running") {
        setSyncState(platformId as PlatformId, "cancelled");
      }
    }
    setIsSyncing(false);
    resetQueue();
    resetSyncSteps();
    setChoiceRequest(null);
    setManualActionRequest(null);

    sendBackground({ type: "CANCEL_SYNC_ALL" })
      .then((response) => {
        console.warn("[P2P] dashboard: Cancel all response", response);
        if (!response?.success) {
          return null;
        }
        return sendBackground({ type: "GET_SYNC_STATUS" });
      })
      .then((syncResponse) => {
        if (!syncResponse) return;
        console.warn("[P2P] dashboard: Sync status after cancel all", syncResponse);
        hydrateSyncState(syncResponse.run, syncResponse.queuedPlatformIds ?? []);
        if (shouldRestorePendingChoice(syncResponse.run, syncResponse.pendingChoice)) {
          setChoiceRequest(syncResponse.pendingChoice);
          setSyncState(syncResponse.pendingChoice.platformId, "running");
          setSyncStep(
            syncResponse.pendingChoice.platformId,
            "Waiting for value selection...",
          );
        }
        if (
          shouldRestorePendingManualAction(
            syncResponse.run,
            syncResponse.pendingManualAction,
          )
        ) {
          setManualActionRequest(syncResponse.pendingManualAction);
          setSyncState(syncResponse.pendingManualAction.platformId, "running");
          setSyncStep(
            syncResponse.pendingManualAction.platformId,
            syncResponse.pendingManualAction.actionType === "2fa"
              ? "2FA code required..."
              : "Solve Captcha in tab...",
          );
        }
      })
      .catch((error: unknown) => {
        console.warn("[P2P] dashboard: Cancel all failed", {
          error: getErrorMessage(error),
        });
      });
  }

  function handleCancelPlatform(platformId: PlatformId) {
    setSyncState(platformId, "cancelled");
    clearSyncStep(platformId);
    removeQueuedPlatform(platformId);
    setChoiceRequest((current) =>
      current?.platformId === platformId ? null : current,
    );
    setManualActionRequest((current) =>
      current?.platformId === platformId ? null : current,
    );
    sendBackground({ type: "CANCEL_SYNC_PLATFORM", payload: { platformId } })
      .catch((error: unknown) => {
        console.warn("[P2P] dashboard: Cancel platform failed", {
          platformId,
          error: getErrorMessage(error),
        });
      });
  }

  function handlePrivacyToggle() {
    const next = togglePrivacyMode();
    sendBackground({
      type: "SAVE_SETTINGS",
      payload: { privacyModeEnabled: next },
    });
  }

  function handleDismissGeminiBanner() {
    setGeminiBannerDismissed(true);
    sendBackground({
      type: "SAVE_SETTINGS",
      payload: { geminiActivationBannerDismissed: true },
    });
  }

  function handleOpenGeminiSettings() {
    requestGeminiSettingsFocus();
    setView("settings");
  }

  const handleConfiguredPlatformsChange = useCallback((
    platformIds: PlatformId[],
    nextDisabledPlatformIds: PlatformId[],
  ) => {
    const nextCredentialPlatformIds = uniqueKnownPlatformIds(platformIds);
    setCredentialPlatformIds(nextCredentialPlatformIds);
    setDisabledPlatformIds(nextDisabledPlatformIds);
    const nextVisiblePlatformIds = getVisiblePlatformIds(
      nextCredentialPlatformIds,
      dataPlatformIds,
      nextDisabledPlatformIds,
    );
    const nextSyncablePlatformIds = getActiveConfiguredPlatformIds(
      nextCredentialPlatformIds,
      nextDisabledPlatformIds,
    );
    setVisiblePlatformIds(nextVisiblePlatformIds);
    setSyncablePlatformIds(nextSyncablePlatformIds);
  }, [
    dataPlatformIds,
    setCredentialPlatformIds,
    setSyncablePlatformIds,
    setVisiblePlatformIds,
  ]);

  function handleEditCredentials(_platformId: PlatformId) {
    setView("settings");
  }

  function handleRestoreComplete(
    nextMetrics: StoredOverviewMetrics[],
    nextDataPlatformIds: PlatformId[],
  ) {
    applyMetricsUpdate(nextMetrics, nextDataPlatformIds);
  }

  function handleMetricsUpdated() {
    sendBackground({ type: "GET_METRICS" }).then((response) => {
      applyMetricsUpdate(response.metrics ?? [], response.dataPlatformIds);
    });
  }

  async function handleCleanupStaleSyncs() {
    await sendBackground({ type: "CLEANUP_STALE_SYNCS" });
  }

  function handleLock() {
    sendBackground({ type: "LOCK" });
    setLockStatus({ locked: true, hasMasterPassword: true });
  }

  function handleExtractionChoice(candidateId: string) {
    const requestId = choiceRequestRef.current?.requestId;
    if (!requestId) return;
    sendBackground({
      type: "RESOLVE_EXTRACTION_CHOICE",
      payload: { requestId, candidateId },
    }).then((response) => {
      if (!response?.error) {
        setChoiceRequest(null);
      }
    });
  }

  function handleResolveManualAction(code?: string, force = false) {
    const request = manualActionRequestRef.current;
    const requestId = request?.requestId;
    const actionType = request?.actionType;
    if (!requestId || !actionType) return;
    setManualActionError(null);
    sendBackground({
      type: "RESOLVE_MANUAL_ACTION",
      payload: {
        requestId,
        actionType,
        ...(code === undefined ? {} : { code }),
        ...(force ? { force: true } : {}),
      },
    }).then((response) => {
      if (response?.success) {
        setManualActionRequest(null);
        setManualActionError(null);
        return;
      }
      // The waiting run is gone for good — keeping the modal up would strand
      // the user on a prompt nothing is listening to.
      if (response?.gone) {
        setManualActionRequest(null);
        setManualActionError(null);
        if (request.platformId) {
          setSyncError(
            request.platformId,
            response.error ??
              "The security check is no longer active. Please start the sync again.",
          );
        }
        return;
      }
      setManualActionError(response?.error ?? "The confirmation failed.");
    });
  }

  function handleForceContinueManualAction() {
    handleResolveManualAction(undefined, true);
  }

  function handleCancelExtractionChoice() {
    const platformId = choiceRequestRef.current?.platformId;
    if (platformId) {
      handleCancelPlatform(platformId);
      return;
    }
    setChoiceRequest(null);
  }

  function handleCancelManualAction() {
    const platformId = manualActionRequestRef.current?.platformId;
    if (platformId) {
      handleCancelPlatform(platformId);
    }
    setManualActionRequest(null);
    setManualActionError(null);
  }

  function handleDismissSafeModePrompt() {
    setSafeModePrompt(null);
  }

  function handleEnableSafeModeFromPrompt() {
    const prompt = safeModePrompt;
    if (!prompt) return;

    setSafeModePromptSaving(true);
    sendBackground({
      type: "UPDATE_PLATFORM_MODES",
      payload: {
        platformId: prompt.platformId,
        config: { safeModeEnabled: true },
      },
    })
      .then((response) => {
        if (response?.success) {
          setCredentialModes((current) => ({
            ...current,
            [prompt.platformId]: {
              ...current[prompt.platformId],
              platformId: prompt.platformId,
              safeModeEnabled: true,
            },
          }));
          setSafeModePrompt(null);
        }
      })
      .finally(() => setSafeModePromptSaving(false));
  }

  // Loading state
  if (lockStatus === null) {
    return <div className="min-h-screen bg-background" />;
  }

  // Locked — show unlock screen
  if (lockStatus.locked) {
    return (
      <UnlockScreen
        onUnlocked={() =>
          setLockStatus({ locked: false, hasMasterPassword: true })
        }
      />
    );
  }

  const totalValue = visibleMetrics.reduce(
    (sum, m) => sum + m.platformValue,
    0,
  );
  const totalCash = visibleMetrics.reduce((sum, m) => sum + m.freeCash, 0);
  const avgReturnMetrics = visibleMetrics.filter(
    (m) => m.netAnnualReturnPct !== undefined,
  );
  const avgReturn =
    avgReturnMetrics.length > 0
      ? avgReturnMetrics.reduce(
          (sum, m) => sum + (m.netAnnualReturnPct ?? 0),
          0,
        ) / avgReturnMetrics.length
      : null;
  const showGeminiBanner =
    view === "overview" &&
    !geminiBannerDismissed &&
    geminiStatus !== null &&
    geminiStatus !== "available";

  return (
    <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
      {showOnboarding && (
        <OnboardingModal onComplete={() => void handleOnboardingComplete()} />
      )}
      {choiceRequest && (
        <ExtractionChoiceModal
          request={choiceRequest}
          onChoose={handleExtractionChoice}
          onCancel={handleCancelExtractionChoice}
        />
      )}
      {manualActionRequest && (
        <ManualActionModal
          request={manualActionRequest}
          onSubmit={handleResolveManualAction}
          onCancel={handleCancelManualAction}
          error={manualActionError ?? undefined}
          onForceContinue={handleForceContinueManualAction}
        />
      )}
      {safeModePrompt && (
        <SafeModePromptModal
          prompt={safeModePrompt}
          saving={safeModePromptSaving}
          onEnable={handleEnableSafeModeFromPrompt}
          onDismiss={handleDismissSafeModePrompt}
        />
      )}

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 px-4 shadow-sm backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 py-2">
          {/* Brand */}
          <BrandBanner className="flex-1" imageClassName="h-10 w-auto sm:h-12" />

          {/* Nav tabs */}
          <nav className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-6 overflow-x-auto px-4 sm:order-none sm:mx-0 sm:w-auto sm:px-0">
            <button
              type="button"
              onClick={() => setView("overview")}
              className={[
                "dashboard-menu-item border-b-2 px-2 py-5 text-sm font-semibold",
                view === "overview"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary",
              ].join(" ")}
            >
              Portfolio
            </button>
            <button
              type="button"
              onClick={() => setView("analytics")}
              className={[
                "dashboard-menu-item border-b-2 px-2 py-5 text-sm font-semibold",
                view === "analytics"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary",
              ].join(" ")}
            >
              Analytics
            </button>
            <button
              type="button"
              onClick={() => setView("export")}
              className={[
                "dashboard-menu-item border-b-2 px-2 py-5 text-sm font-semibold",
                view === "export"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary",
              ].join(" ")}
            >
              Export
            </button>
            <button
              type="button"
              onClick={() => setView("settings")}
              className={[
                "dashboard-menu-item border-b-2 px-2 py-5 text-sm font-semibold",
                view === "settings"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-primary",
              ].join(" ")}
            >
              Settings
            </button>
            {debugMode && (
              <>
                <button
                  type="button"
                  onClick={() => setView("debug")}
                  className={[
                    "dashboard-menu-item border-b-2 px-2 py-5 text-sm font-semibold",
                    view === "debug"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-primary",
                  ].join(" ")}
                >
                  Debug
                </button>
                <button
                  type="button"
                  onClick={() => setView("ai-test-lab")}
                  className={[
                    "dashboard-menu-item border-b-2 px-2 py-5 text-sm font-semibold",
                    view === "ai-test-lab"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-primary",
                  ].join(" ")}
                >
                  AI Test Lab
                </button>
                <button
                  type="button"
                  onClick={() => setView("login-extractor")}
                  className={[
                    "dashboard-menu-item border-b-2 px-2 py-5 text-sm font-semibold",
                    view === "login-extractor"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-primary",
                  ].join(" ")}
                >
                  Login Extractor
                </button>
                <button
                  type="button"
                  onClick={() => setView("dashboard-extractor")}
                  className={[
                    "dashboard-menu-item border-b-2 px-2 py-5 text-sm font-semibold",
                    view === "dashboard-extractor"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-primary",
                  ].join(" ")}
                >
                  Dashboard Extractor
                </button>
              </>
            )}
          </nav>

          {/* Right controls */}
          <div className="ml-auto flex items-center justify-end gap-2">
            <button
              type="button"
              aria-label="Toggle privacy mode"
              title="Toggle privacy mode"
              aria-pressed={privacyMode}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
              onClick={handlePrivacyToggle}
            >
              {privacyMode ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
            <ThemeToggle />
            {lockStatus?.hasMasterPassword && (
              <button
                type="button"
                aria-label="Lock"
                title="Lock"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                onClick={handleLock}
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-auto px-4 py-10 md:px-6">
          <div className="mx-auto max-w-7xl">
            {view === "overview" ? (
              <>
                {showGeminiBanner && (
                  <GeminiActivationBanner
                    onOpenSettings={handleOpenGeminiSettings}
                    onDismiss={handleDismissGeminiBanner}
                  />
                )}
                <PortfolioHeader
                  totalValue={totalValue}
                  totalCash={totalCash}
                  avgReturn={avgReturn}
                  privacyMode={privacyMode}
                  isSyncing={isSyncing}
                  hasConfiguredPlatforms={configuredPlatforms.length > 0}
                />
                <div
                  className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
                    isSyncing ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    {isSyncing && (
                      <div className="mt-4 flex items-start gap-3">
                        <div className="flex-1">
                          <SyncProgressDetail
                            platforms={syncablePlatforms}
                            syncStates={syncStates}
                            queuedPlatformIds={queuedPlatformIds}
                            onCancelPlatform={handleCancelPlatform}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleCancelAll}
                          className="mt-2 text-xs text-muted-foreground hover:text-destructive transition-colors"
                        >
                          Cancel all
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4">
                  <PlatformTable
                    platforms={configuredPlatforms}
                    metrics={visibleMetrics}
                    syncStates={syncStates}
                    syncSteps={syncSteps}
                    syncErrors={syncErrors}
                    queuedPlatformIds={queuedPlatformIds}
                    privacyMode={privacyMode}
                    isSyncing={isSyncing}
                    syncablePlatformIds={syncablePlatformIds}
                    onSyncAll={handleSyncAll}
                    onAddPlatform={() => setView("settings")}
                    onSyncPlatform={handleSyncPlatform}
                    onReportWrongImport={handleReportWrongImport}
                    onEditCredentials={handleEditCredentials}
                  />
                </div>
              </>
            ) : view === "analytics" ? (
              <Analytics
                metrics={visibleMetrics}
                privacyMode={privacyMode}
                visiblePlatformIds={visiblePlatformIds}
              />
            ) : view === "export" ? (
              <ExportPanel
                onRestoreComplete={handleRestoreComplete}
                visiblePlatformIds={visiblePlatformIds}
              />
            ) : view === "debug" ? (
              <DebugPanel
                snapshots={debugSnapshots}
                onSyncAll={handleSyncAll}
                onSyncPlatform={handleSyncPlatform}
                isSyncing={isSyncing}
                syncStates={syncStates}
                queuedPlatformIds={queuedPlatformIds}
                hasConfiguredPlatforms={configuredPlatforms.length > 0}
                metrics={visibleMetrics}
                configuredPlatformIds={configuredPlatformIds}
                onMetricsUpdated={handleMetricsUpdated}
                onCleanupStaleSyncs={handleCleanupStaleSyncs}
              />
            ) : view === "ai-test-lab" ? (
              <ExtractorTestPanel />
            ) : view === "login-extractor" ? (
              <LoginExtractorTab />
            ) : view === "dashboard-extractor" ? (
              <DashboardExtractorTab />
            ) : (
              <SettingsPanel
                onConfiguredPlatformsChange={handleConfiguredPlatformsChange}
                onDebugModeChange={setDebugMode}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
