import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Info,
  Pencil,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { sendBackground } from "../../shared/messages.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import {
  formatAbsoluteDateTime,
  formatEur,
  formatSince,
} from "../../shared/formatters.js";
import type {
  IngestionBatchOverview,
  PlatformId,
  PlatformSyncState,
  StoredIngestionBatch,
  StoredMetricsSnapshot,
} from "../../shared/types/index.js";

interface MetricsHistoryProps {
  platformId: PlatformId;
  platformName: string;
  privacyMode: boolean;
  syncState: PlatformSyncState;
  isSyncable: boolean;
  detailId?: string;
  reportDisabled?: boolean;
  onReportWrongImport?: (input: {
    platformId: PlatformId;
    batchId: number;
  }) => Promise<void>;
}

const HISTORY_COPY = {
  loadError: "Failed to load history",
  emptyState: "No history recorded yet.",
  deleteConfirm: "Delete this history entry?",
  deleteError: "Could not delete history entry",
  editError: "Could not save history entry",
  invalidNumber: "Enter valid numbers for value and free cash",
  revertConfirm: "Revert this platform to the state before this import?",
  revertError: "Could not revert import",
  reportTitle: "Report wrong imported value",
  reportBody:
    "Was the last import for {platformName} wrong? If you continue, the last saved import will be undone. A new sync will start and you will be asked to choose the correct Portfolio Value and Free Cash from all detected values.",
  reportConfirm: "Yes, undo and resync",
  reportCancel: "Keep import",
  reportError: "Could not undo and restart sync",
} as const;

const ACTION_BUTTON_CLASS =
  "text-muted-foreground opacity-0 transition-opacity disabled:pointer-events-none disabled:opacity-30 group-hover:opacity-100";

type VisibleDeltaField = "platformValue" | "freeCash";
type PendingConfirm =
  | { kind: "delete"; date: string }
  | { kind: "revert"; batchId: number };

