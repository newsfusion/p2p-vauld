import Dexie, { type Table } from "dexie";
import type {
  DeltaField,
  FinancialBackupPayload,
  FinancialBackupV1,
  IngestConnectorResultOutcome,
  IngestConnectorResultOptions,
  IngestionBatchOverview,
  OverviewMetrics,
  StoredSyncRun,
  StoredOverviewMetrics,
  StoredMetricsSnapshot,
  StoredCashflow,
  StoredIngestionBatch,
  StoredPosition,
  StoredRiskEvent,
  StoredDeltaLog,
  StoredCredentials,
  LoginFieldRole,
  LoginSelectorProfile,
  NavigationProfile,
  SelectorProfile,
  AppSettings,
  CredentialStatusEntry,
  ConnectorSyncResult,
  ExtractionChoiceSignalKey,
  ExtractionTelemetryRecord,
  PlatformId,
  SyncRunState,
  PlatformSyncState,
} from "../types/index.js";
import { PLATFORM_IDS } from "../types/index.js";
import { getPlatformById } from "../platforms/index.js";
import { calculateNetAnnualReturnFromSnapshots } from "../financial-metrics.js";
import { createLogger } from "../logger.js";
import {
  createFinancialBackupObject,
  sanitizeFinancialBackupPayload,
} from "../export-backup.js";
import {
  isAutoLockTimeoutMinutes,
  normalizeAutoLockSettings,
} from "../auto-lock.js";
import { RUNTIME_NAMES } from "../runtime-names.js";

const log = createLogger("db");

// ─── Schema ───────────────────────────────────────────────────────────────────

class P2PDatabase extends Dexie {
  syncRuns!: Table<StoredSyncRun, number>;
  metricsHistory!: Table<StoredMetricsSnapshot, [string, string]>;
  cashflows!: Table<StoredCashflow, number>;
  positions!: Table<StoredPosition, number>;
  riskEvents!: Table<StoredRiskEvent, number>;
  deltaLogs!: Table<StoredDeltaLog, number>;
  ingestionBatches!: Table<StoredIngestionBatch, number>;
  credentials!: Table<StoredCredentials, string>;
  selectorProfiles!: Table<SelectorProfile, [string, string]>;
  loginSelectorProfiles!: Table<LoginSelectorProfile, [string, string]>;
  navigationProfiles!: Table<NavigationProfile, string>;
  extractionTelemetry!: Table<ExtractionTelemetryRecord, number>;
  settings!: Table<AppSettings & { id: string }, string>;

  constructor() {
    super(RUNTIME_NAMES.trackerDatabase);
    this.version(1).stores({
      syncRuns: "++id, runId, state, startedAt",
      overviewMetrics: "platformId, fetchedAt",
      metricsHistory: "[platformId+date], platformId, date",
      cashflows: "++id, platformId, date, type",
      positions: "++id, platformId, instrumentId, date",
      riskEvents: "++id, platformId, status, since",
      credentials: "platformId, updatedAt",
      selectorProfiles: "[platformId+signalKey]",
      settings: "id",
    });
    this.version(2).stores({
      syncRuns: "++id, runId, state, startedAt",
      overviewMetrics: "platformId, fetchedAt",
      metricsHistory: "[platformId+date], platformId, date",
      cashflows: "++id, platformId, date, type",
      positions: "++id, platformId, instrumentId, date",
      riskEvents: "++id, platformId, status, since",
      credentials: "platformId, updatedAt",
      selectorProfiles: "[platformId+signalKey]",
      settings: "id",
      deltaLogs: "++id, platformId, timestamp, field",
    });
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table("syncRuns")
          .toCollection()
          .modify((run: Record<string, unknown>) => {
            if (typeof run.platformProgress === "string") {
              run.platformProgress = JSON.parse(run.platformProgress as string);
            }
          });
      });
    this.version(4).stores({
      syncRuns: "++id, runId, state, startedAt",
      overviewMetrics: "platformId, fetchedAt",
      metricsHistory: "[platformId+date], platformId, date, batchId",
      cashflows: "++id, platformId, date, type, batchId",
      positions: "++id, platformId, instrumentId, date, batchId",
      riskEvents: "++id, platformId, status, since, batchId",
      credentials: "platformId, updatedAt",
      selectorProfiles: "[platformId+signalKey]",
      settings: "id",
      deltaLogs: "++id, platformId, timestamp, field, batchId",
      ingestionBatches: "++id, platformId, appliedAt, revertible, legacyBackfilled",
    });
    this.version(5).stores({
      syncRuns: "++id, runId, state, startedAt",
      overviewMetrics: "platformId, fetchedAt",
      metricsHistory: "[platformId+date], platformId, date, batchId",
      cashflows: "++id, platformId, date, type, batchId",
      positions: "++id, platformId, instrumentId, date, batchId",
      riskEvents: "++id, platformId, status, since, batchId",
      credentials: "platformId, updatedAt",
      selectorProfiles: "[platformId+signalKey]",
      loginSelectorProfiles: "[platformId+fieldRole]",
      settings: "id",
      deltaLogs: "++id, platformId, timestamp, field, batchId",
      ingestionBatches: "++id, platformId, appliedAt, revertible, legacyBackfilled",
    });
    this.version(6)
      .stores({
        syncRuns: "++id, runId, state, startedAt",
        overviewMetrics: "platformId, fetchedAt",
        metricsHistory: "[platformId+date], platformId, date, batchId",
        cashflows: "++id, platformId, date, type, batchId",
        positions: "++id, platformId, instrumentId, date, batchId",
        riskEvents: "++id, platformId, status, since, batchId",
        credentials: "platformId, updatedAt",
        selectorProfiles: "[platformId+signalKey]",
        loginSelectorProfiles: "[platformId+fieldRole]",
        settings: "id",
        deltaLogs: "++id, platformId, timestamp, field, batchId",
        ingestionBatches: "++id, platformId, appliedAt, revertible, legacyBackfilled",
      })
      .upgrade(async (tx) => {
        await backfillLegacyBatchHistory(undefined, {
          deltaLogs: tx.table("deltaLogs") as Table<StoredDeltaLog, number>,
          ingestionBatches: tx.table("ingestionBatches") as Table<StoredIngestionBatch, number>,
        });
      });
    this.version(7).stores({
      syncRuns: "++id, runId, state, startedAt",
      overviewMetrics: "platformId, fetchedAt",
      metricsHistory: "[platformId+date], platformId, date, batchId",
      cashflows: "++id, platformId, date, type, batchId",
      positions: "++id, platformId, instrumentId, date, batchId",
      riskEvents: "++id, platformId, status, since, batchId",
      credentials: "platformId, updatedAt",
      selectorProfiles: "[platformId+signalKey]",
      loginSelectorProfiles: "[platformId+fieldRole]",
      settings: "id",
      deltaLogs: "++id, platformId, timestamp, field, batchId",
      ingestionBatches: "++id, platformId, appliedAt, revertible, legacyBackfilled",
      extractionTelemetry: "++id, platformId, runId, recordedAt",
    });
    this.version(8).stores({
      syncRuns: "++id, runId, state, startedAt",
      overviewMetrics: "platformId, fetchedAt",
      metricsHistory: "[platformId+date], platformId, date, batchId",
      cashflows: "++id, platformId, date, type, batchId",
      positions: "++id, platformId, instrumentId, date, batchId",
      riskEvents: "++id, platformId, status, since, batchId",
      credentials: "platformId, updatedAt",
      selectorProfiles: "[platformId+signalKey]",
      loginSelectorProfiles: "[platformId+fieldRole]",
      settings: "id",
      deltaLogs: "++id, platformId, timestamp, field, batchId",
      ingestionBatches: "++id, platformId, appliedAt, [platformId+appliedAt+id], revertible, legacyBackfilled",
      extractionTelemetry: "++id, platformId, runId, recordedAt, [platformId+recordedAt+id]",
    });
    this.version(9)
      .stores({})
      .upgrade(async (tx) => {
        await backfillOverviewMetricsIntoHistory({
          overviewMetrics: tx.table("overviewMetrics") as Table<StoredOverviewMetrics, string>,
          metricsHistory: tx.table("metricsHistory") as Table<StoredMetricsSnapshot, [string, string]>,
        });
      });
    this.version(10).stores({
      overviewMetrics: null,
    });
    this.version(11).stores({
      navigationProfiles: "platformId",
    });
  }
}

