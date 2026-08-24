import { expect, type TestInfo } from "@playwright/test";
import { writeFileSync } from "fs";
import { PRODUCTION_CONFIDENCE_THRESHOLD } from "../../src/shared/scoring.js";
import type {
  FinancialSignalKey,
  PlatformId,
} from "../../src/shared/types/index.js";

export const CONFIDENCE_TOLERANCE = 0.02;
const RATCHET_HINT_MARGIN = 0.05;

export type ConfidenceTier = "production" | "baseline" | "known_issue";

export type SignalExpectation = {
  value?: number | null;
  baseline: number;
  tier: ConfidenceTier;
  knownLimitation?: string;
};

export type ConfidenceManifestEntry = {
  platformId: PlatformId;
  fixture: string;
  signals: Partial<Record<FinancialSignalKey, SignalExpectation>>;
};

export type MeasuredSignal = {
  value: number | null;
  confidence: number;
  candidate?: {
    origin?: string;
    selector?: string;
    text?: string;
  };
};

type MeasurementRecord = {
  platformId: PlatformId;
  signalKey: FinancialSignalKey;
  expectation: SignalExpectation;
  measured: MeasuredSignal;
};

export function isUpdateMode(): boolean {
  return process.env.UPDATE_CONFIDENCE_BASELINES === "1";
}

export function assertConfidenceRatchet(
  testInfo: TestInfo,
  measured: MeasuredSignal,
  expectation: SignalExpectation,
): void {
  expect(Number.isNaN(measured.confidence)).toBe(false);
  expect(Number.isFinite(measured.confidence)).toBe(true);

  if (expectation.tier === "baseline" || expectation.tier === "known_issue") {
    const knownLimitation = expectation.knownLimitation?.trim();
    expect(
      knownLimitation,
      `${expectation.tier} expectations must document knownLimitation`,
    ).toBeTruthy();
    testInfo.annotations.push({
      type: expectation.tier,
      description: knownLimitation!,
    });
  }

  if (expectation.tier === "known_issue") {
    testInfo.annotations.push({
      type: "observed_candidate",
      description: formatMeasuredCandidate(measured),
    });
    expect(measured.confidence).toBeLessThan(PRODUCTION_CONFIDENCE_THRESHOLD);
    return;
  }

  assertExpectedValue(measured, expectation);

  if (expectation.tier === "production") {
    expect(measured.confidence).toBeGreaterThanOrEqual(
      PRODUCTION_CONFIDENCE_THRESHOLD,
    );
  }

  expect(measured.confidence).toBeGreaterThanOrEqual(
    expectation.baseline - CONFIDENCE_TOLERANCE,
  );

  if (measured.confidence > expectation.baseline + RATCHET_HINT_MARGIN) {
    const hint =
      `Confidence ${measured.confidence.toFixed(4)} is above baseline ` +
      `${expectation.baseline.toFixed(4)}; consider ` +
      "UPDATE_CONFIDENCE_BASELINES=1 pnpm test:e2e";
    testInfo.annotations.push({ type: "ratchet_up", description: hint });
    console.warn(hint);
  }
}

export function createConfidenceRecorder(label: string) {
  const records: MeasurementRecord[] = [];

  return {
    record(
      platformId: PlatformId,
      signalKey: FinancialSignalKey,
      expectation: SignalExpectation,
      measured: MeasuredSignal,
    ): void {
      records.push({ platformId, signalKey, expectation, measured });
    },
    printSummary(): void {
      if (records.length === 0) return;
      console.table(
        records.map(({ platformId, signalKey, expectation, measured }) => ({
          manifest: label,
          platformId,
          signalKey,
          tier: expectation.tier,
          baseline: expectation.baseline,
          measured: Number(measured.confidence.toFixed(4)),
          limitation: expectation.knownLimitation ?? "",
        })),
      );
    },
    writeUpdatedManifest(
      manifest: ConfidenceManifestEntry[],
      manifestPath: string,
    ): void {
      if (!isUpdateMode()) return;

      const measuredByKey = new Map(
        records.map((record) => [
          `${record.platformId}:${record.signalKey}`,
          record.measured.confidence,
        ]),
      );
      const updated = manifest.map((entry) => ({
        ...entry,
        signals: Object.fromEntries(
          Object.entries(entry.signals).map(([signalKey, expectation]) => {
            const measuredConfidence = measuredByKey.get(
              `${entry.platformId}:${signalKey}`,
            );
            return [
              signalKey,
              measuredConfidence === undefined
                ? expectation
                : {
                    ...expectation,
                    baseline: roundConfidence(measuredConfidence),
                  },
            ];
          }),
        ),
      }));

      writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
    },
  };
}

function assertExpectedValue(
  measured: MeasuredSignal,
  expectation: SignalExpectation,
): void {
  expect(
    "value" in expectation,
    `${expectation.tier} expectations must include an audited value`,
  ).toBe(true);

  if (expectation.value === null) {
    expect(measured.value).toBeNull();
    return;
  }

  expect(measured.value).not.toBeNull();
  expect(measured.value!).toBeCloseTo(expectation.value!, 2);
}

function formatMeasuredCandidate(measured: MeasuredSignal): string {
  const candidate = measured.candidate;
  if (!candidate) {
    return `value=${measured.value}, confidence=${measured.confidence.toFixed(4)}`;
  }

  return [
    `value=${measured.value}`,
    `confidence=${measured.confidence.toFixed(4)}`,
    candidate.origin ? `origin=${candidate.origin}` : undefined,
    candidate.selector ? `selector=${candidate.selector}` : undefined,
    candidate.text ? `text=${candidate.text.slice(0, 120)}` : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function roundConfidence(confidence: number): number {
  return Number(confidence.toFixed(4));
}
