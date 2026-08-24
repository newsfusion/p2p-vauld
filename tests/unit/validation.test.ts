import { describe, expect, it } from "vitest";
import {
  AppSettingsSchema,
  DeleteCredentialsPayloadSchema,
  DbProxyRequestSchema,
  FinancialBackupV1Schema,
  GetCredentialEditPrefillPayloadSchema,
  PlatformIdSchema,
  ProxyAiPromptPayloadSchema,
  RevertPlatformBatchPayloadSchema,
  SaveCredentialsPayloadSchema,
  StartSyncPayloadSchema,
  SetupMasterPasswordPayloadSchema,
  UpdatePlatformModesPayloadSchema,
} from "../../src/shared/validation.js";

describe("runtime validation schemas", () => {
  it("accepts only known platform ids", () => {
    expect(PlatformIdSchema.parse("mintos")).toBe("mintos");
    expect(() => PlatformIdSchema.parse("not-a-platform")).toThrow();
  });

  it("matches the AppSettings language contract", () => {
    expect(AppSettingsSchema.parse({ language: "nl" })).toEqual({
      language: "nl",
    });
    expect(AppSettingsSchema.parse({ language: "it" })).toEqual({
      language: "it",
    });
    expect(() => AppSettingsSchema.parse({ language: "lv" })).toThrow();
  });

  it("accepts parallel sync toggle in app settings", () => {
    expect(AppSettingsSchema.parse({ parallelSyncEnabled: true })).toEqual({
      parallelSyncEnabled: true,
    });
    expect(AppSettingsSchema.parse({ parallelSyncEnabled: false })).toEqual({
      parallelSyncEnabled: false,
    });
  });

  it("strips undefined optional settings before persistence", () => {
    expect(
      AppSettingsSchema.parse({
        privacyModeEnabled: undefined,
        sessionTimeoutMinutes: 30,
      }),
    ).toEqual({ sessionTimeoutMinutes: 30 });
  });

  it("validates the separate auto-lock toggle and fixed timeout choices", () => {
    expect(
      AppSettingsSchema.parse({
        autoLockEnabled: false,
        sessionTimeoutMinutes: 30,
      }),
    ).toEqual({ autoLockEnabled: false, sessionTimeoutMinutes: 30 });

    expect(() =>
      AppSettingsSchema.parse({ sessionTimeoutMinutes: 0 }),
    ).toThrow();
    expect(() =>
      AppSettingsSchema.parse({ sessionTimeoutMinutes: 10 }),
    ).toThrow();
  });

  it("allows any non-empty master password", () => {
    expect(SetupMasterPasswordPayloadSchema.parse({ password: "x" })).toEqual({
      password: "x",
    });
    expect(() =>
      SetupMasterPasswordPayloadSchema.parse({ password: "" }),
    ).toThrow();
  });

  it("validates sync reminder days from 1 to 365", () => {
    expect(AppSettingsSchema.parse({ syncReminderDays: 1 })).toEqual({
      syncReminderDays: 1,
    });
    expect(AppSettingsSchema.parse({ syncReminderDays: 7 })).toEqual({
      syncReminderDays: 7,
    });
    expect(AppSettingsSchema.parse({ syncReminderDays: 365 })).toEqual({
      syncReminderDays: 365,
    });

    expect(() => AppSettingsSchema.parse({ syncReminderDays: 0 })).toThrow();
    expect(() => AppSettingsSchema.parse({ syncReminderDays: 366 })).toThrow();
    expect(() => AppSettingsSchema.parse({ syncReminderDays: 7.5 })).toThrow();
  });

  it("validates payloads used by sensitive background branches", () => {
    expect(
      DeleteCredentialsPayloadSchema.parse({ platformId: "peerberry" }),
    ).toEqual({ platformId: "peerberry" });
    expect(() =>
      DeleteCredentialsPayloadSchema.parse({ platformId: "evil" }),
    ).toThrow();

    expect(() =>
      ProxyAiPromptPayloadSchema.parse({
        systemPrompt: "sys",
        examples: [{ role: "system", content: "bad" }],
        input: "input",
      }),
    ).toThrow();
  });

  it("accepts forced extraction choice signals in start sync payloads", () => {
    expect(
      StartSyncPayloadSchema.parse({
        platformIds: ["mintos"],
        forceExtractionChoiceForSignals: ["portfolio_value", "free_cash"],
      }),
    ).toEqual({
      platformIds: ["mintos"],
      forceExtractionChoiceForSignals: ["portfolio_value", "free_cash"],
    });

    expect(() =>
      StartSyncPayloadSchema.parse({
        platformIds: ["mintos"],
        forceExtractionChoiceForSignals: ["net_annual_return"],
      }),
    ).toThrow();
  });

  it("accepts credential mode overrides and rejects unknown config fields", () => {
    expect(
      SaveCredentialsPayloadSchema.parse({
        platformId: "mintos",
        credentials: {
          username: "user@example.com",
          password: "secret",
        },
        config: {
          safeModeEnabled: true,
          stealthModeEnabled: false,
        },
      }),
    ).toEqual({
      platformId: "mintos",
      credentials: {
        username: "user@example.com",
        password: "secret",
      },
      config: {
        safeModeEnabled: true,
        stealthModeEnabled: false,
      },
    });

    expect(() =>
      SaveCredentialsPayloadSchema.parse({
        platformId: "mintos",
        credentials: {
          username: "user@example.com",
          password: "secret",
        },
        config: {
          safeModeEnabled: true,
          unexpected: true,
        },
      }),
    ).toThrow();
  });

  it("validates platform mode updates without credentials", () => {
    expect(
      UpdatePlatformModesPayloadSchema.parse({
        platformId: "mintos",
        config: { safeModeEnabled: true },
      }),
    ).toEqual({
      platformId: "mintos",
      config: { safeModeEnabled: true },
    });

    expect(
      UpdatePlatformModesPayloadSchema.parse({
        platformId: "peerberry",
        config: {
          safeModeEnabled: false,
          stealthModeEnabled: true,
        },
      }),
    ).toEqual({
      platformId: "peerberry",
      config: {
        safeModeEnabled: false,
        stealthModeEnabled: true,
      },
    });

    expect(() =>
      UpdatePlatformModesPayloadSchema.parse({
        platformId: "evil",
        config: { safeModeEnabled: true },
      }),
    ).toThrow();

    expect(() =>
      UpdatePlatformModesPayloadSchema.parse({
        platformId: "mintos",
        config: {},
      }),
    ).toThrow();
  });

  it("validates credential edit prefill requests by platform id", () => {
    expect(
      GetCredentialEditPrefillPayloadSchema.parse({ platformId: "mintos" }),
    ).toEqual({ platformId: "mintos" });

    expect(() =>
      GetCredentialEditPrefillPayloadSchema.parse({
        platformId: "not-a-platform",
      }),
    ).toThrow();
    expect(() =>
      GetCredentialEditPrefillPayloadSchema.parse({
        platformId: "mintos",
        password: "never-request-this",
      }),
    ).toThrow();
  });

  it("keeps stored credentials backward compatible while accepting mode overrides", () => {
    const basePayload = {
      type: "DB_SAVE_CREDENTIALS",
      payload: {
        credentials: {
          platformId: "mintos",
          encryptedUsername: { iv: "iv", ciphertext: "username" },
          encryptedPassword: { iv: "iv", ciphertext: "password" },
          createdAt: "2026-05-18T10:00:00.000Z",
          updatedAt: "2026-05-18T10:00:00.000Z",
        },
      },
    };

    expect(DbProxyRequestSchema.parse(basePayload)).toEqual(basePayload);
    expect(
      DbProxyRequestSchema.parse({
        ...basePayload,
        payload: {
          credentials: {
            ...basePayload.payload.credentials,
            safeModeEnabled: false,
            stealthModeEnabled: true,
            consecutiveLoginFailureCount: 2,
            lastLoginError: "Login rejected — invalid credentials",
          },
        },
      }),
    ).toEqual({
      ...basePayload,
      payload: {
        credentials: {
          ...basePayload.payload.credentials,
          safeModeEnabled: false,
          stealthModeEnabled: true,
          consecutiveLoginFailureCount: 2,
          lastLoginError: "Login rejected — invalid credentials",
        },
      },
    });

    expect(() =>
      DbProxyRequestSchema.parse({
        ...basePayload,
        payload: {
          credentials: {
            ...basePayload.payload.credentials,
            consecutiveLoginFailureCount: 3,
          },
        },
      }),
    ).toThrow();

    expect(() =>
      DbProxyRequestSchema.parse({
        ...basePayload,
        payload: {
          credentials: {
            ...basePayload.payload.credentials,
            lastLoginError: "x".repeat(501),
          },
        },
      }),
    ).toThrow();
  });

  it("validates batch history proxy requests and revert payloads", () => {
    expect(
      DbProxyRequestSchema.parse({
        type: "DB_GET_PLATFORM_BATCH_HISTORY",
        payload: { platformId: "mintos" },
      }),
    ).toEqual({
      type: "DB_GET_PLATFORM_BATCH_HISTORY",
      payload: { platformId: "mintos" },
    });

    expect(
      DbProxyRequestSchema.parse({
        type: "DB_REVERT_PLATFORM_BATCH",
        payload: { platformId: "mintos", batchId: 7 },
      }),
    ).toEqual({
      type: "DB_REVERT_PLATFORM_BATCH",
      payload: { platformId: "mintos", batchId: 7 },
    });

    expect(
      RevertPlatformBatchPayloadSchema.parse({
        platformId: "mintos",
        batchId: 7,
      }),
    ).toEqual({
      platformId: "mintos",
      batchId: 7,
    });

    expect(() =>
      RevertPlatformBatchPayloadSchema.parse({
        platformId: "mintos",
        batchId: 0,
      }),
    ).toThrow();
  });

  it("validates financial backup proxy requests", () => {
    const backup = {
      format: "p2p-portfolio-tracker-financial-backup",
      version: 1,
      exportedAt: "2026-06-08T10:00:00.000Z",
      appVersion: "0.12.75",
      payload: {
        overviewMetrics: [],
        metricsHistory: [],
        cashflows: [],
        positions: [],
        riskEvents: [],
        deltaLogs: [],
      },
    };

    expect(FinancialBackupV1Schema.parse(backup)).toEqual(backup);
    expect(
      DbProxyRequestSchema.parse({
        type: "DB_RESTORE_FINANCIAL_BACKUP",
        payload: {
          backup,
          restoredAt: "2026-06-08T11:00:00.000Z",
        },
      }),
    ).toEqual({
      type: "DB_RESTORE_FINANCIAL_BACKUP",
      payload: {
        backup,
        restoredAt: "2026-06-08T11:00:00.000Z",
      },
    });

    expect(() =>
      FinancialBackupV1Schema.parse({
        ...backup,
        credentials: [],
      }),
    ).toThrow();
  });
});
