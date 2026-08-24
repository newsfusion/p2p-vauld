import { Fragment, useState } from 'react';
import {
  AlertCircle,
  XCircle,
  RefreshCw,
  Plus,
  ChevronDown,
  ChevronRight,
  Clock,
} from 'lucide-react';
import type {
  StoredOverviewMetrics,
  PlatformCatalogEntry,
  PlatformSyncState,
  PlatformId,
} from '../../shared/types/index.js';
import {
  formatAbsoluteDateTime,
  formatEur,
  formatPercentValue,
  formatSince,
} from '../../shared/formatters.js';
import { getFaviconUrl } from '../../shared/platforms/favicon.js';
import { getPlatformIconUrl } from '../../shared/platforms/manifest-icons.js';
import { getPlatformMetadataByConnectorId } from '../../shared/platforms/metadata.js';
import {
  describeSyncFailure,
  formatSyncFailureTooltip,
} from '../../shared/sync-failure.js';
import { MetricsHistory } from './MetricsHistory.js';

interface PlatformTableProps {
  platforms: PlatformCatalogEntry[];
  metrics: StoredOverviewMetrics[];
  syncStates: Partial<Record<PlatformId, PlatformSyncState>>;
  syncSteps: Partial<Record<PlatformId, string>>;
  syncErrors?: Partial<Record<PlatformId, string>>;
  queuedPlatformIds?: PlatformId[];
  privacyMode: boolean;
  isSyncing: boolean;
  syncablePlatformIds?: PlatformId[];
  onSyncAll: () => void;
  onAddPlatform: () => void;
  onSyncPlatform: (id: PlatformId) => void;
  onReportWrongImport: (input: {
    platformId: PlatformId;
    batchId: number;
  }) => Promise<void>;
  onEditCredentials: (id: PlatformId) => void;
}

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
];

function getPlatformInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase();
}

function getPlatformFaviconPageUrl(platform: PlatformCatalogEntry): string {
  return (
    getPlatformMetadataByConnectorId(platform.id)?.websiteUrl ??
    platform.login.entryUrl
  );
}