function formatDeltaValue(delta: number, privacyMode: boolean): string {
  if (privacyMode) return "***";
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${formatEur(delta)}`;
}

function getMetric(
  overview: IngestionBatchOverview | undefined,
  field: VisibleDeltaField,
): number | undefined {
  return overview?.[field];
}

function renderMetricChange(
  snapshot: StoredMetricsSnapshot,
  field: VisibleDeltaField,
  batch: StoredIngestionBatch | undefined,
  privacyMode: boolean,
) {
  const currentValue = snapshot[field];
  const previousValue = getMetric(batch?.beforeOverview, field);
  const hasDelta =
    previousValue !== undefined && previousValue !== currentValue;
  const delta = hasDelta ? currentValue - previousValue : 0;
  const trendClass =
    delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground";

  // Delta sits above the value instead of beside it: side by side the two
  // amounts do not fit the fixed column width and wrap mid-number. The
  // delta line is always rendered so every history row keeps the same height.
  return (
    <span className="flex flex-col items-end leading-tight">
      {hasDelta ? (
        <span
          className={`inline-flex items-center gap-0.5 whitespace-nowrap font-mono-nums text-[10px] ${trendClass}`}
        >
          {!privacyMode && delta > 0 ? <ArrowUp className="h-2.5 w-2.5" /> : null}
          {!privacyMode && delta < 0 ? <ArrowDown className="h-2.5 w-2.5" /> : null}
          {formatDeltaValue(delta, privacyMode)}
        </span>
      ) : (
        <span aria-hidden="true" className="text-[10px]">
          &nbsp;
        </span>
      )}
      <span className="whitespace-nowrap">
        {formatEur(currentValue, privacyMode)}
      </span>
    </span>
  );
}

function batchMatchesSnapshot(
  batch: StoredIngestionBatch,
  snapshot: StoredMetricsSnapshot,
): boolean {
  if (snapshot.batchId !== undefined && batch.id === snapshot.batchId) return true;
  return (
    batch.platformId === snapshot.platformId &&
    batch.afterDailySnapshot?.date === snapshot.date
  );
}

function ReportWrongImportModal({
  platformName,
  busy,
  onConfirm,
  onCancel,
}: {
  platformName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = "report-wrong-import-title";
  const descriptionId = "report-wrong-import-description";

  return createPortal(
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl modal-pop">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-destructive">
              Import correction
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold text-foreground">
              {HISTORY_COPY.reportTitle}
            </h2>
          </div>
          <button
            type="button"
            aria-label={HISTORY_COPY.reportCancel}
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p id={descriptionId} className="text-sm leading-6 text-muted-foreground">
          {HISTORY_COPY.reportBody.replace("{platformName}", platformName)}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-lg border border-border px-4 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {HISTORY_COPY.reportCancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex h-10 items-center rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
          >
            {HISTORY_COPY.reportConfirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Sits to the LEFT of the amount inside a justify-end row, so showing or
// hiding it never moves the amount off the column's right edge.
function ReportWrongValueSlot({
  visible,
  date,
  fieldLabel,
  disabled,
  onClick,
}: {
  visible: boolean;
  date: string;
  fieldLabel: "Portfolio Value" | "Free Cash";
  disabled: boolean;
  onClick: () => void;
}) {
  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label={`Report wrong ${fieldLabel}`}
      title={`Report wrong ${fieldLabel}`}
      data-testid={`history-report-${fieldLabel === "Portfolio Value" ? "value" : "cash"}-${date}`}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-destructive opacity-0 transition-opacity hover:text-destructive/80 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive disabled:pointer-events-none disabled:opacity-30 group-hover:opacity-100"
    >
      <Info className="h-3.5 w-3.5" />
    </button>
  );
}

export function MetricsHistory({
  platformId,
  platformName,
  privacyMode,
  syncState,
  isSyncable,
  detailId,
  reportDisabled = false,
  onReportWrongImport,
}: MetricsHistoryProps) {
  const [snapshots, setSnapshots] = useState<StoredMetricsSnapshot[]>([]);
  const [batches, setBatches] = useState<StoredIngestionBatch[]>([]);
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [draftPlatformValue, setDraftPlatformValue] = useState("");
  const [draftFreeCash, setDraftFreeCash] = useState("");
  const [reportBatchId, setReportBatchId] = useState<number | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const previousSyncState = useRef<PlatformSyncState>(syncState);

  const loadHistory = useCallback(
    async (isCancelled: () => boolean = () => false): Promise<void> => {
      try {
        const [historyResponse, batchResponse] = await Promise.all([
          sendBackground({
            type: "GET_METRICS_HISTORY",
            payload: { platformId },
          }),
          sendBackground({
            type: "GET_PLATFORM_BATCH_HISTORY",
            payload: { platformId },
          }),
        ]);
        if (isCancelled()) return;
        setSnapshots(historyResponse.snapshots ?? []);
        setBatches(batchResponse.batches ?? []);
        setErrorText(null);
      } catch (error: unknown) {
        if (isCancelled()) return;
        setErrorText(
          error instanceof Error ? error.message : HISTORY_COPY.loadError,
        );
      }
    },
    [platformId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [historyResponse, batchResponse] = await Promise.all([
          sendBackground({
            type: "GET_METRICS_HISTORY",
            payload: { platformId },
          }),
          sendBackground({
            type: "GET_PLATFORM_BATCH_HISTORY",
            payload: { platformId },
          }),
        ]);
        if (cancelled) return;
        setSnapshots(historyResponse.snapshots ?? []);
        setBatches(batchResponse.batches ?? []);
        setErrorText(null);
      } catch (error: unknown) {
        if (cancelled) return;
        setErrorText(
          error instanceof Error ? error.message : HISTORY_COPY.loadError,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [platformId]);

  useEffect(() => {
    const previous = previousSyncState.current;
    previousSyncState.current = syncState;
    const wasSyncing = previous === "pending" || previous === "running";
    const finishedSyncing = syncState !== "pending" && syncState !== "running";

    if (wasSyncing && finishedSyncing) {
      void loadHistory();
    }
  }, [loadHistory, syncState]);

  function startEdit(snapshot: StoredMetricsSnapshot): void {
    setEditingDate(snapshot.date);
    setDraftPlatformValue(String(snapshot.platformValue));
    setDraftFreeCash(String(snapshot.freeCash));
    setErrorText(null);
  }

  function cancelEdit(): void {
    setEditingDate(null);
  }

  async function saveEdit(date: string): Promise<void> {
    const platformValue = Number.parseFloat(draftPlatformValue);
    const freeCash = Number.parseFloat(draftFreeCash);
    if (!Number.isFinite(platformValue) || !Number.isFinite(freeCash)) {
      setErrorText(HISTORY_COPY.invalidNumber);
      return;
    }

    setBusy(true);
    setErrorText(null);
    try {
      const response = await sendBackground({
        type: "UPDATE_METRICS_SNAPSHOT",
        payload: { platformId, date, platformValue, freeCash },
      });
      if (!response.success) {
        setErrorText(response.error ?? HISTORY_COPY.editError);
        return;
      }
      setEditingDate(null);
      await loadHistory();
    } finally {
      setBusy(false);
    }
  }

  function handleDelete(date: string): void {
    setPendingConfirm({ kind: "delete", date });
  }

  async function deleteSnapshot(date: string): Promise<void> {
    setBusy(true);
    setErrorText(null);
    try {
      const response = await sendBackground({
        type: "DELETE_METRICS_SNAPSHOT",
        payload: { platformId, date },
      });
      if (!response.success) {
        setErrorText(response.error ?? HISTORY_COPY.deleteError);
        return;
      }
      if (editingDate === date) setEditingDate(null);
      setPendingConfirm(null);
      await loadHistory();
    } finally {
      setBusy(false);
    }
  }

  function handleRevert(batchId: number): void {
    setPendingConfirm({ kind: "revert", batchId });
  }

  async function revertBatch(batchId: number): Promise<void> {
    setBusy(true);
    setErrorText(null);
    try {
      const response = await sendBackground({
        type: "REVERT_PLATFORM_BATCH",
        payload: { platformId, batchId },
      });
      if (!response.success) {
        setErrorText(response.error ?? HISTORY_COPY.revertError);
        return;
      }
      setPendingConfirm(null);
      await loadHistory();
    } finally {
      setBusy(false);
    }
  }

  function confirmPendingAction(): void {
    if (pendingConfirm?.kind === "delete") {
      setPendingConfirm(null);
      void deleteSnapshot(pendingConfirm.date);
      return;
    }
    if (pendingConfirm?.kind === "revert") {
      setPendingConfirm(null);
      void revertBatch(pendingConfirm.batchId);
    }
  }

  async function confirmReportWrongImport(): Promise<void> {
    if (reportBatchId === null || !onReportWrongImport) {
      setReportBatchId(null);
      return;
    }

    setBusy(true);
    setErrorText(null);
    try {
      await onReportWrongImport({ platformId, batchId: reportBatchId });
      setReportBatchId(null);
      await loadHistory();
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : HISTORY_COPY.reportError,
      );
    } finally {
      setBusy(false);
    }
  }

  if (errorText) {
    return (
      <tr id={detailId} className="border-b border-border bg-card">
        <td colSpan={7} className="px-6 py-4 text-xs text-destructive">
          {errorText}
        </td>
      </tr>
    );
  }

  if (snapshots.length === 0) {
    return (
      <tr id={detailId} className="border-b border-border bg-card">
        <td colSpan={7} className="px-6 py-4 text-xs text-muted-foreground">
          {HISTORY_COPY.emptyState}
        </td>
      </tr>
    );
  }

  // `syncState` defaults to "pending" for never-synced platforms, so only the
  // active "running" state disables actions here. The background handler is the
  // authoritative busy guard (rejects edits for any queued/running platform).
  const actionsDisabled = busy || syncState === "running";
  const latestBatch = batches[0];
  const undoableBatchId =
    latestBatch !== undefined &&
    latestBatch.revertible &&
    !latestBatch.legacyBackfilled &&
    latestBatch.id !== undefined
      ? latestBatch.id
      : undefined;
  const undoSnapshotDate = latestBatch?.afterDailySnapshot?.date;
  const undoRowVisible =
    undoableBatchId !== undefined &&
    snapshots.some((snapshot) => snapshot.date === undoSnapshotDate);
  const reportActionDisabled =
    actionsDisabled ||
    reportDisabled ||
    !isSyncable ||
    onReportWrongImport === undefined;

  return (
    <>
      {pendingConfirm?.kind === "delete" ? (
        <ConfirmDialog
          title={HISTORY_COPY.deleteConfirm}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          busy={busy}
          onConfirm={confirmPendingAction}
          onCancel={() => setPendingConfirm(null)}
        />
      ) : pendingConfirm?.kind === "revert" ? (
        <ConfirmDialog
          title={HISTORY_COPY.revertConfirm}
          confirmLabel="Revert"
          cancelLabel="Cancel"
          destructive
          busy={busy}
          onConfirm={confirmPendingAction}
          onCancel={() => setPendingConfirm(null)}
        />
      ) : null}
      {reportBatchId !== null ? (
        <ReportWrongImportModal
          platformName={platformName}
          busy={busy}
          onConfirm={() => void confirmReportWrongImport()}
          onCancel={() => setReportBatchId(null)}
        />
      ) : null}
      {undoableBatchId !== undefined && !undoRowVisible ? (
        <tr id={detailId} className="border-b border-border/60 bg-card text-xs">
          <td colSpan={7} className="px-6 py-2 text-right">
            <button
              type="button"
              data-testid={`batch-undo-${undoableBatchId}`}
              aria-label="Revert latest import"
              onClick={() => handleRevert(undoableBatchId)}
              disabled={actionsDisabled}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Undo last import
            </button>
          </td>
        </tr>
      ) : null}
      {snapshots.map((snapshot, snapshotIndex) => {
        const isEditing = editingDate === snapshot.date;
        const matchingBatch = batches.find((batch) =>
          batchMatchesSnapshot(batch, snapshot),
        );
        const showUndo =
          undoableBatchId !== undefined && snapshot.date === undoSnapshotDate;
        const showReport = showUndo && undoableBatchId !== undefined;

        return (
          <tr
            key={`${snapshot.platformId}-${snapshot.date}`}
            id={
              undoableBatchId !== undefined && !undoRowVisible
                ? undefined
                : snapshotIndex === 0
                  ? detailId
                  : undefined
            }
            className="group border-b border-border/60 bg-card text-xs hover:bg-muted/60"
          >
            <td
              className="truncate px-6 py-3 font-mono-nums text-muted-foreground"
              title={snapshot.date}
            >
              {formatAbsoluteDateTime(snapshot.fetchedAt)}
            </td>
            <td className="px-3 py-3" />
            <td className="px-6 py-3 text-right font-mono-nums text-foreground">
              {isEditing ? (
                <input
                  inputMode="decimal"
                  value={draftPlatformValue}
                  onChange={(event) => setDraftPlatformValue(event.target.value)}
                  aria-label="Portfolio value"
                  data-testid={`history-input-value-${snapshot.date}`}
                  className="w-28 rounded border border-border bg-background px-2 py-1 text-right font-mono-nums text-xs text-foreground"
                />
              ) : (
                <span className="flex items-center justify-end gap-2">
                  <ReportWrongValueSlot
                    visible={showReport}
                    date={snapshot.date}
                    fieldLabel="Portfolio Value"
                    disabled={reportActionDisabled}
                    onClick={() => setReportBatchId(undoableBatchId ?? null)}
                  />
                  {renderMetricChange(
                    snapshot,
                    "platformValue",
                    matchingBatch,
                    privacyMode,
                  )}
                </span>
              )}
            </td>
            <td className="px-4 py-3 text-right font-mono-nums text-foreground">
              {isEditing ? (
                <input
                  inputMode="decimal"
                  value={draftFreeCash}
                  onChange={(event) => setDraftFreeCash(event.target.value)}
                  aria-label="Free cash"
                  data-testid={`history-input-cash-${snapshot.date}`}
                  className="w-24 rounded border border-border bg-background px-2 py-1 text-right font-mono-nums text-xs text-foreground"
                />
              ) : (
                <span className="flex items-center justify-end gap-2">
                  <ReportWrongValueSlot
                    visible={showReport}
                    date={snapshot.date}
                    fieldLabel="Free Cash"
                    disabled={reportActionDisabled}
                    onClick={() => setReportBatchId(undoableBatchId ?? null)}
                  />
                  {renderMetricChange(
                    snapshot,
                    "freeCash",
                    matchingBatch,
                    privacyMode,
                  )}
                </span>
              )}
            </td>
            <td className="px-4 py-3" />
            <td
              className="truncate px-4 py-3 text-right tabular-nums text-muted-foreground"
              title={formatAbsoluteDateTime(snapshot.fetchedAt)}
            >
              {formatSince(snapshot.fetchedAt)}
            </td>
            <td className="whitespace-nowrap px-6 py-3 text-right">
              <span className="inline-flex items-center justify-end gap-2">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      data-testid={`history-save-${snapshot.date}`}
                      aria-label="Save entry"
                      onClick={() => void saveEdit(snapshot.date)}
                      disabled={actionsDisabled}
                      className="text-muted-foreground transition hover:text-success disabled:pointer-events-none disabled:opacity-30"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid={`history-cancel-${snapshot.date}`}
                      aria-label="Cancel edit"
                      onClick={cancelEdit}
                      disabled={busy}
                      className="text-muted-foreground transition hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    {showUndo ? (
                      <button
                        type="button"
                        data-testid={`batch-undo-${undoableBatchId}`}
                        aria-label="Revert latest import"
                        onClick={() => handleRevert(undoableBatchId)}
                        disabled={actionsDisabled}
                        className={`${ACTION_BUTTON_CLASS} hover:text-destructive`}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      data-testid={`history-edit-${snapshot.date}`}
                      aria-label="Edit entry"
                      onClick={() => startEdit(snapshot)}
                      disabled={actionsDisabled || privacyMode}
                      className={`${ACTION_BUTTON_CLASS} hover:text-foreground`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-testid={`history-delete-${snapshot.date}`}
                      aria-label="Delete entry"
                      onClick={() => handleDelete(snapshot.date)}
                      disabled={actionsDisabled}
                      className={`${ACTION_BUTTON_CLASS} hover:text-destructive`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}