export const db = new P2PDatabase();

type LegacySettingsRecord = Omit<
  Partial<AppSettings>,
  "autoLockEnabled" | "sessionTimeoutMinutes"
> & {
  id: string;
  autoLockEnabled?: boolean;
  sessionTimeoutMinutes?: number;
  lastUsedCredentialEmail?: unknown;
};

export function stripLegacySettingsFields(
  settings: LegacySettingsRecord,
): Omit<LegacySettingsRecord, "lastUsedCredentialEmail"> {
  const sanitized = { ...settings };
  delete sanitized.lastUsedCredentialEmail;
  return sanitized;
}

// ─── Sync run helpers ─────────────────────────────────────────────────────────

export async function createSyncRun(
  runId: string,
  platformIds: PlatformId[],
): Promise<number> {
  const progress: Partial<Record<PlatformId, PlatformSyncState>> = {};
  for (const id of platformIds) {
    progress[id] = "pending";
  }
  return db.syncRuns.add({
    runId,
    state: "queued",
    startedAt: new Date().toISOString(),
    platformProgress: progress,
  });
}

export async function updateSyncRun(
  runId: string,
  update: Partial<{ state: SyncRunState; message: string; finishedAt: string }>,
): Promise<void> {
  await db.syncRuns.where("runId").equals(runId).modify(update);
}

export async function updatePlatformProgress(
  runId: string,
  platformId: PlatformId,
  state: PlatformSyncState,
): Promise<void> {
  await db.syncRuns
    .where("runId")
    .equals(runId)
    .modify((run: StoredSyncRun) => {
      if (!run.platformProgress) run.platformProgress = {};
      run.platformProgress[platformId] = state;
    });
}

export async function getLatestSyncRun(): Promise<StoredSyncRun | undefined> {
  return db.syncRuns.orderBy("id").last();
}

/**
 * Wall-clock timestamp of the most recent successfully completed sync run.
 *
 * This is the real time the user last synced, independent of the metrics
 * `fetchedAt` value (which can be synthetic/backdated, e.g. in demo mode or
 * after restoring a backup). The sync-reminder badge relies on this so it
 * reflects actual sync activity rather than the age of the data points.
 */
export async function getLastSuccessfulSyncAt(): Promise<string | null> {
  const run = await db.syncRuns.where("state").equals("completed").last();
  if (!run) return null;
  return run.finishedAt ?? run.startedAt ?? null;
}

