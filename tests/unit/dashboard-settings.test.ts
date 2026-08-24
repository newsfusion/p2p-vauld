/**
 * Tests for new Phase 3 types and DB helpers.
 *
 * NOTE: Dexie/IndexedDB tests are skipped because happy-dom does not implement
 * IndexedDB. To run DB tests, use a Node environment with fake-indexeddb or
 * run the E2E tests against the real extension.
 */

import { describe, it, expect } from 'vitest';
import type {
  SyncEvent,
  PlatformSyncState,
  StoredOverviewMetrics,
} from '../../src/shared/types/index.js';
import {
  createDefaultSettings,
  stripLegacySettingsFields,
} from '../../src/shared/db/index.js';
import { AppSettingsSchema } from '../../src/shared/validation.js';

type UpsertMetricsSnapshotInput = Parameters<
  typeof import('../../src/shared/db/index.js').upsertMetricsSnapshot
>[0];

// ─── SyncEvent type shape (compile-time + runtime checks) ────────────────────

describe('SyncEvent type', () => {
  it('accepts state field typed as PlatformSyncState', () => {
    const event: SyncEvent = {
      type: 'platform_error',
      platformId: 'mintos',
      runId: 'run-1',
      message: '2FA required',
      state: 'failed_2fa' satisfies PlatformSyncState,
    };
    expect(event.state).toBe('failed_2fa');
  });

  it('state field is optional', () => {
    const event: SyncEvent = {
      type: 'platform_done',
      platformId: 'mintos',
      runId: 'run-1',
    };
    expect(event.state).toBeUndefined();
  });

  it('all PlatformSyncState values are valid for state field', () => {
    const states: PlatformSyncState[] = [
      'pending',
      'running',
      'success',
      'failed_login',
      'failed_2fa',
      'failed_timeout',
      'failed_extract',
    ];
    for (const state of states) {
      const event: SyncEvent = {
        type: 'platform_error',
        platformId: 'mintos',
        runId: 'run-1',
        state,
      };
      expect(event.state).toBe(state);
    }
  });

  it('sync_complete event has empty platformId', () => {
    const event: SyncEvent = {
      type: 'sync_complete',
      platformId: '',
      runId: 'run-1',
    };
    expect(event.type).toBe('sync_complete');
    expect(event.platformId).toBe('');
  });

  it('sync_failed event has empty platformId and carries the failure message', () => {
    const event: SyncEvent = {
      type: 'sync_failed',
      platformId: '',
      runId: 'run-failed',
      message: 'Sync interrupted by service worker restart',
    };
    expect(event.type).toBe('sync_failed');
    expect(event.platformId).toBe('');
    expect(event.message).toContain('interrupted');
  });

  it('platform_done event carries result', () => {
    const event: SyncEvent = {
      type: 'platform_done',
      platformId: 'peerberry',
      runId: 'run-2',
      result: {
        fetchedAt: '2026-02-27T10:00:00Z',
        platformId: 'peerberry',
        cashflows: [],
        positions: [],
        overviewMetrics: {
          platformValue: 1000,
          freeCash: 50,
          currency: 'EUR',
          confidence: 0.9,
        },
        warnings: [],
      },
    };
    expect(event.result?.platformId).toBe('peerberry');
  });

  it('supports streamed debug logs and captured HTML', () => {
    const event: SyncEvent = {
      type: 'platform_progress',
      platformId: 'mintos',
      runId: 'run-3',
      debugLogs: [
        {
          timestamp: '2026-03-02T10:15:00.000Z',
          step: 'Extracting portfolio_value signal',
          detail: '12 candidates, confidence 89%',
          level: 'info',
        },
      ],
      rawLoginHtml: '<html><body>Mintos Login</body></html>',
      rawHtml: '<html><body>Mintos</body></html>',
    };

    expect(event.debugLogs?.[0]?.step).toBe('Extracting portfolio_value signal');
    expect(event.rawLoginHtml).toContain('Login');
    expect(event.rawHtml).toContain('Mintos');
  });
});

// ─── DB tests (skipped — require IndexedDB) ───────────────────────────────────

describe.skip('getSettings / saveSettings (requires IndexedDB)', () => {
  it('returns default settings when DB is empty', async () => {
    // Would test: const settings = await getSettings(); expect(settings.privacyModeEnabled).toBe(false);
  });

  it('persists privacyModeEnabled=true and reads it back', async () => {
    // Would test: await saveSettings({ privacyModeEnabled: true }); const s = await getSettings(); expect(s.privacyModeEnabled).toBe(true);
  });
});

