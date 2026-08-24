import { z } from "zod";
import {
  PLATFORM_IDS,
  type AppSettings,
  type PlatformModeOverrides,
} from "./types/index.js";
import type { ProxyAiPromptMessage } from "./messages.js";

// ─── Shared Base Schemas ─────────────────────────────────────────────────────

export const PlatformIdSchema = z.enum(PLATFORM_IDS);

function stripUndefinedValues<T extends Record<string, unknown>>(
  value: T,
): Partial<{ [K in keyof T]: Exclude<T[K], undefined> }> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<{ [K in keyof T]: Exclude<T[K], undefined> }>;
}

const AppSettingsBaseSchema = z.object({
  privacyModeEnabled: z.boolean(),
  stealthModeEnabled: z.boolean(),
  debugModeEnabled: z.boolean(),
  parallelSyncEnabled: z.boolean(),
  showTwoFactorManualActionDialog: z.boolean(),
  showLowConfidenceMetricsInPopup: z.boolean(),
  disabledPlatformIds: z.array(PlatformIdSchema),
  language: z.enum(["de", "en", "nl", "fr", "it", "es"]),
  syncReminderDays: z.number().int().min(1).max(365),
  autoLockEnabled: z.boolean(),
  sessionTimeoutMinutes: z.union([
    z.literal(5),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]),
  historyRetentionDays: z.number().int().min(0).max(3650),
  geminiActivationBannerDismissed: z.boolean(),
}).strict();

export const AppSettingsSchema: z.ZodType<Partial<AppSettings>> =
  AppSettingsBaseSchema.partial().transform((settings) =>
    stripUndefinedValues(settings),
  );

// ─── Background Message Payloads ─────────────────────────────────────────────

export const SaveSettingsPayloadSchema = AppSettingsSchema;

export const SaveCredentialsPayloadSchema = z.object({
  platformId: PlatformIdSchema,
  credentials: z.object({
    username: z.string().min(1).max(255),
    password: z.string().min(1).max(1024),
  }).strict(),
  config: z.object({
    safeModeEnabled: z.boolean().optional(),
    stealthModeEnabled: z.boolean().optional(),
  }).strict().optional(),
}).strict();

export const PlatformModeOverridesSchema: z.ZodType<PlatformModeOverrides> = z.object({
  safeModeEnabled: z.boolean().optional(),
  stealthModeEnabled: z.boolean().optional(),
}).strict().transform((config) => stripUndefinedValues(config)).refine(
  (config) =>
    config.safeModeEnabled !== undefined ||
    config.stealthModeEnabled !== undefined,
  "At least one platform mode override is required",
);

export const UpdatePlatformModesPayloadSchema = z.object({
  platformId: PlatformIdSchema,
  config: PlatformModeOverridesSchema,
}).strict();

export const DeleteCredentialsPayloadSchema = z.object({
  platformId: PlatformIdSchema,
}).strict();

export const ResetPlatformSelectorsPayloadSchema = z.object({
  platformId: PlatformIdSchema,
  signalKey: z.enum(["portfolio_value", "free_cash"]).optional(),
}).strict();

export const GetSelectorProfilesPayloadSchema = z.object({
  platformId: PlatformIdSchema,
}).strict();

export const GetCredentialEditPrefillPayloadSchema = z.object({
  platformId: PlatformIdSchema,
}).strict();

export const StartSyncPayloadSchema = z.object({
  platformIds: z.array(PlatformIdSchema).optional(),
  forceExtractionChoiceForSignals: z
    .array(z.enum(["portfolio_value", "free_cash"]))
    .optional(),
}).strict();

export const SetupMasterPasswordPayloadSchema = z.object({
  password: z.string().min(1).max(1024),
}).strict();

export const UnlockPayloadSchema = z.object({
  password: z.string().max(1024),
}).strict();

export const CancelSyncPlatformPayloadSchema = z.object({
  platformId: PlatformIdSchema,
}).strict();

export const GetPlatformBatchHistoryPayloadSchema = z.object({
  platformId: PlatformIdSchema,
}).strict();

export const GetMetricsHistoryPayloadSchema = z.object({
  platformId: PlatformIdSchema,
  limit: z.number().int().min(1).max(1000).optional(),
}).strict();

export const UpdateMetricsSnapshotPayloadSchema = z.object({
  platformId: PlatformIdSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  platformValue: z.number().finite(),
  freeCash: z.number().finite(),
}).strict();

