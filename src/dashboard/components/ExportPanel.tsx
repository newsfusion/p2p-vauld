import { useRef, useState, type ChangeEvent } from "react";
import { Download, FileJson, FileSpreadsheet, Upload } from "lucide-react";
import type {
  FinancialBackupV1,
  PlatformId,
  StoredOverviewMetrics,
} from "../../shared/types/index.js";
import { serializeOverviewMetricsCsv } from "../../shared/export-backup.js";
import { sendBackground } from "../../shared/messages.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

interface ExportPanelProps {
  onRestoreComplete: (
    metrics: StoredOverviewMetrics[],
    dataPlatformIds: PlatformId[],
  ) => void;
  /** Platforms currently shown on the overview — the CSV export mirrors that view. */
  visiblePlatformIds: PlatformId[];
}

const MAX_RESTORE_FILE_BYTES = 10 * 1024 * 1024;

function timestampForFilename(timestamp = new Date().toISOString()): string {
  return timestamp.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function downloadTextFile(
  filename: string,
  content: string,
  type: string,
): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel({
  onRestoreComplete,
  visiblePlatformIds,
}: ExportPanelProps) {
  const [busyAction, setBusyAction] = useState<
    "csv" | "json" | "validate" | "restore" | null
  >(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [pendingBackup, setPendingBackup] = useState<FinancialBackupV1 | null>(
    null,
  );
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleCsvExport(): Promise<void> {
    setBusyAction("csv");
    setErrorText(null);
    setStatusText(null);
    try {
      const response = await sendBackground({ type: "GET_EXPORT_DATA" });
      const visibleIds = new Set(visiblePlatformIds);
      const csv = serializeOverviewMetricsCsv(
        response.data.overviewMetrics.filter((metric) =>
          visibleIds.has(metric.platformId),
        ),
      );
      downloadTextFile(
        `p2p-overview-${timestampForFilename()}.csv`,
        csv,
        "text/csv;charset=utf-8",
      );
      setStatusText("CSV downloaded.");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "CSV export failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleJsonBackup(): Promise<void> {
    setBusyAction("json");
    setErrorText(null);
    setStatusText(null);
    try {
      const response = await sendBackground({ type: "CREATE_FINANCIAL_BACKUP" });
      downloadTextFile(
        `p2p-financial-backup-${timestampForFilename(response.backup.exportedAt)}.json`,
        `${JSON.stringify(response.backup, null, 2)}\n`,
        "application/json;charset=utf-8",
      );
      setStatusText("Backup downloaded.");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Backup failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRestoreFile(
    event: ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.currentTarget.files?.[0];
    setPendingBackup(null);
    setErrorText(null);
    setStatusText(null);
    if (!file) return;

    if (file.size > MAX_RESTORE_FILE_BYTES) {
      setErrorText("Backup file is too large.");
      return;
    }

    setBusyAction("validate");
    try {
      const backup = JSON.parse(await file.text()) as unknown;
      const response = await sendBackground({
        type: "VALIDATE_FINANCIAL_BACKUP",
        payload: { backup },
      });
      if (!response.valid) {
        setErrorText(response.error);
        return;
      }
      setPendingBackup(response.backup);
      setStatusText("Backup ready to restore.");
    } catch {
      setErrorText("Invalid JSON backup file.");
    } finally {
      setBusyAction(null);
    }
  }

  async function confirmRestore(): Promise<void> {
    if (!pendingBackup) return;

    setBusyAction("restore");
    setErrorText(null);
    setStatusText(null);
    try {
      const response = await sendBackground({
        type: "RESTORE_FINANCIAL_BACKUP",
        payload: { backup: pendingBackup },
      });
      if (!response.success) {
        setErrorText(response.error ?? "Restore failed.");
        return;
      }
      onRestoreComplete(response.metrics ?? [], response.dataPlatformIds ?? []);
      setPendingBackup(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setStatusText("Backup restored.");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Restore failed.");
    } finally {
      setBusyAction(null);
      setShowRestoreConfirm(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-foreground md:text-4xl">
          Export
        </h1>
      </div>

      <section className="glass-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Data Export</h2>
            <p className="mt-1 text-sm text-muted-foreground">Current overview metrics as CSV.</p>
          </div>
          <button
            type="button"
            data-testid="export-csv"
            onClick={() => void handleCsvExport()}
            disabled={busyAction !== null}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            {busyAction === "csv" ? "Exporting..." : "Download CSV"}
          </button>
        </div>
      </section>

      <section className="glass-card p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Backup</h2>
            <p className="mt-1 text-sm text-muted-foreground">Financial data as JSON.</p>
          </div>
          <button
            type="button"
            data-testid="export-json"
            onClick={() => void handleJsonBackup()}
            disabled={busyAction !== null}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-semibold text-primary shadow-sm transition hover:bg-accent hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileJson className="h-4 w-4" />
            {busyAction === "json" ? "Backing up..." : "Backup as JSON"}
          </button>
        </div>
      </section>

      <section className="glass-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Restore</h2>
            <p className="mt-1 text-sm text-muted-foreground">Replace financial data from JSON.</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-card px-5 text-sm font-semibold text-muted-foreground shadow-sm transition hover:bg-accent hover:text-slate-950">
              <Upload className="h-4 w-4" />
              Select JSON
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                data-testid="restore-file-input"
                className="sr-only"
                onChange={(event) => void handleRestoreFile(event)}
              />
            </label>
            <button
              type="button"
              data-testid="restore-backup"
              onClick={() => setShowRestoreConfirm(true)}
              disabled={busyAction !== null || pendingBackup === null}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {busyAction === "restore" ? "Restoring..." : "Restore"}
            </button>
          </div>
        </div>
        {(statusText || errorText || busyAction === "validate") && (
          <p
            className={`mt-4 text-sm ${errorText ? "text-destructive" : "text-muted-foreground"}`}
          >
            {errorText ??
              (busyAction === "validate" ? "Validating backup..." : statusText)}
          </p>
        )}
      </section>
      {showRestoreConfirm && (
        <ConfirmDialog
          destructive
          title="Restore this backup?"
          body="Existing financial data will be replaced. Credentials and settings will stay unchanged."
          confirmLabel="Restore"
          busy={busyAction === "restore"}
          onConfirm={() => void confirmRestore()}
          onCancel={() => setShowRestoreConfirm(false)}
        />
      )}
    </div>
  );
}