export async function cleanupStaleSyncRuns(): Promise<void> {
  log.debug("Starting cleanup of stale sync runs");
  await db.transaction("rw", db.syncRuns, async () => {
    const runs = await db.syncRuns
      .filter((r) => r.state === "queued" || r.state === "running")
      .toArray();

    log.debug("Found potentially stale sync runs", { count: runs.length });

    for (const run of runs) {
      log.debug("Cleaning up stale run", {
        runId: run.runId,
        state: run.state,
      });
      let modified = false;
      const progress = run.platformProgress || {};
      for (const [pid, state] of Object.entries(progress)) {
        if (state === "running" || state === "pending") {
          progress[pid as PlatformId] = "failed_timeout";
          modified = true;
        }
      }

      await db.syncRuns.update(run.id!, {
        state: "failed",
        finishedAt: new Date().toISOString(),
        message: "Sync interrupted by extension restart",
        ...(modified ? { platformProgress: progress } : {}),
      });
    }
  });
  log.debug("Cleanup of stale sync runs finished");
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function toOverviewMetrics(snapshot: StoredMetricsSnapshot): StoredOverviewMetrics {
  return {
    platformId: snapshot.platformId,
    fetchedAt: snapshot.fetchedAt,
    platformValue: snapshot.platformValue,
    freeCash: snapshot.freeCash,
    ...(snapshot.netAnnualReturnPct === undefined
      ? {}
      : { netAnnualReturnPct: snapshot.netAnnualReturnPct }),
    // pre-v9 snapshots were written without currency/confidence
    currency: snapshot.currency ?? "EUR",
    confidence: snapshot.confidence ?? 1,
    ...(snapshot.warnings && snapshot.warnings.length > 0
      ? { warnings: snapshot.warnings }
      : {}),
  };
}

async function mergeOverviewIntoHistory(
  overview: StoredOverviewMetrics,
  metricsHistory: Table<StoredMetricsSnapshot, [string, string]>,
  fallbackBatchId?: number,
): Promise<void> {
  const date = overview.fetchedAt.slice(0, 10);
  const existing = await metricsHistory.get([overview.platformId, date]);
  if (existing !== undefined && existing.fetchedAt >= overview.fetchedAt) return;
  const batchId = existing?.batchId ?? fallbackBatchId;
  await metricsHistory.put({
    platformId: overview.platformId,
    date,
    platformValue: overview.platformValue,
    freeCash: overview.freeCash,
    ...(overview.netAnnualReturnPct === undefined
      ? {}
      : { netAnnualReturnPct: overview.netAnnualReturnPct }),
    fetchedAt: overview.fetchedAt,
    currency: overview.currency,
    confidence: overview.confidence,
    ...(overview.warnings && overview.warnings.length > 0
      ? { warnings: overview.warnings }
      : {}),
    ...(batchId === undefined ? {} : { batchId }),
  });
}

interface OverviewBackfillTables {
  overviewMetrics: Table<StoredOverviewMetrics, string>;
  metricsHistory: Table<StoredMetricsSnapshot, [string, string]>;
}

export async function backfillOverviewMetricsIntoHistory(
  tables: OverviewBackfillTables,
): Promise<void> {
  const overviews = await tables.overviewMetrics.toArray();
  for (const overview of overviews) {
    await mergeOverviewIntoHistory(overview, tables.metricsHistory);
  }
}

export async function getLatestSnapshotForPlatform(
  platformId: PlatformId,
): Promise<StoredMetricsSnapshot | undefined> {
  return db.metricsHistory
    .where("[platformId+date]")
    .between([platformId, Dexie.minKey], [platformId, Dexie.maxKey], true, true)
    .last();
}

export async function getLatestMetrics(): Promise<StoredOverviewMetrics[]> {
  const snapshots = await Promise.all(
    PLATFORM_IDS.map((platformId) => getLatestSnapshotForPlatform(platformId)),
  );

  return snapshots
    .filter((snapshot): snapshot is StoredMetricsSnapshot => snapshot !== undefined)
    .map(toOverviewMetrics);
}

export async function getExportData(): Promise<FinancialBackupPayload> {
  return sanitizeFinancialBackupPayload({
    overviewMetrics: await getLatestMetrics(),
    metricsHistory: await db.metricsHistory.toArray(),
    cashflows: await db.cashflows.toArray(),
    positions: await db.positions.toArray(),
    riskEvents: await db.riskEvents.toArray(),
    deltaLogs: await db.deltaLogs.toArray(),
  });
}

export async function createFinancialBackup(
  appVersion: string,
  exportedAt?: string,
): Promise<FinancialBackupV1> {
  return createFinancialBackupObject(
    await getExportData(),
    exportedAt === undefined ? { appVersion } : { appVersion, exportedAt },
  );
}

export async function listFinancialDataPlatformIds(): Promise<PlatformId[]> {
  const platformIds = new Set<PlatformId>();
  const keySets = await Promise.all([
    db.metricsHistory.orderBy("platformId").uniqueKeys(),
    db.cashflows.orderBy("platformId").uniqueKeys(),
    db.positions.orderBy("platformId").uniqueKeys(),
    db.riskEvents.orderBy("platformId").uniqueKeys(),
    db.deltaLogs.orderBy("platformId").uniqueKeys(),
  ]);

  for (const keys of keySets) {
    for (const key of keys) {
      if (typeof key === "string") platformIds.add(key as PlatformId);
    }
  }

  return PLATFORM_IDS.filter((platformId) => platformIds.has(platformId));
}

export async function upsertMetricsSnapshot(
  snapshot: StoredMetricsSnapshot,
): Promise<void> {
  await db.metricsHistory.put(snapshot);
}

export async function deleteMetricsSnapshot(
  platformId: PlatformId,
  date: string,
): Promise<void> {
  await db.metricsHistory.delete([platformId, date]);
}

export async function updateMetricsSnapshot(
  platformId: PlatformId,
  date: string,
  update: { platformValue: number; freeCash: number },
): Promise<void> {
  const existing = await db.metricsHistory.get([platformId, date]);
  if (!existing) {
    throw new Error("History entry not found");
  }
  // user-confirmed values clear the suspect flag
  const next: StoredMetricsSnapshot = {
    ...existing,
    ...update,
    confidence: 1,
  };
  delete next.warnings;
  await db.metricsHistory.put(next);
}

const DELTA_FIELDS: Array<{
  field: DeltaField;
  key: keyof Pick<
    OverviewMetrics,
    "platformValue" | "freeCash" | "netAnnualReturnPct"
  >;
}> = [
  { field: "platformValue", key: "platformValue" },
  { field: "freeCash", key: "freeCash" },
  { field: "netAnnualReturnPct", key: "netAnnualReturnPct" },
];

export async function detectAndStoreDelta(
  platformId: PlatformId,
  newMetrics: OverviewMetrics,
  timestamp: string,
  batchId?: number,
  previous?: Pick<
    OverviewMetrics,
    "platformValue" | "freeCash" | "netAnnualReturnPct"
  >,
): Promise<void> {
  for (const { field, key } of DELTA_FIELDS) {
    const newValue = newMetrics[key];
    if (newValue === undefined) continue;

    if (!previous) {
      await db.deltaLogs.add({
        platformId,
        timestamp,
        field,
        oldValue: newValue,
        newValue,
        delta: 0,
        ...(batchId === undefined ? {} : { batchId }),
      });
      continue;
    }

    const oldValue = previous[key];
    if (oldValue === undefined) continue;
    if (oldValue === newValue) continue;

    await db.deltaLogs.add({
      platformId,
      timestamp,
      field,
      oldValue,
      newValue,
      delta: newValue - oldValue,
      ...(batchId === undefined ? {} : { batchId }),
    });
  }
}

function hasSameOverviewMetrics(
  metrics: OverviewMetrics,
  overview: StoredOverviewMetrics,
): boolean {
  return (
    metrics.platformValue === overview.platformValue &&
    metrics.freeCash === overview.freeCash &&
    metrics.netAnnualReturnPct === overview.netAnnualReturnPct &&
    metrics.currency === overview.currency
  );
}

function hasSameSnapshotMetrics(
  metrics: OverviewMetrics,
  snapshot: StoredMetricsSnapshot,
): boolean {
  return (
    metrics.platformValue === snapshot.platformValue &&
    metrics.freeCash === snapshot.freeCash &&
    metrics.netAnnualReturnPct === snapshot.netAnnualReturnPct
  );
}

function isOverviewOnlyBatch(batch: StoredIngestionBatch): boolean {
  return (
    batch.cashflowCount === 0 &&
    batch.positionCount === 0 &&
    batch.riskEventCount === 0
  );
}

function platformBatchRange(platformId: PlatformId) {
  return {
    lower: [platformId, Dexie.minKey, Dexie.minKey],
    upper: [platformId, Dexie.maxKey, Dexie.maxKey],
  };
}

async function queryPlatformBatchesNewestFirst(
  platformId: PlatformId,
  limit?: number,
): Promise<StoredIngestionBatch[]> {
  const { lower, upper } = platformBatchRange(platformId);
  const collection = db.ingestionBatches
    .where("[platformId+appliedAt+id]")
    .between(lower, upper, true, true)
    .reverse();
  return limit === undefined
    ? collection.toArray()
    : collection.limit(limit).toArray();
}

async function findReplaceableSameDayBatch(
  platformId: PlatformId,
  snapshot: StoredMetricsSnapshot,
): Promise<StoredIngestionBatch | undefined> {
  const batches = await queryPlatformBatchesNewestFirst(platformId);
  return batches
    .filter(
      (batch) =>
        batch.id !== undefined &&
        batch.revertible &&
        !batch.legacyBackfilled &&
        isOverviewOnlyBatch(batch) &&
        batch.afterDailySnapshot?.date === snapshot.date &&
        batch.afterDailySnapshot.platformValue === snapshot.platformValue &&
        batch.afterDailySnapshot.freeCash === snapshot.freeCash &&
        batch.afterDailySnapshot.netAnnualReturnPct === snapshot.netAnnualReturnPct,
    )[0];
}

function toOverviewFromDeltaLogs(
  platformId: PlatformId,
  timestamp: string,
  logs: StoredDeltaLog[],
  valueKey: "oldValue" | "newValue",
): IngestionBatchOverview | undefined {
  if (logs.length === 0) return undefined;

  const overview: IngestionBatchOverview = {
    platformId,
    fetchedAt: timestamp,
    currency: "EUR",
    confidence: 0,
  };

  for (const log of logs) {
    if (log.field === "platformValue") overview.platformValue = log[valueKey];
    if (log.field === "freeCash") overview.freeCash = log[valueKey];
    if (log.field === "netAnnualReturnPct") {
      overview.netAnnualReturnPct = log[valueKey];
    }
  }

  return overview;
}

interface LegacyBatchHistoryTables {
  deltaLogs: Table<StoredDeltaLog, number>;
  ingestionBatches: Table<StoredIngestionBatch, number>;
}

async function backfillLegacyBatchHistory(
  platformId: PlatformId | undefined,
  tables: LegacyBatchHistoryTables = {
    deltaLogs: db.deltaLogs,
    ingestionBatches: db.ingestionBatches,
  },
): Promise<void> {
  const logs =
    platformId === undefined
      ? await tables.deltaLogs.toArray()
      : await tables.deltaLogs.where("platformId").equals(platformId).toArray();
  const unbatchedLogs = logs.filter((log) => log.batchId === undefined);

  if (unbatchedLogs.length === 0) {
    return;
  }

  const grouped = new Map<string, StoredDeltaLog[]>();
  for (const log of unbatchedLogs) {
    const key = `${log.platformId}\u0000${log.timestamp}`;
    const row = grouped.get(key) ?? [];
    row.push(log);
    grouped.set(key, row);
  }

  const groupKeys = [...grouped.keys()].sort((a, b) => a.localeCompare(b));

  const runBackfill = async () => {
    for (const key of groupKeys) {
      const group = grouped.get(key) ?? [];
      const firstLog = group[0];
      if (!firstLog) continue;
      const beforeOverview = toOverviewFromDeltaLogs(
        firstLog.platformId,
        firstLog.timestamp,
        group,
        "oldValue",
      );
      const afterOverview = toOverviewFromDeltaLogs(
        firstLog.platformId,
        firstLog.timestamp,
        group,
        "newValue",
      );
      const batchId = await tables.ingestionBatches.add({
        platformId: firstLog.platformId,
        sourceKind: "sync",
        appliedAt: firstLog.timestamp,
        revertible: false,
        legacyBackfilled: true,
        ...(beforeOverview ? { beforeOverview } : {}),
        ...(afterOverview ? { afterOverview } : {}),
        cashflowCount: 0,
        positionCount: 0,
        riskEventCount: 0,
      });

      for (const logEntry of group) {
        if (logEntry.id === undefined) continue;
        await tables.deltaLogs.update(logEntry.id, { batchId });
      }
    }
  };

  if (
    tables.deltaLogs === db.deltaLogs &&
    tables.ingestionBatches === db.ingestionBatches
  ) {
    await db.transaction("rw", [db.ingestionBatches, db.deltaLogs], runBackfill);
  } else {
    await runBackfill();
  }
}

export async function backfillLegacyBatchHistoryForMigration(
  platformId?: PlatformId,
): Promise<void> {
  await backfillLegacyBatchHistory(platformId);
}

// ─── Ingest connector result ──────────────────────────────────────────────────

export async function ingestConnectorResult(
  result: ConnectorSyncResult,
  options: IngestConnectorResultOptions = { sourceKind: "sync" },
): Promise<IngestConnectorResultOutcome> {
  const { platformId, fetchedAt } = result;

  return db.transaction(
    "rw",
    [
      db.metricsHistory,
      db.cashflows,
      db.positions,
      db.riskEvents,
      db.deltaLogs,
      db.ingestionBatches,
    ],
    async () => {
      const previousLatestSnapshot =
        await getLatestSnapshotForPlatform(platformId);
      const previousOverview =
        previousLatestSnapshot === undefined
          ? undefined
          : toOverviewMetrics(previousLatestSnapshot);
      const hasChildRecords =
        result.cashflows.length > 0 ||
        result.positions.length > 0 ||
        (result.riskEvents?.length ?? 0) > 0;
      const shouldCreateBatch = result.overviewMetrics !== undefined || hasChildRecords;
      const nextOverview =
        result.overviewMetrics === undefined
          ? undefined
          : {
              ...result.overviewMetrics,
              platformId,
              fetchedAt,
            };
      const nextSnapshot =
        result.overviewMetrics === undefined
          ? undefined
          : {
              platformId,
              date: fetchedAt.slice(0, 10),
              platformValue: result.overviewMetrics.platformValue,
              freeCash: result.overviewMetrics.freeCash,
              ...(result.overviewMetrics.netAnnualReturnPct === undefined
                ? {}
                : {
                    netAnnualReturnPct:
                      result.overviewMetrics.netAnnualReturnPct,
                  }),
              fetchedAt,
              currency: result.overviewMetrics.currency,
              confidence: result.overviewMetrics.confidence,
              ...(result.overviewMetrics.warnings &&
              result.overviewMetrics.warnings.length > 0
                ? { warnings: result.overviewMetrics.warnings }
                : {}),
            };
      const previousDailySnapshot =
        nextSnapshot === undefined
          ? undefined
          : await db.metricsHistory.get([
              platformId,
              nextSnapshot.date,
            ]);
      const shouldCollapseUnchangedSameDayOverview =
        result.overviewMetrics !== undefined &&
        nextOverview !== undefined &&
        nextSnapshot !== undefined &&
        previousOverview !== undefined &&
        previousDailySnapshot !== undefined &&
        !hasChildRecords &&
        hasSameOverviewMetrics(result.overviewMetrics, previousOverview) &&
        hasSameSnapshotMetrics(result.overviewMetrics, previousDailySnapshot);
      const replaceableSameDayBatch =
        shouldCollapseUnchangedSameDayOverview
          ? await findReplaceableSameDayBatch(
              platformId,
              previousDailySnapshot,
            )
          : undefined;

      if (replaceableSameDayBatch?.id !== undefined && nextOverview !== undefined && nextSnapshot !== undefined) {
        const batchId = replaceableSameDayBatch.id;
        const replacementRollback = {
          batch: replaceableSameDayBatch,
          ...(previousDailySnapshot === undefined
            ? {}
            : { previousDailySnapshot }),
        };

        await db.metricsHistory.put({
          ...nextSnapshot,
          batchId,
        });

        await db.ingestionBatches.update(batchId, {
          ...(options.runId ? { runId: options.runId } : {}),
          appliedAt: fetchedAt,
          afterOverview: nextOverview,
          afterDailySnapshot: {
            ...nextSnapshot,
            batchId,
          },
        });
        return {
          batchId,
          createdBatch: false,
          replacedExistingBatch: true,
          replacementRollback,
        };
      }

      const batchId =
        !shouldCreateBatch
          ? undefined
          : await db.ingestionBatches.add({
              platformId,
              sourceKind: options.sourceKind,
              ...(options.runId ? { runId: options.runId } : {}),
              appliedAt: fetchedAt,
              revertible: true,
              legacyBackfilled: false,
              ...(previousOverview && result.overviewMetrics
                ? { beforeOverview: previousOverview }
                : {}),
              ...(nextOverview ? { afterOverview: nextOverview } : {}),
              ...(previousDailySnapshot
                ? { beforeDailySnapshot: previousDailySnapshot }
                : {}),
              ...(nextSnapshot ? { afterDailySnapshot: { ...nextSnapshot } } : {}),
              cashflowCount: result.cashflows.length,
              positionCount: result.positions.length,
              riskEventCount: result.riskEvents?.length ?? 0,
            });

      if (result.overviewMetrics && nextOverview && nextSnapshot) {
        await detectAndStoreDelta(
          platformId,
          result.overviewMetrics,
          fetchedAt,
          batchId,
          previousLatestSnapshot,
        );
        await db.metricsHistory.put({
          ...nextSnapshot,
          ...(batchId === undefined ? {} : { batchId }),
        });
      }

      if (result.cashflows.length > 0) {
        await db.cashflows.bulkAdd(result.cashflows.map((cashflow) => ({
          ...cashflow,
          ...(batchId === undefined ? {} : { batchId }),
        })));
      }

      if (result.positions.length > 0) {
        await db.positions.bulkAdd(result.positions.map((position) => ({
          ...position,
          ...(batchId === undefined ? {} : { batchId }),
        })));
      }

      if (result.riskEvents && result.riskEvents.length > 0) {
        await db.riskEvents.bulkAdd(result.riskEvents.map((event) => ({
            ...event,
            recordedAt: fetchedAt,
            ...(batchId === undefined ? {} : { batchId }),
          })));
      }

      return {
        ...(batchId === undefined ? {} : { batchId }),
        createdBatch: batchId !== undefined,
        replacedExistingBatch: false,
      };
    },
  );
}

function getBackupPlatformIds(payload: FinancialBackupPayload): PlatformId[] {
  const platformIds = new Set<PlatformId>();
  for (const metric of payload.overviewMetrics) platformIds.add(metric.platformId);
  for (const snapshot of payload.metricsHistory) platformIds.add(snapshot.platformId);
  for (const cashflow of payload.cashflows) platformIds.add(cashflow.platformId);
  for (const position of payload.positions) platformIds.add(position.platformId);
  for (const event of payload.riskEvents) platformIds.add(event.platformId);
  for (const logEntry of payload.deltaLogs) platformIds.add(logEntry.platformId);
  return PLATFORM_IDS.filter((platformId) => platformIds.has(platformId));
}

function latestSnapshotForPlatform(
  payload: FinancialBackupPayload,
  platformId: PlatformId,
): StoredMetricsSnapshot | undefined {
  return payload.metricsHistory
    .filter((snapshot) => snapshot.platformId === platformId)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

function overviewForPlatform(
  payload: FinancialBackupPayload,
  platformId: PlatformId,
): StoredOverviewMetrics | undefined {
  return payload.overviewMetrics.find((metric) => metric.platformId === platformId);
}

export async function restoreFinancialBackup(
  backup: FinancialBackupV1,
  restoredAt = new Date().toISOString(),
): Promise<void> {
  const payload = sanitizeFinancialBackupPayload(backup.payload);
  const platformIds = getBackupPlatformIds(payload);

  await db.transaction(
    "rw",
    [
      db.metricsHistory,
      db.cashflows,
      db.positions,
      db.riskEvents,
      db.deltaLogs,
      db.ingestionBatches,
    ],
    async () => {
      await db.metricsHistory.clear();
      await db.cashflows.clear();
      await db.positions.clear();
      await db.riskEvents.clear();
      await db.deltaLogs.clear();
      await db.ingestionBatches.clear();

      const batchIds = new Map<PlatformId, number>();
      for (const platformId of platformIds) {
        const overview = overviewForPlatform(payload, platformId);
        const latestSnapshot = latestSnapshotForPlatform(payload, platformId);
        const batchId = await db.ingestionBatches.add({
          platformId,
          sourceKind: "restore",
          appliedAt: restoredAt,
          revertible: false,
          legacyBackfilled: false,
          ...(overview ? { afterOverview: overview } : {}),
          ...(latestSnapshot ? { afterDailySnapshot: latestSnapshot } : {}),
          cashflowCount: payload.cashflows.filter(
            (cashflow) => cashflow.platformId === platformId,
          ).length,
          positionCount: payload.positions.filter(
            (position) => position.platformId === platformId,
          ).length,
          riskEventCount: payload.riskEvents.filter(
            (event) => event.platformId === platformId,
          ).length,
        });
        batchIds.set(platformId, batchId);
      }

      if (payload.metricsHistory.length > 0) {
        await db.metricsHistory.bulkPut(
          payload.metricsHistory.map((snapshot) => {
            const batchId = batchIds.get(snapshot.platformId);
            return batchId === undefined ? snapshot : { ...snapshot, batchId };
          }),
        );
      }
      // Backups from versions that stored overview metrics separately may
      // carry a fresher overview row than any history snapshot.
      for (const overview of payload.overviewMetrics) {
        await mergeOverviewIntoHistory(
          overview,
          db.metricsHistory,
          batchIds.get(overview.platformId),
        );
      }
      if (payload.cashflows.length > 0) {
        await db.cashflows.bulkAdd(
          payload.cashflows.map((cashflow) => {
            const batchId = batchIds.get(cashflow.platformId);
            return batchId === undefined ? cashflow : { ...cashflow, batchId };
          }),
        );
      }
      if (payload.positions.length > 0) {
        await db.positions.bulkAdd(
          payload.positions.map((position) => {
            const batchId = batchIds.get(position.platformId);
            return batchId === undefined ? position : { ...position, batchId };
          }),
        );
      }
      if (payload.riskEvents.length > 0) {
        await db.riskEvents.bulkAdd(
          payload.riskEvents.map((event) => {
            const batchId = batchIds.get(event.platformId);
            return batchId === undefined ? event : { ...event, batchId };
          }),
        );
      }
      if (payload.deltaLogs.length > 0) {
        await db.deltaLogs.bulkAdd(
          payload.deltaLogs.map((logEntry) => {
            const batchId = batchIds.get(logEntry.platformId);
            return batchId === undefined ? logEntry : { ...logEntry, batchId };
          }),
        );
      }
    },
  );
}

// ─── Credentials ──────────────────────────────────────────────────────────────

export async function saveCredentials(
  credentials: StoredCredentials,
): Promise<void> {
  await db.credentials.put(credentials);
}

export async function getCredentials(
  platformId: PlatformId,
): Promise<StoredCredentials | undefined> {
  return db.credentials.get(platformId);
}

export async function deleteCredentials(platformId: PlatformId): Promise<void> {
  await db.credentials.delete(platformId);
}

export async function listCredentialPlatformIds(): Promise<PlatformId[]> {
  const all = await db.credentials.toArray();
  return all.map((c) => c.platformId);
}

export function toCredentialStatusEntry(
  credentials: StoredCredentials,
): CredentialStatusEntry {
  return {
    platformId: credentials.platformId,
    ...(credentials.safeModeEnabled === undefined
      ? {}
      : { safeModeEnabled: credentials.safeModeEnabled }),
    ...(credentials.stealthModeEnabled === undefined
      ? {}
      : { stealthModeEnabled: credentials.stealthModeEnabled }),
    ...(credentials.lastLoginError === undefined
      ? {}
      : { lastLoginError: credentials.lastLoginError }),
  };
}

export async function listCredentialStatus(): Promise<CredentialStatusEntry[]> {
  const all = await db.credentials.toArray();
  return all.map(toCredentialStatusEntry);
}

// ─── Selector profiles ────────────────────────────────────────────────────────

export async function learnSelector(profile: SelectorProfile): Promise<void> {
  const existing = await db.selectorProfiles.get([
    profile.platformId,
    profile.signalKey,
  ]);
  const source = profile.source ?? "user";
  if (source === "auto" && existing?.source === "user") return;

  await db.selectorProfiles.put({
    ...profile,
    source,
    learnedAt: existing?.learnedAt ?? profile.learnedAt,
    lastVerifiedAt: profile.lastVerifiedAt ?? new Date().toISOString(),
    failureCount: 0,
  });
}

export async function getSelectorProfiles(
  platformId: PlatformId,
): Promise<SelectorProfile[]> {
  return db.selectorProfiles
    .where("[platformId+signalKey]")
    .between([platformId, Dexie.minKey], [platformId, Dexie.maxKey])
    // A profile the user picked explicitly is never dropped for failures — it
    // only disappears when the user resets it or picks a different value.
    .filter(
      (profile) =>
        (profile.source ?? "user") === "user" || (profile.failureCount ?? 0) < 3,
    )
    .toArray();
}

export async function resetSelectorProfiles(platformId: PlatformId): Promise<void> {
  await db.selectorProfiles
    .where("[platformId+signalKey]")
    .between([platformId, Dexie.minKey], [platformId, Dexie.maxKey])
    .delete();
}

export async function deleteSelectorProfile(
  platformId: PlatformId,
  signalKey: ExtractionChoiceSignalKey,
): Promise<void> {
  await db.selectorProfiles.delete([platformId, signalKey]);
}

export async function markSelectorFailure(
  platformId: PlatformId,
  signalKey: ExtractionChoiceSignalKey,
): Promise<void> {
  const profile = await db.selectorProfiles.get([platformId, signalKey]);
  if (!profile) return;
  const failureCount = (profile.failureCount ?? 0) + 1;
  if ((profile.source ?? "user") === "auto" && failureCount >= 3) {
    await db.selectorProfiles.delete([platformId, signalKey]);
    return;
  }
  await db.selectorProfiles.update([platformId, signalKey], { failureCount });
}

// ─── Navigation profiles ──────────────────────────────────────────────────────

const NAVIGATION_FAILURE_LIMIT = 3;

export async function learnNavigationProfile(
  profile: NavigationProfile,
): Promise<void> {
  const existing = await db.navigationProfiles.get(profile.platformId);
  const source = profile.source ?? "auto";
  // A page the user implicitly confirmed (by picking a value on it) outranks an
  // automatic guess — unless it has been failing, in which case anything that
  // currently works is better than a URL we know is stale.
  if (
    source === "auto" &&
    existing?.source === "user" &&
    (existing.failureCount ?? 0) < NAVIGATION_FAILURE_LIMIT
  ) {
    return;
  }

  await db.navigationProfiles.put({
    ...profile,
    source,
    learnedAt: existing?.learnedAt ?? profile.learnedAt,
    lastVerifiedAt: profile.lastVerifiedAt ?? new Date().toISOString(),
    failureCount: 0,
  });
}

export async function getNavigationProfile(
  platformId: PlatformId,
): Promise<NavigationProfile | undefined> {
  return db.navigationProfiles.get(platformId);
}

export async function deleteNavigationProfile(
  platformId: PlatformId,
): Promise<void> {
  await db.navigationProfiles.delete(platformId);
}

/**
 * Unlike selector profiles, a stale URL is dropped regardless of source: it is
 * invisible to the user, so there is no way for them to clear it themselves.
 */
export async function markNavigationFailure(
  platformId: PlatformId,
): Promise<void> {
  const profile = await db.navigationProfiles.get(platformId);
  if (!profile) return;
  const failureCount = (profile.failureCount ?? 0) + 1;
  if (failureCount >= NAVIGATION_FAILURE_LIMIT) {
    await db.navigationProfiles.delete(platformId);
    return;
  }
  await db.navigationProfiles.update(platformId, { failureCount });
}

export async function learnLoginSelectors(
  platformId: PlatformId,
  profiles: LoginSelectorProfile[],
): Promise<void> {
  const verifiedAt = new Date().toISOString();
  await db.transaction("rw", db.loginSelectorProfiles, async () => {
    for (const profile of profiles) {
      if (profile.platformId !== platformId) continue;
      const existing = await db.loginSelectorProfiles.get([
        profile.platformId,
        profile.fieldRole,
      ]);
      await db.loginSelectorProfiles.put({
        ...profile,
        learnedAt: existing?.learnedAt ?? profile.learnedAt,
        lastVerifiedAt: verifiedAt,
        failureCount: 0,
      });
    }
  });
}

export async function getLoginSelectorProfiles(
  platformId: PlatformId,
): Promise<LoginSelectorProfile[]> {
  return db.loginSelectorProfiles
    .where("[platformId+fieldRole]")
    .between([platformId, Dexie.minKey], [platformId, Dexie.maxKey])
    .filter((profile) => profile.failureCount < 2)
    .toArray();
}

export async function markLoginSelectorFailures(
  platformId: PlatformId,
  fieldRoles: LoginFieldRole[],
): Promise<void> {
  const uniqueRoles = [...new Set(fieldRoles)];
  await db.transaction("rw", db.loginSelectorProfiles, async () => {
    for (const fieldRole of uniqueRoles) {
      const existing = await db.loginSelectorProfiles.get([platformId, fieldRole]);
      if (!existing) continue;
      await db.loginSelectorProfiles.put({
        ...existing,
        failureCount: existing.failureCount + 1,
      });
    }
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_ID = "global";

export function createDefaultSettings(): AppSettings & { id: string } {
  return {
    id: SETTINGS_ID,
    privacyModeEnabled: false,
    stealthModeEnabled: false,
    debugModeEnabled: false,
    parallelSyncEnabled: false,
    showTwoFactorManualActionDialog: false,
    showLowConfidenceMetricsInPopup: true,
    disabledPlatformIds: [],
    language: "en",
    syncReminderDays: 7,
    autoLockEnabled: true,
    sessionTimeoutMinutes: 15,
    historyRetentionDays: 0,
    geminiActivationBannerDismissed: false,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const stored = await db.settings.get(SETTINGS_ID) as LegacySettingsRecord | undefined;
  const defaults = createDefaultSettings();
  if (!stored) return defaults;

  const sanitized = stripLegacySettingsFields(stored);
  const normalized = {
    ...sanitized,
    ...normalizeAutoLockSettings(stored),
  };
  if (
    "lastUsedCredentialEmail" in stored ||
    typeof stored.autoLockEnabled !== "boolean" ||
    !isAutoLockTimeoutMinutes(stored.sessionTimeoutMinutes)
  ) {
    await db.settings.put({ ...defaults, ...normalized });
  }

  return { ...defaults, ...normalized };
}

export async function saveSettings(
  settings: Partial<AppSettings>,
): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...settings, id: SETTINGS_ID });
}

// ─── Historical metrics for chart ─────────────────────────────────────────────

export async function getMetricsHistory(
  platformId: PlatformId,
  limit = 90,
): Promise<StoredMetricsSnapshot[]> {
  return db.metricsHistory
    .where("platformId")
    .equals(platformId)
    .reverse()
    .limit(limit)
    .toArray();
}

export async function logExtractionTelemetry(
  record: ExtractionTelemetryRecord,
): Promise<void> {
  await db.extractionTelemetry.add(record);
}

export async function getExtractionTelemetry(
  platformId: PlatformId,
  limit = 100,
): Promise<ExtractionTelemetryRecord[]> {
  return db.extractionTelemetry
    .where("[platformId+recordedAt+id]")
    .between(
      [platformId, Dexie.minKey, Dexie.minKey],
      [platformId, Dexie.maxKey, Dexie.maxKey],
      true,
      true,
    )
    .reverse()
    .limit(limit)
    .toArray();
}

// ─── Analytics query helpers ──────────────────────────────────────────────────

export interface MetricsHistoryWindow {
  snapshots: StoredMetricsSnapshot[];
  cutoffDate?: string;
}

export async function getMetricsHistoryAll(
  days = 90,
  platformIds?: PlatformId[],
): Promise<MetricsHistoryWindow> {
  const isUnlimited = days <= 0 || !Number.isFinite(days);
  const cutoffDate = isUnlimited ? undefined : metricsHistoryCutoff(days);

  if (platformIds && platformIds.length === 0) {
    return cutoffDate ? { snapshots: [], cutoffDate } : { snapshots: [] };
  }

  const allowedPlatformIds = platformIds ? new Set(platformIds) : null;
  if (isUnlimited) {
    const snapshots = await db.metricsHistory.orderBy("date").toArray();
    return {
      snapshots: sortMetricsHistory(
        snapshots.filter(
          (snapshot) =>
            allowedPlatformIds === null ||
            allowedPlatformIds.has(snapshot.platformId),
        ),
      ),
    };
  }

  const windowSnapshots = await db.metricsHistory
    .where("date")
    .aboveOrEqual(cutoffDate!)
    .toArray();
  const seedPlatformIds = allowedPlatformIds
    ? [...allowedPlatformIds]
    : (await db.metricsHistory.orderBy("platformId").uniqueKeys()).filter(
        (key): key is PlatformId => typeof key === "string",
      );
  const seeds = await Promise.all(
    seedPlatformIds.map((platformId) =>
      db.metricsHistory
        .where("[platformId+date]")
        .between(
          [platformId, Dexie.minKey],
          [platformId, cutoffDate!],
          true,
          false,
        )
        .last(),
    ),
  );

  const filteredWindowSnapshots = windowSnapshots.filter(
    (snapshot) =>
      allowedPlatformIds === null ||
      allowedPlatformIds.has(snapshot.platformId),
  );

  return {
    cutoffDate: cutoffDate!,
    snapshots: sortMetricsHistory([
      ...seeds.filter(
        (snapshot): snapshot is StoredMetricsSnapshot => snapshot !== undefined,
      ),
      ...filteredWindowSnapshots,
    ]),
  };
}

function sortMetricsHistory(
  snapshots: StoredMetricsSnapshot[],
): StoredMetricsSnapshot[] {
  return snapshots.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.fetchedAt.localeCompare(b.fetchedAt),
  );
}

function metricsHistoryCutoff(days: number): string {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return cutoff.toISOString().slice(0, 10);
}

export async function getPlatformAllocation(
  platformIds?: PlatformId[],
): Promise<Array<{ platformId: PlatformId; name: string; totalValue: number }>> {
  const allowedPlatformIds = platformIds ? new Set(platformIds) : null;
  const metrics = await getLatestMetrics();
  return metrics
    .filter(
      (m) =>
        m.platformValue > 0 &&
        (allowedPlatformIds === null || allowedPlatformIds.has(m.platformId)),
    )
    .map((m) => ({
      platformId: m.platformId,
      name: getPlatformById(m.platformId)?.name ?? m.platformId,
      totalValue: m.platformValue,
    }));
}

export async function getCashflowSummary(
  months = 12,
  platformIds?: PlatformId[],
): Promise<
  Array<{ period: string; interestEur: number; netContributionEur: number }>
> {
  const allowedPlatformIds = platformIds ? new Set(platformIds) : null;
  const latest = await db.cashflows.orderBy("date").reverse().first();
  if (!latest) return [];
  const latestMonth = latest.date.slice(0, 7);
  const [latestYear, latestMonthNumber] = latestMonth.split("-").map(Number);
  if (latestYear === undefined || latestMonthNumber === undefined) return [];
  const cutoffDate = new Date(Date.UTC(latestYear, latestMonthNumber - months, 1));
  const cutoff = `${cutoffDate.getUTCFullYear()}-${String(
    cutoffDate.getUTCMonth() + 1,
  ).padStart(2, "0")}-01`;
  const all = await db.cashflows.where("date").aboveOrEqual(cutoff).toArray();
  const grouped = new Map<string, { interest: number; net: number }>();

  for (const cf of all) {
    if (allowedPlatformIds !== null && !allowedPlatformIds.has(cf.platformId)) {
      continue;
    }
    const period = cf.date.slice(0, 7); // YYYY-MM
    const entry = grouped.get(period) ?? { interest: 0, net: 0 };
    if (cf.type === "interest_paid" || cf.type === "interest_accrued") {
      entry.interest += cf.amount;
    } else if (cf.type === "deposit") {
      entry.net += cf.amount;
    } else if (cf.type === "withdrawal") {
      entry.net -= Math.abs(cf.amount);
    }
    grouped.set(period, entry);
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-months)
    .map(([period, { interest, net }]) => ({
      period,
      interestEur: Number(interest.toFixed(2)),
      netContributionEur: Number(net.toFixed(2)),
    }));
}

export async function getRiskEventSummary(): Promise<{
  graceEur: number;
  defaultEur: number;
}> {
  const events = await db.riskEvents.toArray();
  let graceEur = 0;
  let defaultEur = 0;
  for (const e of events) {
    if (e.status === "grace") graceEur += e.amountEur;
    else if (e.status === "default") defaultEur += e.amountEur;
  }
  return { graceEur, defaultEur };
}

// ─── Delta / Audit Log ──────────────────────────────────────────────────────

export async function getDeltaLogs(
  platformId: PlatformId,
  limit = 20,
): Promise<StoredDeltaLog[]> {
  const logs = await db.deltaLogs
    .where("platformId")
    .equals(platformId)
    .toArray();
  return logs
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

export async function clearDeltaLogs(platformId: PlatformId): Promise<void> {
  await db.deltaLogs.where("platformId").equals(platformId).delete();
}

export async function deleteDeltaLog(id: number): Promise<void> {
  await db.deltaLogs.delete(id);
}

// ─── Batch history / undo ────────────────────────────────────────────────────

export async function getPlatformBatchHistory(
  platformId: PlatformId,
  limit = 20,
): Promise<StoredIngestionBatch[]> {
  return queryPlatformBatchesNewestFirst(platformId, limit);
}

export async function revertPlatformBatch(
  platformId: PlatformId,
  batchId: number,
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.ingestionBatches,
      db.metricsHistory,
      db.cashflows,
      db.positions,
      db.riskEvents,
      db.deltaLogs,
    ],
    async () => {
      const [latest] = await queryPlatformBatchesNewestFirst(platformId, 1);

      if (!latest || latest.id !== batchId) {
        throw new Error("Only the latest import can be reverted");
      }
      if (latest.platformId !== platformId) {
        throw new Error("Batch does not belong to the requested platform");
      }
      if (!latest.revertible || latest.legacyBackfilled) {
        throw new Error("This import can no longer be reverted");
      }

      // Restores the pre-import snapshot wholesale: a manual edit of the
      // imported row is intentionally overwritten by reverting the import.
      if (latest.afterDailySnapshot) {
        await db.metricsHistory.delete([
          platformId,
          latest.afterDailySnapshot.date,
        ]);
      }
      if (latest.beforeDailySnapshot) {
        await db.metricsHistory.put(latest.beforeDailySnapshot);
      }

      await db.cashflows.where("batchId").equals(batchId).delete();
      await db.positions.where("batchId").equals(batchId).delete();
      await db.riskEvents.where("batchId").equals(batchId).delete();
      await db.deltaLogs.where("batchId").equals(batchId).delete();
      await db.ingestionBatches.delete(batchId);
    },
  );
}

export async function revertReplacedIngestionBatch(
  platformId: PlatformId,
  rollback: NonNullable<IngestConnectorResultOutcome["replacementRollback"]>,
): Promise<void> {
  await db.transaction(
    "rw",
    [
      db.ingestionBatches,
      db.metricsHistory,
    ],
    async () => {
      const batchId = rollback.batch.id;
      if (batchId === undefined) {
        throw new Error("Replacement rollback batch has no id");
      }

      const [latest] = await queryPlatformBatchesNewestFirst(platformId, 1);
      if (!latest || latest.id !== batchId) {
        throw new Error("Only the latest replacement can be reverted");
      }
      if (latest.platformId !== platformId || rollback.batch.platformId !== platformId) {
        throw new Error("Batch does not belong to the requested platform");
      }

      if (latest.afterDailySnapshot) {
        await db.metricsHistory.delete([
          platformId,
          latest.afterDailySnapshot.date,
        ]);
      }
      if (rollback.previousDailySnapshot) {
        await db.metricsHistory.put(rollback.previousDailySnapshot);
      }

      await db.ingestionBatches.put(rollback.batch);
    },
  );
}

// ─── Calculated metrics ──────────────────────────────────────────────────────

export async function calculateNetAnnualReturn(
  platformId: PlatformId,
): Promise<number | null> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 365);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const interestCashflows = await db.cashflows
    .where("platformId")
    .equals(platformId)
    .filter(
      (cf) =>
        cf.date >= cutoffStr &&
        (cf.type === "interest_paid" || cf.type === "interest_accrued"),
    )
    .toArray();

  const latestSnapshot = await getLatestSnapshotForPlatform(platformId);
  const latestMetrics =
    latestSnapshot === undefined ? undefined : toOverviewMetrics(latestSnapshot);
  return calculateNetAnnualReturnFromSnapshots({
    cashflows: interestCashflows,
    latestMetrics,
  });
}