export const DeleteMetricsSnapshotPayloadSchema = z.object({
  platformId: PlatformIdSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict();

export const RevertPlatformBatchPayloadSchema = z.object({
  platformId: PlatformIdSchema,
  batchId: z.number().int().positive(),
}).strict();

export const ResolveExtractionChoicePayloadSchema = z.object({
  requestId: z.string().min(1).max(100),
  candidateId: z.string().min(1).max(2000),
}).strict();

export const ResolveManualActionPayloadSchema = z.object({
  requestId: z.string().min(1).max(100),
  code: z.string().max(100).optional(),
  actionType: z.enum(["captcha", "2fa"]),
  force: z.boolean().optional(),
}).strict();

export const ValidateFinancialBackupPayloadSchema = z.object({
  backup: z.unknown(),
}).strict();

const ProxyAiPromptOptionsSchema: z.ZodType<
  NonNullable<ProxyAiPromptMessage["payload"]["options"]>
> = z.object({
  responseConstraint: z.record(z.string(), z.unknown()).optional(),
}).strict().transform((options) =>
  options.responseConstraint === undefined
    ? {}
    : { responseConstraint: options.responseConstraint },
);

export const ProxyAiPromptPayloadSchema: z.ZodType<
  ProxyAiPromptMessage["payload"]
> = z.object({
  systemPrompt: z.string().min(1).max(20_000),
  examples: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(20_000),
    }).strict(),
  ).max(20),
  input: z.string().min(1).max(100_000),
  options: ProxyAiPromptOptionsSchema.optional(),
}).strict().transform(({ systemPrompt, examples, input, options }) =>
  options === undefined
    ? { systemPrompt, examples, input }
    : { systemPrompt, examples, input, options },
);

// ─── DB Proxy Message Payloads ────────────────────────────────────────────────

export const DbSaveSettingsPayloadSchema: z.ZodType<{
  settings: Partial<AppSettings>;
}> = z.object({
  settings: AppSettingsSchema,
}).strict();

const IsoStringSchema = z.string().min(1).max(100);
const CurrencySchema = z.string().min(1).max(10);

const StoredMetricsSnapshotSchema = z.object({
  platformId: PlatformIdSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  platformValue: z.number().finite(),
  freeCash: z.number().finite(),
  netAnnualReturnPct: z.number().finite().optional(),
  fetchedAt: IsoStringSchema,
  batchId: z.number().int().positive().optional(),
  currency: CurrencySchema.optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  warnings: z.array(z.string().max(2000)).optional(),
}).strict();

const IngestionBatchOverviewSchema = z.object({
  platformId: PlatformIdSchema,
  platformValue: z.number().finite().optional(),
  freeCash: z.number().finite().optional(),
  netAnnualReturnPct: z.number().finite().optional(),
  currency: CurrencySchema.optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  fetchedAt: IsoStringSchema,
}).strict();

const StoredIngestionBatchSchema = z.object({
  id: z.number().int().positive().optional(),
  platformId: PlatformIdSchema,
  sourceKind: z.enum(["sync", "restore"]),
  runId: z.string().min(1).max(100).optional(),
  appliedAt: IsoStringSchema,
  revertible: z.boolean(),
  legacyBackfilled: z.boolean(),
  beforeOverview: IngestionBatchOverviewSchema.optional(),
  afterOverview: IngestionBatchOverviewSchema.optional(),
  beforeDailySnapshot: StoredMetricsSnapshotSchema.optional(),
  afterDailySnapshot: StoredMetricsSnapshotSchema.optional(),
  cashflowCount: z.number().int().min(0).max(1000000),
  positionCount: z.number().int().min(0).max(1000000),
  riskEventCount: z.number().int().min(0).max(1000000),
}).strict();

export const RevertReplacedIngestionBatchPayloadSchema = z.object({
  platformId: PlatformIdSchema,
  rollback: z.object({
    batch: StoredIngestionBatchSchema,
    previousDailySnapshot: StoredMetricsSnapshotSchema.optional(),
  }).strict(),
}).strict();

const SyncRunStateSchema = z.enum([
  "queued",
  "running",
  "paused_2fa",
  "paused_security_challenge",
  "completed",
  "failed",
  "cancelled",
]);

const PlatformSyncStateSchema = z.enum([
  "pending",
  "running",
  "success",
  "failed_login",
  "failed_2fa",
  "failed_captcha",
  "failed_timeout",
  "failed_extract",
  "cancelled",
]);

const EncryptedBlobSchema = z.object({
  iv: z.string().min(1).max(1000),
  ciphertext: z.string().min(1).max(200_000),
}).strict();