function PlatformIcon({
  platform,
  color,
  isSyncing,
}: {
  platform: PlatformCatalogEntry;
  color: string;
  isSyncing: boolean;
}) {
  const [faviconFailed, setFaviconFailed] = useState(false);
  const localIconUrl = getPlatformIconUrl(platform.id);
  const faviconUrl = faviconFailed
    ? null
    : (localIconUrl ?? getFaviconUrl(getPlatformFaviconPageUrl(platform), { size: 32 }));
  const className =
    `flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border text-sm font-bold ${
      isSyncing ? "platform-icon-syncing" : ""
    }`;
  const style = { backgroundColor: `${color}18`, color };

  if (faviconUrl) {
    return (
      <div className={className} style={style}>
        <img
          data-testid="platform-favicon"
          src={faviconUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-6 w-6 object-contain"
          onError={() => setFaviconFailed(true)}
        />
      </div>
    );
  }

  return (
    <div data-testid="platform-initials" className={className} style={style}>
      {getPlatformInitials(platform.name)}
    </div>
  );
}

function SyncFailureDetails({
  state,
  errorMessage,
}: {
  state: PlatformSyncState;
  errorMessage?: string | undefined;
}) {
  const { reason, hint } = describeSyncFailure(state, errorMessage);
  const tooltip = formatSyncFailureTooltip({ reason, hint }, errorMessage);

  // Clamped to two lines: the column has a fixed width, and an unclamped hint
  // would make the row several times taller than its neighbours. The full text
  // stays reachable through the tooltip.
  return (
    <span
      className="mt-1 line-clamp-2 max-w-full break-words text-[11px] leading-snug text-muted-foreground"
      title={tooltip}
    >
      {reason} — {hint}
    </span>
  );
}

function PlatformStatusCell({
  state,
  entryUrl,
  onEditCredentials,
  platformId,
  errorMessage,
}: {
  state: PlatformSyncState;
  entryUrl: string;
  onEditCredentials: (id: PlatformId) => void;
  platformId: PlatformId;
  errorMessage?: string | undefined;
}) {
  if (state === 'pending' || state === 'running') {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  if (state === 'failed_login') {
    return (
      <span className="flex max-w-full flex-col items-start gap-1 text-left font-sans text-xs font-normal">
        <span className="inline-flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-destructive">
            <XCircle className="h-3 w-3" />
            Login failed
          </span>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onEditCredentials(platformId);
            }}
            className="text-primary hover:text-primary/80"
          >
            Update
          </button>
        </span>
        <SyncFailureDetails state={state} errorMessage={errorMessage} />
      </span>
    );
  }
  if (state === 'failed_2fa' || state === 'failed_captcha') {
    const label = state === 'failed_captcha' ? 'Captcha timeout — retry' : 'Manual action required';
    return (
      <span className="flex max-w-full flex-col items-start gap-1 text-left font-sans text-xs font-normal">
        <a
          href={entryUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="inline-flex items-center gap-1 text-warning hover:text-warning/80"
        >
          <AlertCircle className="h-3 w-3" />
          {label} ↗
        </a>
        <SyncFailureDetails state={state} errorMessage={errorMessage} />
      </span>
    );
  }
  if (state === 'failed_timeout') {
    return (
      <span className="flex max-w-full flex-col items-start gap-1 text-left font-sans text-xs font-normal">
        <span className="text-muted-foreground">Platform offline</span>
        <SyncFailureDetails state={state} errorMessage={errorMessage} />
      </span>
    );
  }
  if (state === 'failed_extract') {
    return (
      <span className="flex max-w-full flex-col items-start gap-1 text-left font-sans text-xs font-normal">
        <span className="inline-flex items-center gap-1 text-warning">
          <AlertCircle className="h-3 w-3" />
          Extract failed
        </span>
        <SyncFailureDetails state={state} errorMessage={errorMessage} />
      </span>
    );
  }
  return <span className="text-muted-foreground text-xs">—</span>;
}

function getLiveStepLabel(
  isSyncing: boolean,
  state: PlatformSyncState,
  stepText: string | undefined,
  queuePosition: number | undefined,
  hasSyncState: boolean,
  errorMessage?: string,
): { label: string; title?: string } {
  if (!isSyncing) return { label: "—" };
  if (!hasSyncState && queuePosition === undefined) return { label: "—" };

  if (queuePosition !== undefined) return { label: `In Queue #${queuePosition}` };
  if (state === "pending") return { label: "Queued" };
  if (state === "running") return { label: stepText?.trim() || "In progress..." };
  if (state === "success") return { label: "Done" };
  if (state === "cancelled") return { label: "Cancelled" };

  const failure = describeSyncFailure(state, errorMessage);
  return {
    label: "Failed",
    title: formatSyncFailureTooltip(failure, errorMessage),
  };
}

export function PlatformTable({
  platforms,
  metrics,
  syncStates,
  syncSteps,
  syncErrors = {},
  queuedPlatformIds = [],
  privacyMode,
  isSyncing,
  syncablePlatformIds,
  onSyncAll,
  onAddPlatform,
  onSyncPlatform,
  onReportWrongImport,
  onEditCredentials,
}: PlatformTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<PlatformId>>(new Set());
  const totalValue = metrics.reduce((sum, m) => sum + m.platformValue, 0);
  const syncableSet =
    syncablePlatformIds === undefined ? null : new Set(syncablePlatformIds);
  const queuedSet = new Set(queuedPlatformIds);
  const busyPlatformIds = new Set<PlatformId>(queuedPlatformIds);
  for (const [platformId, state] of Object.entries(syncStates)) {
    if (state === "pending" || state === "running") {
      busyPlatformIds.add(platformId as PlatformId);
    }
  }
  const syncableCount =
    syncableSet === null
      ? platforms.length
      : platforms.filter((platform) => syncableSet.has(platform.id)).length;
  const hasAvailableSyncTarget = platforms.some((platform) => {
    const isSyncable =
      syncableSet === null || syncableSet.has(platform.id);
    return isSyncable && !busyPlatformIds.has(platform.id);
  });
  const syncAllLabel = isSyncing ? 'Syncing All' : 'Sync All';
  const syncAllDisabled =
    syncableCount === 0 || (isSyncing && !hasAvailableSyncTarget);

  function toggleRow(platformId: PlatformId): void {
    setExpandedRows((previous) => {
      const next = new Set(previous);
      if (next.has(platformId)) next.delete(platformId);
      else next.add(platformId);
      return next;
    });
  }

  return (
    <section className="glass-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-card px-6 py-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Platforms</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Live portfolio metrics across connected platforms.
          </p>
        </div>
        <div
          className="flex flex-wrap items-center justify-end gap-3"
          data-testid="platform-table-actions"
        >
          <button
            type="button"
            onClick={onSyncAll}
            disabled={syncAllDisabled}
            data-testid="platform-table-sync-all"
            aria-label={syncAllLabel}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
            <span
              className="grid text-left"
              data-testid="sync-all-labels"
              aria-hidden="true"
            >
              <span className={`col-start-1 row-start-1 ${isSyncing ? "invisible" : ""}`}>
                Sync All
              </span>
              <span className={`col-start-1 row-start-1 ${isSyncing ? "" : "invisible"}`}>
                Syncing All
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onAddPlatform}
            data-testid="platform-table-add-platform"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-primary shadow-sm transition hover:bg-accent hover:text-slate-950"
          >
            <Plus className="h-4 w-4" />
            Add Platform
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
      {/* table-fixed + colgroup: column widths must not depend on cell content,
          otherwise every sync-progress text change reflows the whole table. */}
      <table className="w-full min-w-[1130px] table-fixed text-sm">
        <colgroup>
          <col />
          <col className="w-[150px]" />
          <col className="w-[180px]" />
          <col className="w-[140px]" />
          <col className="w-[110px]" />
          <col className="w-[150px]" />
          <col className="w-[190px]" />
        </colgroup>
        <thead className="bg-muted">
          <tr className="border-b border-border">
            <th className="px-6 py-4 text-left text-sm font-semibold text-muted-foreground">
              Platform
            </th>
            <th className="px-3 py-4 text-left text-sm font-semibold text-muted-foreground">
              Sync
            </th>
            <th className="px-6 py-4 text-right text-sm font-semibold text-muted-foreground">
              Portfolio Value
            </th>
            <th className="px-4 py-4 text-right text-sm font-semibold text-muted-foreground">
              Free Cash
            </th>
            <th className="px-4 py-4 text-right text-sm font-semibold text-muted-foreground">
              Net Return
            </th>
            <th className="px-4 py-4 text-right text-sm font-semibold text-muted-foreground">
              Since
            </th>
            <th className="px-6 py-4" />
          </tr>
        </thead>
        <tbody>
          {platforms.length === 0 && (
            <tr>
              <td
                colSpan={7}
                className="px-4 py-10 text-center text-sm text-muted-foreground"
              >
                No configured platforms yet. Add login credentials in Settings.
              </td>
            </tr>
          )}
          {platforms.map((platform, index) => {
            const m = metrics.find((x) => x.platformId === platform.id);
            const currentSyncState = syncStates[platform.id];
            const syncState = currentSyncState ?? 'pending';
            const syncStep = syncSteps[platform.id];
            const syncError = syncErrors[platform.id];
            const queueIndex = queuedPlatformIds.indexOf(platform.id);
            const queuePosition =
              queueIndex === -1 ? undefined : queueIndex + 1;
            const liveStep = getLiveStepLabel(
              isSyncing,
              syncState,
              syncStep,
              queuePosition,
              currentSyncState !== undefined,
              syncError,
            );
            const isQueued = queuedSet.has(platform.id);
            const isPlatformBusy =
              isSyncing &&
              ((currentSyncState !== undefined &&
                (syncState === "pending" || syncState === "running")) ||
                isQueued);
            const isSyncable =
              syncableSet === null || syncableSet.has(platform.id);
            const isExpanded = expandedRows.has(platform.id);
            const historyDetailId = `platform-history-${platform.id}`;
            const isStale =
              m !== undefined &&
              syncState !== 'success' &&
              syncState !== 'pending' &&
              syncState !== 'running';
            const hasSuspectWarning =
              m?.warnings?.includes('suspect_value') ||
              m?.warnings?.some((warning) => warning.startsWith('Low confidence')) ||
              false;
            const chartColor =
              CHART_COLORS[index % CHART_COLORS.length] ?? CHART_COLORS[0]!;

            return (
              <Fragment key={platform.id}>
                <tr
                  onClick={() => toggleRow(platform.id)}
                  className={`cursor-pointer border-b border-border transition-colors ${
                    isExpanded ? 'bg-muted/70 hover:bg-muted/70' : 'hover:bg-muted/60'
                  }`}
                >
                  {/* Platform name with colored icon */}
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleRow(platform.id);
                        }}
                        className="text-primary hover:text-primary/80"
                        aria-label={`Toggle change history for ${platform.name}`}
                        aria-expanded={isExpanded}
                        aria-controls={historyDetailId}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <PlatformIcon
                        platform={platform}
                        color={chartColor}
                        isSyncing={isPlatformBusy}
                      />
                      <div className="min-w-0">
                        <span className="block truncate text-base font-semibold text-foreground">
                          {platform.name}
                        </span>
                        {!isSyncable && (
                          <span className="mt-1 block text-xs font-semibold text-muted-foreground">
                            Imported data only
                          </span>
                        )}
                        {hasSuspectWarning && (
                          <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-warning">
                            <AlertCircle className="h-3 w-3" />
                            Check value
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Live sync step */}
                  <td
                    className="px-3 py-6 text-xs font-medium text-muted-foreground"
                    title={liveStep.title ?? (liveStep.label === '—' ? undefined : liveStep.label)}
                  >
                    <span className="flex items-center gap-1">
                      {isQueued && <Clock className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{liveStep.label}</span>
                    </span>
                  </td>

                  {/* Portfolio Value */}
                  <td className="px-6 py-6 text-right font-mono-nums text-base font-semibold text-foreground">
                    {m ? (
                      <span
                        className={`whitespace-nowrap ${isStale ? 'opacity-50' : ''}`}
                      >
                        {formatEur(m.platformValue, privacyMode)}
                      </span>
                    ) : (
                      <PlatformStatusCell
                        state={syncState}
                        entryUrl={platform.login.entryUrl}
                        onEditCredentials={onEditCredentials}
                        platformId={platform.id}
                        {...(syncError ? { errorMessage: syncError } : {})}
                      />
                    )}
                  </td>

                  {/* Free Cash */}
                  <td className="whitespace-nowrap px-4 py-6 text-right font-mono-nums text-base text-muted-foreground">
                    {m ? (
                      <span className={isStale ? 'opacity-50' : ''}>
                        {formatEur(m.freeCash, privacyMode)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Net Return */}
                  <td className="whitespace-nowrap px-4 py-6 text-right font-mono-nums text-base font-medium text-success">
                    {m?.netAnnualReturnPct !== undefined ? (
                      <span className={isStale ? 'opacity-50' : ''}>
                        {formatPercentValue(m.netAnnualReturnPct, privacyMode)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Since */}
                  <td
                    className="truncate px-4 py-6 text-right text-sm tabular-nums text-muted-foreground"
                    title={m?.fetchedAt ? formatAbsoluteDateTime(m.fetchedAt) : undefined}
                  >
                    {m?.fetchedAt ? (
                      <span className={isStale ? 'opacity-50' : ''}>
                        {formatSince(m.fetchedAt)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </td>

                  {/* Sync action */}
                  <td className="px-6 py-6 text-right">
                    {isSyncable ? (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onSyncPlatform(platform.id);
                        }}
                        disabled={isPlatformBusy}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold whitespace-nowrap text-muted-foreground transition hover:bg-accent hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Sync
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditCredentials(platform.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-semibold whitespace-nowrap text-primary transition hover:bg-accent hover:text-slate-950"
                      >
                        <Plus className="h-3 w-3" />
                        Add credentials
                      </button>
                    )}
                  </td>
                </tr>
                {isExpanded && (
                  <MetricsHistory
                    platformId={platform.id}
                    platformName={platform.name}
                    detailId={historyDetailId}
                    privacyMode={privacyMode}
                    syncState={syncState}
                    isSyncable={isSyncable}
                    reportDisabled={isPlatformBusy}
                    onReportWrongImport={onReportWrongImport}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      </div>

      {/* Footer with total */}
      <div className="flex items-center justify-between border-t border-border bg-muted px-6 py-4 text-sm text-muted-foreground">
        <span>{platforms.length} platforms</span>
        <span className="font-mono-nums">
          Total: {formatEur(totalValue, privacyMode)}
        </span>
      </div>
    </section>
  );
}