// ─── Data retention / cleanup ────────────────────────────────────────────────

export async function pruneOldData(historyRetentionDays = 0): Promise<void> {
  const telemetryCutoff = new Date();
  telemetryCutoff.setDate(telemetryCutoff.getDate() - 365);
  const telemetryCutoffIso = telemetryCutoff.toISOString();

  await db.transaction("rw", [db.metricsHistory, db.deltaLogs, db.extractionTelemetry], async () => {
    if (historyRetentionDays > 0) {
      const historyCutoff = new Date();
      historyCutoff.setDate(historyCutoff.getDate() - historyRetentionDays);
      const historyCutoffStr = historyCutoff.toISOString().slice(0, 10); // YYYY-MM-DD

      // metricsHistory is the source of current values — always keep the
      // newest snapshot per platform, even when it falls outside retention.
      const platformKeys = await db.metricsHistory.orderBy("platformId").uniqueKeys();
      const latestDates = new Map<string, string>();
      for (const key of platformKeys) {
        if (typeof key !== "string") continue;
        const latest = await getLatestSnapshotForPlatform(key as PlatformId);
        if (latest) latestDates.set(key, latest.date);
      }
      await db.metricsHistory
        .where("date")
        .below(historyCutoffStr)
        .filter((snapshot) => latestDates.get(snapshot.platformId) !== snapshot.date)
        .delete();
    }
    await db.deltaLogs.where("timestamp").below(telemetryCutoffIso).delete();
    await db.extractionTelemetry
      .where("recordedAt")
      .below(telemetryCutoffIso)
      .delete();
  });
}