const StoredCredentialsSchema = z.object({
  platformId: PlatformIdSchema,
  encryptedUsername: EncryptedBlobSchema,
  encryptedPassword: EncryptedBlobSchema,
  createdAt: IsoStringSchema,
  updatedAt: IsoStringSchema,
  safeModeEnabled: z.boolean().optional(),
  stealthModeEnabled: z.boolean().optional(),
  consecutiveLoginFailureCount: z.number().int().min(0).max(2).optional(),
  lastLoginError: z.string().min(1).max(500).optional(),
}).strict();

const FinancialSignalKeySchema = z.enum([
  "portfolio_value",
  "free_cash",
  "net_annual_return",
]);

const SelectorProfileSchema = z.object({
  platformId: PlatformIdSchema,
  signalKey: FinancialSignalKeySchema,
  selector: z.string().min(1).max(1000),
  fingerprint: z.string().min(1).max(2000).optional(),
  confidence: z.number().finite().min(0).max(1),
  source: z.enum(["user", "auto"]).optional(),
  learnedAt: IsoStringSchema,
  lastVerifiedAt: IsoStringSchema.optional(),
  failureCount: z.number().int().min(0).max(1000).optional(),
}).strict();

const NavigationProfileSchema = z.object({
  platformId: PlatformIdSchema,
  url: z.string().url().max(2000),
  source: z.enum(["user", "auto"]),
  confidence: z.number().finite().min(0).max(1),
  learnedAt: IsoStringSchema,
  lastVerifiedAt: IsoStringSchema.optional(),
  failureCount: z.number().int().min(0).max(1000).optional(),
}).strict();

const LoginFieldRoleSchema = z.enum(["username", "password", "submit", "otp"]);

const LoginSelectorProfileSchema = z.object({
  platformId: PlatformIdSchema,
  fieldRole: LoginFieldRoleSchema,
  selector: z.string().min(1).max(1000),
  fingerprint: z.string().min(1).max(2000).optional(),
  confidence: z.number().finite().min(0).max(1),
  source: z.literal("ai"),
  learnedAt: IsoStringSchema,
  lastVerifiedAt: IsoStringSchema.optional(),
  failureCount: z.number().int().min(0).max(1000),
}).strict();

const OverviewMetricsSchema = z.object({
  platformValue: z.number().finite(),
  freeCash: z.number().finite(),
  netAnnualReturnPct: z.number().finite().optional(),
  currency: CurrencySchema,
  confidence: z.number().finite().min(0).max(1),
  warnings: z.array(z.string().max(2000)).optional(),
}).strict();

const StoredOverviewMetricsSchema = OverviewMetricsSchema.extend({
  platformId: PlatformIdSchema,
  fetchedAt: IsoStringSchema,
}).strict();

const FinancialBackupMetricsSnapshotSchema = z.object({
  platformId: PlatformIdSchema,
  date: IsoStringSchema,
  platformValue: z.number().finite(),
  freeCash: z.number().finite(),
  netAnnualReturnPct: z.number().finite().optional(),
  fetchedAt: IsoStringSchema,
  currency: CurrencySchema.optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  warnings: z.array(z.string().max(2000)).optional(),
}).strict();

const CashflowSchema = z.object({
  date: IsoStringSchema,
  amount: z.number().finite(),
  currency: CurrencySchema,
  eurRate: z.number().finite().optional(),
  type: z.enum([
    "deposit",
    "withdrawal",
    "interest_paid",
    "interest_accrued",
    "fee",
    "principal_repayment",
  ]),
  platformId: PlatformIdSchema,
  instrumentId: z.string().max(255).optional(),
  taxCategory: z.enum(["thesaurierend", "ausgezahlt", "neutral"]),
}).strict();

const FinancialBackupCashflowSchema = CashflowSchema;

const PositionSnapshotSchema = z.object({
  platformId: PlatformIdSchema,
  instrumentId: z.string().min(1).max(255),
  label: z.string().max(255).optional(),
  country: z.string().max(100).optional(),
  assetClass: z.string().max(100).optional(),
  riskClass: z.string().max(100).optional(),
  value: z.number().finite(),
  currency: CurrencySchema,
  eurRate: z.number().finite().optional(),
  date: IsoStringSchema,
}).strict();

const FinancialBackupPositionSchema = PositionSnapshotSchema;

