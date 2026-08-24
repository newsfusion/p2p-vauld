import { describe, expect, it } from "vitest";
import {
  FINANCIAL_BACKUP_FORMAT,
  createFinancialBackupObject,
  serializeOverviewMetricsCsv,
} from "../../src/shared/export-backup.js";
import { FinancialBackupV1Schema } from "../../src/shared/validation.js";
import type { FinancialBackupPayload } from "../../src/shared/types/index.js";

function emptyPayload(
  overrides: Partial<FinancialBackupPayload> = {},
): FinancialBackupPayload {
  return {
    overviewMetrics: [],
    metricsHistory: [],
    cashflows: [],
    positions: [],
    riskEvents: [],
    deltaLogs: [],
    ...overrides,
  };
}

describe("financial export backup helpers", () => {
  it("serializes overview metrics without confidence and with stable escaping", () => {
    const csv = serializeOverviewMetricsCsv(
      [
        {
          platformId: "mintos",
          fetchedAt: "2026-06-01T12:00:00.000Z",
          platformValue: 1234.56,
          freeCash: 78.9,
          currency: "EUR",
          confidence: 0.9876,
        },
      ],
      {
        platformNameById: () => 'Mintos, "Core"',
      },
    );

    expect(csv).toBe(
      [
        "Platform ID,Platform Name,Fetched At,Portfolio Value,Free Cash,Net Annual Return %,Currency",
        'mintos,"Mintos, ""Core""",2026-06-01T12:00:00.000Z,1234.56,78.9,,EUR',
        "",
      ].join("\n"),
    );
  });

  it("creates a versioned JSON backup without forbidden credential or settings fields", () => {
    const backup = createFinancialBackupObject(
      emptyPayload({
        overviewMetrics: [
          {
            platformId: "mintos",
            fetchedAt: "2026-06-01T12:00:00.000Z",
            platformValue: 1000,
            freeCash: 25,
            currency: "EUR",
            confidence: 0.9,
            warnings: ["suspect_value"],
            encryptedPassword: "must be stripped",
          } as never,
        ],
        metricsHistory: [
          {
            platformId: "mintos",
            date: "2026-06-01",
            platformValue: 1000,
            freeCash: 25,
            fetchedAt: "2026-06-01T12:00:00.000Z",
            currency: "EUR",
            confidence: 0.9,
            warnings: ["suspect_value"],
            batchId: 77,
          } as never,
        ],
        cashflows: [
          {
            id: 99,
            batchId: 77,
            platformId: "mintos",
            date: "2026-06-01",
            amount: 12.5,
            currency: "EUR",
            type: "interest_paid",
            taxCategory: "ausgezahlt",
          } as never,
        ],
      }),
      {
        appVersion: "0.12.75",
        exportedAt: "2026-06-08T10:00:00.000Z",
      },
    );

    expect(backup).toEqual({
      format: FINANCIAL_BACKUP_FORMAT,
      version: 1,
      appVersion: "0.12.75",
      exportedAt: "2026-06-08T10:00:00.000Z",
      payload: {
        overviewMetrics: [
          {
            platformId: "mintos",
            fetchedAt: "2026-06-01T12:00:00.000Z",
            platformValue: 1000,
            freeCash: 25,
            currency: "EUR",
            confidence: 0.9,
            warnings: ["suspect_value"],
          },
        ],
        metricsHistory: [
          {
            platformId: "mintos",
            date: "2026-06-01",
            platformValue: 1000,
            freeCash: 25,
            fetchedAt: "2026-06-01T12:00:00.000Z",
            currency: "EUR",
            confidence: 0.9,
            warnings: ["suspect_value"],
          },
        ],
        cashflows: [
          {
            platformId: "mintos",
            date: "2026-06-01",
            amount: 12.5,
            currency: "EUR",
            type: "interest_paid",
            taxCategory: "ausgezahlt",
          },
        ],
        positions: [],
        riskEvents: [],
        deltaLogs: [],
      },
    });

    const serialized = JSON.stringify(backup);
    expect(serialized).not.toContain("encryptedPassword");
    expect(serialized).not.toContain("credentials");
    expect(serialized).not.toContain("batchId");
    expect(serialized).not.toContain("settings");
    expect(serialized).not.toContain("syncRuns");
    expect(serialized).not.toContain("selectorProfiles");
    expect(serialized).not.toContain("masterPassword");
    expect(serialized).not.toContain("session");
  });

  it("validates JSON backups that include metrics history metadata", () => {
    const backup = createFinancialBackupObject(
      emptyPayload({
        metricsHistory: [
          {
            platformId: "mintos",
            date: "2026-06-01",
            platformValue: 1000,
            freeCash: 25,
            fetchedAt: "2026-06-01T12:00:00.000Z",
            currency: "EUR",
            confidence: 0.9,
            warnings: ["suspect_value"],
          },
        ],
      }),
      {
        appVersion: "0.12.75",
        exportedAt: "2026-06-08T10:00:00.000Z",
      },
    );

    const result = FinancialBackupV1Schema.safeParse(backup);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.metricsHistory[0]).toEqual(
        expect.objectContaining({
          currency: "EUR",
          confidence: 0.9,
          warnings: ["suspect_value"],
        }),
      );
    }
  });

  it("validates backup schema and rejects unknown platform ids or extra root fields", () => {
    const validBackup = createFinancialBackupObject(emptyPayload(), {
      appVersion: "0.12.75",
      exportedAt: "2026-06-08T10:00:00.000Z",
    });

    expect(FinancialBackupV1Schema.safeParse(validBackup).success).toBe(true);
    expect(
      FinancialBackupV1Schema.safeParse({
        ...validBackup,
        payload: {
          ...validBackup.payload,
          overviewMetrics: [
            {
              platformId: "not-a-platform",
              fetchedAt: "2026-06-01T12:00:00.000Z",
              platformValue: 1,
              freeCash: 0,
              currency: "EUR",
              confidence: 1,
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      FinancialBackupV1Schema.safeParse({
        ...validBackup,
        credentials: [],
      }).success,
    ).toBe(false);
  });
});