describe('settings defaults and validation', () => {
  it('defaults the Gemini Nano activation banner to visible', () => {
    expect(createDefaultSettings().geminiActivationBannerDismissed).toBe(false);
  });

  it('defaults the sync reminder threshold to seven days', () => {
    expect(createDefaultSettings().syncReminderDays).toBe(7);
  });

  it('defaults parallel sync to disabled', () => {
    expect(createDefaultSettings().parallelSyncEnabled).toBe(false);
  });

  it('defaults low-confidence popup totals to enabled', () => {
    expect(createDefaultSettings().showLowConfidenceMetricsInPopup).toBe(true);
  });

  it('defaults the 2FA dashboard prompt to disabled', () => {
    expect(createDefaultSettings().showTwoFactorManualActionDialog).toBe(false);
  });

  it('defaults stealth mode to disabled for fresh installs', () => {
    expect(createDefaultSettings().stealthModeEnabled).toBe(false);
  });

  it('defaults auto-lock to enabled after fifteen minutes', () => {
    expect(createDefaultSettings().autoLockEnabled).toBe(true);
    expect(createDefaultSettings().sessionTimeoutMinutes).toBe(15);
  });

  it('accepts Gemini Nano banner dismissal in SAVE_SETTINGS payloads', () => {
    const parsed = AppSettingsSchema.parse({
      geminiActivationBannerDismissed: true,
    });

    expect(parsed).toEqual({ geminiActivationBannerDismissed: true });
  });

  it('accepts parallel sync toggle in SAVE_SETTINGS payloads', () => {
    const parsed = AppSettingsSchema.parse({
      parallelSyncEnabled: true,
    });

    expect(parsed).toEqual({ parallelSyncEnabled: true });
  });

  it('accepts low-confidence popup totals toggle in SAVE_SETTINGS payloads', () => {
    const parsed = AppSettingsSchema.parse({
      showLowConfidenceMetricsInPopup: true,
    });

    expect(parsed).toEqual({ showLowConfidenceMetricsInPopup: true });
  });

  it('accepts the 2FA dashboard prompt toggle in SAVE_SETTINGS payloads', () => {
    expect(
      AppSettingsSchema.parse({
        showTwoFactorManualActionDialog: true,
      }),
    ).toEqual({ showTwoFactorManualActionDialog: true });
    expect(
      AppSettingsSchema.parse({
        showTwoFactorManualActionDialog: false,
      }),
    ).toEqual({ showTwoFactorManualActionDialog: false });
  });

  it('rejects unknown settings keys', () => {
    expect(() =>
      AppSettingsSchema.parse({ geminiActivationBannerDismissed: true, typo: true }),
    ).toThrow();
  });

  it('rejects legacy credential email in settings payloads', () => {
    expect(() =>
      AppSettingsSchema.parse({ lastUsedCredentialEmail: 'user@example.com' }),
    ).toThrow();
  });

  it('strips legacy credential email fields from stored settings', () => {
    const sanitized = stripLegacySettingsFields({
      ...createDefaultSettings(),
      lastUsedCredentialEmail: 'user@example.com',
    });

    expect(sanitized).not.toHaveProperty('lastUsedCredentialEmail');
  });
});

describe.skip('listCredentialPlatformIds (requires IndexedDB)', () => {
  it('returns platform IDs after saveCredentials', async () => {
    // Would test saveCredentials + listCredentialPlatformIds + deleteCredentials
  });
});

describe('manual override metrics payload types', () => {
  it('accepts a manual override shape with confidence 1.0', () => {
    const override: StoredOverviewMetrics = {
      platformId: 'mintos',
      fetchedAt: '2026-03-06T15:45:00.000Z',
      platformValue: 1234.56,
      freeCash: 78.9,
      netAnnualReturnPct: 9.25,
      currency: 'EUR',
      confidence: 1.0,
    };

    expect(override.confidence).toBe(1.0);
    expect(override.currency).toBe('EUR');
  });

  it('matches the upsertMetricsSnapshot input signature', () => {
    const payload: UpsertMetricsSnapshotInput = {
      platformId: 'peerberry',
      date: '2026-03-06',
      fetchedAt: '2026-03-06T16:00:00.000Z',
      platformValue: 5000,
      freeCash: 250,
      netAnnualReturnPct: 10.5,
      currency: 'EUR',
      confidence: 1.0,
    };

    expect(payload.platformId).toBe('peerberry');
    expect(payload.confidence).toBe(1.0);
  });
});