const RiskEventSchema = z.object({
  platformId: PlatformIdSchema,
  loanId: z.string().max(255).optional(),
  status: z.enum(["grace", "default"]),
  amountEur: z.number().finite(),
  since: IsoStringSchema,
}).strict();

const FinancialBackupRiskEventSchema = RiskEventSchema.extend({
  recordedAt: IsoStringSchema,
}).strict();

const DeltaFieldSchema = z.enum([
  "platformValue",
  "freeCash",
  "netAnnualReturnPct",
]);

const FinancialBackupDeltaLogSchema = z.object({
  platformId: PlatformIdSchema,
  timestamp: IsoStringSchema,
  field: DeltaFieldSchema,
  oldValue: z.number().finite(),
  newValue: z.number().finite(),
  delta: z.number().finite(),
}).strict();

export const FinancialBackupPayloadSchema = z.object({
  overviewMetrics: z.array(StoredOverviewMetricsSchema),
  metricsHistory: z.array(FinancialBackupMetricsSnapshotSchema),
  cashflows: z.array(FinancialBackupCashflowSchema),
  positions: z.array(FinancialBackupPositionSchema),
  riskEvents: z.array(FinancialBackupRiskEventSchema),
  deltaLogs: z.array(FinancialBackupDeltaLogSchema),
}).strict();

export const FinancialBackupV1Schema = z.object({
  format: z.literal("p2p-portfolio-tracker-financial-backup"),
  version: z.literal(1),
  exportedAt: IsoStringSchema,
  appVersion: z.string().min(1).max(100),
  payload: FinancialBackupPayloadSchema,
}).strict();

export const RestoreFinancialBackupPayloadSchema = z.object({
  backup: FinancialBackupV1Schema,
}).strict();

const ConnectorSyncResultSchema = z.object({
  fetchedAt: IsoStringSchema,
  platformId: PlatformIdSchema,
  cashflows: z.array(CashflowSchema),
  positions: z.array(PositionSnapshotSchema),
  overviewMetrics: OverviewMetricsSchema.optional(),
  riskEvents: z.array(RiskEventSchema).optional(),
  warnings: z.array(z.string().max(2000)),
}).strict();

const IngestConnectorResultOptionsSchema = z.object({
  sourceKind: z.enum(["sync", "restore"]),
  runId: z.string().min(1).max(100).optional(),
}).strict();

const ExtractionTelemetryRecordSchema = z.object({
  id: z.number().int().positive().optional(),
  platformId: PlatformIdSchema,
  runId: z.string().min(1).max(100),
  recordedAt: IsoStringSchema,
  signalKey: z.enum(["portfolio_value", "free_cash"]),
  stage: z.enum(["css", "final", "stored"]),
  outcome: z.enum([
    "auto_selected",
    "choice_required",
    "missing",
    "low_confidence",
    "stored_suspect",
    "error",
  ]),
  value: z.number().finite().optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
  topScore: z.number().finite().optional(),
  secondScore: z.number().finite().nullable().optional(),
  candidateCount: z.number().int().min(0).max(10000),
  elementsScanned: z.number().int().min(0).max(100000),
  durationMs: z.number().finite().min(0).optional(),
  pollCount: z.number().int().min(0).max(1000).optional(),
  warnings: z.array(z.string().max(2000)),
}).strict();

