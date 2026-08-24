import type {
  FinancialBackupPayload,
  FinancialBackupV1,
  PlatformId,
  StoredOverviewMetrics,
} from "./types/index.js";
import { getPlatformById } from "./platforms/index.js";

type FinancialBackupMetricsSnapshot = FinancialBackupPayload["metricsHistory"][number];
type FinancialBackupCashflow = FinancialBackupPayload["cashflows"][number];
type FinancialBackupPosition = FinancialBackupPayload["positions"][number];
type FinancialBackupRiskEvent = FinancialBackupPayload["riskEvents"][number];
type FinancialBackupDeltaLog = FinancialBackupPayload["deltaLogs"][number];

export const FINANCIAL_BACKUP_FORMAT =
  "p2p-portfolio-tracker-financial-backup" as const;

const CSV_HEADERS = [
  "Platform ID",
  "Platform Name",
  "Fetched At",
  "Portfolio Value",
  "Free Cash",
  "Net Annual Return %",
  "Currency",
] as const;

interface CsvOptions {
  platformNameById?: (platformId: PlatformId) => string | undefined;
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

function optionalNumber(value: number | undefined): number | undefined {
  return value === undefined ? undefined : value;
}

function platformName(platformId: PlatformId, options?: CsvOptions): string {
  return options?.platformNameById?.(platformId) ?? getPlatformById(platformId)?.name ?? platformId;
}

export function serializeOverviewMetricsCsv(
  metrics: StoredOverviewMetrics[],
  options?: CsvOptions,
): string {
  const rows = metrics.map((metric) => [
    metric.platformId,
    platformName(metric.platformId, options),
    metric.fetchedAt,
    metric.platformValue,
    metric.freeCash,
    optionalNumber(metric.netAnnualReturnPct),
    metric.currency,
  ]);

  return [
    CSV_HEADERS.join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
    "",
  ].join("\n");
}

function sanitizeOverviewMetric(metric: StoredOverviewMetrics): StoredOverviewMetrics {
  return {
    platformId: metric.platformId,
    fetchedAt: metric.fetchedAt,
    platformValue: metric.platformValue,
    freeCash: metric.freeCash,
    ...(metric.netAnnualReturnPct === undefined
      ? {}
      : { netAnnualReturnPct: metric.netAnnualReturnPct }),
    currency: metric.currency,
    confidence: metric.confidence,
    ...(metric.warnings && metric.warnings.length > 0
      ? { warnings: metric.warnings }
      : {}),
  };
}

function sanitizeMetricsSnapshot(
  snapshot: FinancialBackupMetricsSnapshot,
): FinancialBackupMetricsSnapshot {
  return {
    platformId: snapshot.platformId,
    date: snapshot.date,
    platformValue: snapshot.platformValue,
    freeCash: snapshot.freeCash,
    ...(snapshot.netAnnualReturnPct === undefined
      ? {}
      : { netAnnualReturnPct: snapshot.netAnnualReturnPct }),
    fetchedAt: snapshot.fetchedAt,
    ...(snapshot.currency === undefined ? {} : { currency: snapshot.currency }),
    ...(snapshot.confidence === undefined ? {} : { confidence: snapshot.confidence }),
    ...(snapshot.warnings && snapshot.warnings.length > 0
      ? { warnings: snapshot.warnings }
      : {}),
  };
}

function sanitizeCashflow(cashflow: FinancialBackupCashflow): FinancialBackupCashflow {
  return {
    platformId: cashflow.platformId,
    date: cashflow.date,
    amount: cashflow.amount,
    currency: cashflow.currency,
    ...(cashflow.eurRate === undefined ? {} : { eurRate: cashflow.eurRate }),
    type: cashflow.type,
    ...(cashflow.instrumentId === undefined
      ? {}
      : { instrumentId: cashflow.instrumentId }),
    taxCategory: cashflow.taxCategory,
  };
}

function sanitizePosition(position: FinancialBackupPosition): FinancialBackupPosition {
  return {
    platformId: position.platformId,
    instrumentId: position.instrumentId,
    ...(position.label === undefined ? {} : { label: position.label }),
    ...(position.country === undefined ? {} : { country: position.country }),
    ...(position.assetClass === undefined ? {} : { assetClass: position.assetClass }),
    ...(position.riskClass === undefined ? {} : { riskClass: position.riskClass }),
    value: position.value,
    currency: position.currency,
    ...(position.eurRate === undefined ? {} : { eurRate: position.eurRate }),
    date: position.date,
  };
}

function sanitizeRiskEvent(event: FinancialBackupRiskEvent): FinancialBackupRiskEvent {
  return {
    platformId: event.platformId,
    ...(event.loanId === undefined ? {} : { loanId: event.loanId }),
    status: event.status,
    amountEur: event.amountEur,
    since: event.since,
    recordedAt: event.recordedAt,
  };
}

function sanitizeDeltaLog(log: FinancialBackupDeltaLog): FinancialBackupDeltaLog {
  return {
    platformId: log.platformId,
    timestamp: log.timestamp,
    field: log.field,
    oldValue: log.oldValue,
    newValue: log.newValue,
    delta: log.delta,
  };
}

export function sanitizeFinancialBackupPayload(
  payload: FinancialBackupPayload,
): FinancialBackupPayload {
  return {
    overviewMetrics: payload.overviewMetrics.map(sanitizeOverviewMetric),
    metricsHistory: payload.metricsHistory.map(sanitizeMetricsSnapshot),
    cashflows: payload.cashflows.map(sanitizeCashflow),
    positions: payload.positions.map(sanitizePosition),
    riskEvents: payload.riskEvents.map(sanitizeRiskEvent),
    deltaLogs: payload.deltaLogs.map(sanitizeDeltaLog),
  };
}

export function createFinancialBackupObject(
  payload: FinancialBackupPayload,
  options: { appVersion: string; exportedAt?: string },
): FinancialBackupV1 {
  return {
    format: FINANCIAL_BACKUP_FORMAT,
    version: 1,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    appVersion: options.appVersion,
    payload: sanitizeFinancialBackupPayload(payload),
  };
}
