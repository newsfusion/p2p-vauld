import { useEffect, useState } from 'react';
import {
  RefreshCw,
  ExternalLink,
  Lock,
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
  Ban,
  Clock,
  ChevronDown,
} from 'lucide-react';
import { ThemeToggle } from '../shared/theme.js';
import { PRODUCTION_CONFIDENCE_THRESHOLD } from '../shared/scoring.js';
import type {
  PlatformId,
  PlatformSyncState,
  StoredOverviewMetrics,
  StoredSyncRun,
  SyncEvent,
} from '../shared/types/index.js';
import { sendBackground } from '../shared/messages.js';
import type { LockStatusResponse } from '../shared/messages.js';
import { listEnabledPlatforms } from '../shared/platforms/index.js';
import { BrandBanner } from '../shared/BrandBanner.js';
import { UnlockForm } from '../shared/components/UnlockForm.js';
import { formatEur } from '../shared/formatters.js';
import { hydrateSyncUiState } from '../shared/sync-ui-state.js';
import { installSessionActivityTracking } from '../shared/session-activity.js';

export function App() {
  const [lockStatus, setLockStatus] = useState<LockStatusResponse | null>(null);
  const [metrics, setMetrics] = useState<StoredOverviewMetrics[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStates, setSyncStates] = useState<Partial<Record<PlatformId, PlatformSyncState>>>({});
  const [queuedPlatformIds, setQueuedPlatformIds] = useState<PlatformId[]>([]);
  const [showMore, setShowMore] = useState(false);
  const [showLowConfidenceMetrics, setShowLowConfidenceMetrics] = useState(false);
  const [disabledPlatformIds, setDisabledPlatformIds] = useState<PlatformId[]>([]);

  const enabledPlatforms = listEnabledPlatforms();

  useEffect(() => {
    sendBackground({ type: 'GET_LOCK_STATUS' }).then(
      (response) => {
        setLockStatus(response);
      }
    );
  }, []);

  function hydrateSyncState(
    run: StoredSyncRun | undefined,
    nextQueuedPlatformIds: PlatformId[] = [],
  ): void {
    const snapshot = hydrateSyncUiState(run, nextQueuedPlatformIds);
    setIsSyncing(snapshot.isSyncing);
    setQueuedPlatformIds(snapshot.queuedPlatformIds);
    setSyncStates(snapshot.syncStates);
  }

  useEffect(() => {
    if (!lockStatus || lockStatus.locked) return;
    let cancelled = false;
    Promise.all([
      sendBackground({ type: 'GET_METRICS' }),
      sendBackground({ type: 'GET_SYNC_STATUS' }),
      sendBackground({ type: 'GET_SETTINGS' }),
    ]).then(([metricsResponse, syncResponse, settingsResponse]) => {
      if (cancelled) return;
      setMetrics(metricsResponse.metrics ?? []);
      setShowLowConfidenceMetrics(settingsResponse.settings?.showLowConfidenceMetricsInPopup ?? true);
      setDisabledPlatformIds(settingsResponse.settings?.disabledPlatformIds ?? []);
      hydrateSyncState(syncResponse.run, syncResponse.queuedPlatformIds ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [lockStatus]);

  useEffect(() => {
    function handleMessage(message: { type: string; payload: unknown }) {
      if (message.type === 'SYNC_PROGRESS') {
        const event = message.payload as SyncEvent;
        const platformId = event.platformId === "" ? null : event.platformId;
        if (event.type === 'platform_queued' && platformId) {
          setQueuedPlatformIds((prev) =>
            prev.includes(platformId) ? prev : [...prev, platformId],
          );
          setSyncStates((prev) => ({ ...prev, [platformId]: 'pending' }));
        } else if ((event.type === 'platform_start' || event.type === 'platform_progress') && platformId) {
          setQueuedPlatformIds((prev) => prev.filter((id) => id !== platformId));
          setSyncStates((prev) => ({ ...prev, [platformId]: 'running' }));
        } else if (event.type === 'platform_done' && platformId) {
          setQueuedPlatformIds((prev) => prev.filter((id) => id !== platformId));
          setSyncStates((prev) => ({ ...prev, [platformId]: 'success' }));
        } else if (event.type === 'platform_error' && platformId) {
          setQueuedPlatformIds((prev) => prev.filter((id) => id !== platformId));
          setSyncStates((prev) => ({ ...prev, [platformId]: event.state ?? 'failed_login' }));
        } else if (event.type === 'platform_cancelled' && platformId) {
          setQueuedPlatformIds((prev) => prev.filter((id) => id !== platformId));
          setSyncStates((prev) => ({ ...prev, [platformId]: 'cancelled' }));
        } else if (
          event.type === 'sync_complete' ||
          event.type === 'sync_failed' ||
          event.type === 'sync_cancelled'
        ) {
          setIsSyncing(false);
          setQueuedPlatformIds([]);
        }
      }
      if (message.type === 'METRICS_UPDATED') {
        const payload = message.payload as
          | StoredOverviewMetrics[]
          | { metrics?: StoredOverviewMetrics[] }
          | undefined;
        setMetrics(Array.isArray(payload) ? payload : (payload?.metrics ?? []));
        setIsSyncing(false);
        setQueuedPlatformIds([]);
        setSyncStates({});
      }
      if (message.type === 'LOCK_STATUS_CHANGED') {
        const payload = message.payload as LockStatusResponse | undefined;
        if (payload) setLockStatus(payload);
      }
    }
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  useEffect(() => {
    if (!lockStatus?.hasMasterPassword || lockStatus.locked) return undefined;
    return installSessionActivityTracking(() => {
      void sendBackground({ type: 'SESSION_ACTIVITY' }).catch(() => {});
    });
  }, [lockStatus?.hasMasterPassword, lockStatus?.locked]);

  function isLowConfidenceMetric(metric: StoredOverviewMetrics): boolean {
    return metric.confidence < PRODUCTION_CONFIDENCE_THRESHOLD;
  }

  const disabledPlatformSet = new Set(disabledPlatformIds);
  const activePlatforms = enabledPlatforms.filter(
    (platform) => !disabledPlatformSet.has(platform.id as PlatformId),
  );
  const activeMetrics = metrics.filter(
    (metric) => !disabledPlatformSet.has(metric.platformId),
  );
  const trustedMetrics = activeMetrics.filter((metric) => !isLowConfidenceMetric(metric));
  const lowConfidenceMetrics = activeMetrics.filter(isLowConfidenceMetric);
  const displayedMetrics = showLowConfidenceMetrics ? activeMetrics : trustedMetrics;
  const totalValue = displayedMetrics.reduce((sum, m) => sum + m.platformValue, 0);
  const totalCash = displayedMetrics.reduce((sum, m) => sum + m.freeCash, 0);

  function toggleLowConfidenceMetrics() {
    const next = !showLowConfidenceMetrics;
    setShowLowConfidenceMetrics(next);
    sendBackground({
      type: 'SAVE_SETTINGS',
      payload: { showLowConfidenceMetricsInPopup: next },
    }).catch(() => {
      setShowLowConfidenceMetrics(!next);
    });
  }

  function handleSyncAll() {
    if (!isSyncing) {
      setSyncStates({});
      setQueuedPlatformIds([]);
    }
    setIsSyncing(true);
    sendBackground({ type: 'START_SYNC', payload: {} }).then(
      (response) => {
        if (response?.error) {
          if (!isSyncing) setIsSyncing(false);
          return;
        }
        if (response?.queuedPlatformIds) {
          setQueuedPlatformIds(response.queuedPlatformIds);
        }
      }
    );
  }

  function handleOpenDashboard() {
    sendBackground({ type: 'OPEN_DASHBOARD' });
  }

  function handleCancelAll() {
    setIsSyncing(false);
    setQueuedPlatformIds([]);
    setSyncStates((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([platformId, state]) => [
          platformId,
          state === 'pending' || state === 'running' ? 'cancelled' : state,
        ]),
      ) as Partial<Record<PlatformId, PlatformSyncState>>,
    );
    sendBackground({ type: 'CANCEL_SYNC_ALL' }).catch(() => {});
  }

  function handleLock() {
    sendBackground({ type: 'LOCK' });
    setLockStatus({ locked: true, hasMasterPassword: true });
  }

  function SyncIcon({
    state,
    queued,
  }: {
    state: PlatformSyncState | undefined;
    queued: boolean;
  }) {
    if (queued) return <Clock role="img" aria-label="Queued" className="h-3 w-3 text-muted-foreground" />;
    if (state === 'running') return <Loader2 role="img" aria-label="Syncing" className="h-3 w-3 text-primary animate-spin" />;
    if (state === 'success') return <CheckCircle2 role="img" aria-label="Synced" className="h-3 w-3 text-success" />;
    if (state === 'cancelled') return <Ban role="img" aria-label="Cancelled" className="h-3 w-3 text-muted-foreground" />;
    if (state?.startsWith('failed')) return <XCircle role="img" aria-label="Failed" className="h-3 w-3 text-destructive" />;
    return <Circle role="img" aria-label="Not synced" className="h-3 w-3 text-muted-foreground" />;
  }

  // Loading
  if (lockStatus === null) {
    return (
      <div className="w-80 min-h-48 bg-background flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    );
  }

  // Locked
  if (lockStatus.locked) {
    return (
      <div className="w-80 min-h-48 bg-background text-foreground p-4">
        <BrandBanner className="mb-3" imageClassName="h-9 w-auto" />
        <p className="text-xs text-muted-foreground mb-3">Enter your master password to unlock.</p>
        <UnlockForm
          onUnlocked={() => setLockStatus({ locked: false, hasMasterPassword: true })}
          placeholder="Master password"
          classNames={{
            form: "space-y-3",
            inputWrapper: "relative",
            input: "w-full h-9 rounded-md border border-border/60 bg-muted/50 px-3 pr-9 text-sm focus:border-primary/50",
            toggleButton: "absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground",
            toggleIcon: "h-3.5 w-3.5",
            error: "text-xs text-destructive",
            submitButton: "w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-1.5",
            submitIcon: "h-3.5 w-3.5",
          }}
        />
        <button
          onClick={handleOpenDashboard}
          className="w-full inline-flex items-center justify-center gap-1 text-xs text-primary hover:text-primary/80 mt-3"
        >
          Open Dashboard
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // Unlocked
  return (
    <div className="w-80 min-h-48 bg-background text-foreground p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <BrandBanner className="flex-1" imageClassName="h-8 w-auto max-w-[9rem]" />
        <div className="flex items-center gap-0.5">
          <ThemeToggle />
          <button
            onClick={handleOpenDashboard}
            className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 px-1.5"
          >
            Dashboard
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-lg border border-border/50 bg-card/80 p-4">
          <p className="text-xs text-muted-foreground mb-1">Portfolio Value</p>
          <p data-testid="popup-total-value" className="text-base font-semibold font-mono-nums text-foreground">
            {formatEur(totalValue)}
          </p>
        </div>
        <div className="rounded-lg border border-border/50 bg-card/80 p-4">
          <p className="text-xs text-muted-foreground mb-1">Free Cash</p>
          <p data-testid="popup-total-cash" className="text-base font-semibold font-mono-nums text-success">
            {formatEur(totalCash)}
          </p>
        </div>
      </div>

      {lowConfidenceMetrics.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <button
            type="button"
            data-testid="popup-more-toggle"
            onClick={() => setShowMore((current) => !current)}
            className="flex w-full items-center justify-between text-xs font-medium text-foreground"
            aria-expanded={showMore}
          >
            <span>More</span>
            <ChevronDown
              className={[
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                showMore ? "rotate-180" : "",
              ].join(" ")}
            />
          </button>
          {showMore && (
            <div data-testid="popup-low-confidence-details" className="mt-3 space-y-2 border-t border-border/60 pt-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-foreground">
                  Low-confidence values
                </span>
                <button
                  type="button"
                  role="switch"
                  data-testid="popup-include-low-confidence"
                  aria-checked={showLowConfidenceMetrics}
                  onClick={toggleLowConfidenceMetrics}
                  className={[
                    "relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors",
                    showLowConfidenceMetrics ? "bg-primary" : "bg-muted",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                      showLowConfidenceMetrics ? "translate-x-4" : "translate-x-0",
                    ].join(" ")}
                  />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Show these values in totals
              </p>
              <div className="space-y-1.5">
                {lowConfidenceMetrics.map((metric) => {
                  const platform = enabledPlatforms.find((entry) => entry.id === metric.platformId);
                  const confidencePct = `${Math.round(metric.confidence * 100)}%`;
                  return (
                    <div key={metric.platformId} className="rounded-md bg-background/70 p-2 text-xs">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {platform?.name ?? metric.platformId}
                        </span>
                        <span className="text-warning">{confidencePct}</span>
                      </div>
                      <div className="flex justify-between gap-2 text-muted-foreground">
                        <span>Portfolio Value</span>
                        <span className="font-mono-nums text-foreground">
                          {formatEur(metric.platformValue)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2 text-muted-foreground">
                        <span>Free Cash</span>
                        <span className="font-mono-nums text-success">
                          {formatEur(metric.freeCash)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Platform list */}
      <div className="space-y-1.5 mb-4">
        {activePlatforms.map((platform) => {
          const m = activeMetrics.find((x) => x.platformId === platform.id);
          const lowConfidence = m ? isLowConfidenceMetric(m) : false;
          return (
            <div key={platform.id} className="flex items-center justify-between text-sm">
              <span className="text-foreground">{platform.name}</span>
              {m && (!lowConfidence || showLowConfidenceMetrics) ? (
                <span className="text-right">
                  <span className="font-medium font-mono-nums text-foreground">
                    {formatEur(m.platformValue)}
                  </span>
                  {lowConfidence && (
                    <span className="ml-1 text-xs text-warning">low confidence</span>
                  )}
                </span>
              ) : m && lowConfidence ? (
                <span className="text-muted-foreground text-xs">Needs review</span>
              ) : (
                <span className="text-muted-foreground text-xs">No data</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Sync status */}
      {isSyncing && (
        <div className="mb-3">
          <div className="flex items-center gap-2 text-xs text-primary mb-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Syncing platforms…</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {activePlatforms.map((p) => {
              const platformId = p.id as PlatformId;
              const state = syncStates[platformId];
              const queueIndex = queuedPlatformIds.indexOf(platformId);
              const queued = queueIndex !== -1;
              return (
                <span key={p.id} className="text-xs inline-flex items-center gap-1">
                  <SyncIcon state={state} queued={queued} />
                  <span className="text-foreground">{p.name}</span>
                  {queued && (
                    <span className="text-muted-foreground">
                      In Queue #{queueIndex + 1}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Sync / Cancel button */}
      {isSyncing ? (
        <div className="flex gap-2">
          <button
            onClick={handleSyncAll}
            className="flex-1 h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition hover:opacity-90 inline-flex items-center justify-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Queue All
          </button>
          <button
            onClick={handleCancelAll}
            className="h-9 px-3 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-destructive hover:border-destructive transition inline-flex items-center justify-center"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={handleSyncAll}
          className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-sm font-medium transition hover:opacity-90 inline-flex items-center justify-center gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh All
        </button>
      )}

      {lockStatus?.hasMasterPassword && (
        <button
          onClick={handleLock}
          className="w-full inline-flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2"
        >
          <Lock className="h-3 w-3" />
          Lock
        </button>
      )}
    </div>
  );
}