export const DbProxyRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("DB_CREATE_SYNC_RUN"),
    payload: z.object({
      runId: z.string().min(1).max(100),
      platformIds: z.array(PlatformIdSchema),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_UPDATE_SYNC_RUN"),
    payload: z.object({
      runId: z.string().min(1).max(100),
      update: z.object({
        state: SyncRunStateSchema.optional(),
        message: z.string().max(2000).optional(),
        finishedAt: IsoStringSchema.optional(),
      }).strict(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_UPDATE_PLATFORM_PROGRESS"),
    payload: z.object({
      runId: z.string().min(1).max(100),
      platformId: PlatformIdSchema,
      state: PlatformSyncStateSchema,
    }).strict(),
  }).strict(),
  z.object({ type: z.literal("DB_GET_LATEST_SYNC_RUN") }).strict(),
  z.object({ type: z.literal("DB_GET_LAST_SUCCESSFUL_SYNC_AT") }).strict(),
  z.object({ type: z.literal("DB_GET_LATEST_METRICS") }).strict(),
  z.object({ type: z.literal("DB_GET_EXPORT_DATA") }).strict(),
  z.object({ type: z.literal("DB_LIST_FINANCIAL_DATA_PLATFORM_IDS") }).strict(),
  z.object({
    type: z.literal("DB_CREATE_FINANCIAL_BACKUP"),
    payload: z.object({
      appVersion: z.string().min(1).max(100),
      exportedAt: IsoStringSchema.optional(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_RESTORE_FINANCIAL_BACKUP"),
    payload: z.object({
      backup: FinancialBackupV1Schema,
      restoredAt: IsoStringSchema.optional(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_INGEST_CONNECTOR_RESULT"),
    payload: z.object({
      result: ConnectorSyncResultSchema,
      options: IngestConnectorResultOptionsSchema.optional(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_SAVE_CREDENTIALS"),
    payload: z.object({ credentials: StoredCredentialsSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_GET_CREDENTIALS"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_DELETE_CREDENTIALS"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({ type: z.literal("DB_LIST_CREDENTIAL_PLATFORM_IDS") }).strict(),
  z.object({ type: z.literal("DB_LIST_CREDENTIAL_STATUS") }).strict(),
  z.object({ type: z.literal("DB_GET_INVISIBLE_KEY") }).strict(),
  z.object({
    type: z.literal("DB_SET_INVISIBLE_KEY"),
    payload: z.object({ keyBase64: z.string().min(1).max(1000) }).strict(),
  }).strict(),
  z.object({ type: z.literal("DB_DELETE_INVISIBLE_KEY") }).strict(),
  z.object({ type: z.literal("DB_HAS_INVISIBLE_KEY") }).strict(),
  z.object({
    type: z.literal("DB_LEARN_SELECTOR"),
    payload: z.object({ profile: SelectorProfileSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_GET_SELECTOR_PROFILES"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_RESET_SELECTOR_PROFILES"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_MARK_SELECTOR_FAILURE"),
    payload: z.object({
      platformId: PlatformIdSchema,
      signalKey: z.enum(["portfolio_value", "free_cash"]),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_LEARN_NAVIGATION_PROFILE"),
    payload: z.object({ profile: NavigationProfileSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_GET_NAVIGATION_PROFILE"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_MARK_NAVIGATION_FAILURE"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_DELETE_NAVIGATION_PROFILE"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_LEARN_LOGIN_SELECTORS"),
    payload: z.object({
      platformId: PlatformIdSchema,
      profiles: z.array(LoginSelectorProfileSchema),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_GET_LOGIN_SELECTOR_PROFILES"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_MARK_LOGIN_SELECTOR_FAILURES"),
    payload: z.object({
      platformId: PlatformIdSchema,
      fieldRoles: z.array(LoginFieldRoleSchema),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_GET_METRICS_HISTORY"),
    payload: z.object({
      platformId: PlatformIdSchema,
      limit: z.number().int().min(1).max(1000).optional(),
    }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_UPDATE_METRICS_SNAPSHOT"),
    payload: UpdateMetricsSnapshotPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal("DB_DELETE_METRICS_SNAPSHOT"),
    payload: DeleteMetricsSnapshotPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal("DB_LOG_EXTRACTION_TELEMETRY"),
    payload: z.object({ record: ExtractionTelemetryRecordSchema }).strict(),
  }).strict(),
  z.object({
    type: z.literal("DB_GET_EXTRACTION_TELEMETRY"),
    payload: z.object({
      platformId: PlatformIdSchema,
      limit: z.number().int().min(1).max(1000).optional(),
    }).strict(),
  }).strict(),
  z.object({ type: z.literal("DB_GET_SETTINGS") }).strict(),
  z.object({
    type: z.literal("DB_SAVE_SETTINGS"),
    payload: DbSaveSettingsPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal("DB_PRUNE_OLD_DATA"),
    payload: z.object({
      historyRetentionDays: z.number().int().min(0).max(3650).optional(),
    }).strict().optional(),
  }).strict(),
  z.object({
    type: z.literal("DB_CALCULATE_NET_ANNUAL_RETURN"),
    payload: z.object({ platformId: PlatformIdSchema }).strict(),
  }).strict(),
  z.object({ type: z.literal("DB_CLEANUP_STALE_SYNCS") }).strict(),
  z.object({
    type: z.literal("DB_GET_PLATFORM_BATCH_HISTORY"),
    payload: GetPlatformBatchHistoryPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal("DB_REVERT_PLATFORM_BATCH"),
    payload: RevertPlatformBatchPayloadSchema,
  }).strict(),
  z.object({
    type: z.literal("DB_REVERT_REPLACED_INGESTION_BATCH"),
    payload: RevertReplacedIngestionBatchPayloadSchema,
  }).strict(),
]);
