import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DebugPlatformSnapshot,
  PlatformId,
  PlatformSyncState,
  StoredOverviewMetrics,
} from '../../src/shared/types/index.js';
import { useDashboardStore } from '../../src/dashboard/store.js';

vi.mock('../../src/shared/db/index.js', () => ({
  upsertMetricsSnapshot: vi.fn(async () => undefined),
}));

describe('DebugPanel platform sync actions', () => {
  let container: HTMLDivElement;
  let root: Root;
  let DebugPanel: typeof import('../../src/dashboard/components/DebugPanel.js').DebugPanel;

  const snapshots: DebugPlatformSnapshot[] = [
    {
      platformId: 'mintos',
      platformName: 'Mintos',
      timestamp: '2026-03-09T10:00:00.000Z',
      signals: [],
      loginSuccess: true,
      logs: [],
      rawLoginHtml: '<html><body>Login</body></html>',
      rawHtml: '<html><body>Dashboard</body></html>',
    },
  ];

  beforeAll(async () => {
    ({ DebugPanel } = await import('../../src/dashboard/components/DebugPanel.js'));
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useDashboardStore.setState({
      view: 'overview',
      extractorTransfer: null,
    });
  });

  afterEach(() => {
    root.unmount();
    container.remove();
    vi.clearAllMocks();
  });

  function renderPanel(
    options: {
      isSyncing?: boolean;
      syncStates?: Partial<Record<PlatformId, PlatformSyncState>>;
      queuedPlatformIds?: PlatformId[];
      onSyncPlatform?: (platformId: PlatformId) => void;
      onCleanupStaleSyncs?: () => Promise<void>;
    } = {}
  ): void {
    flushSync(() => {
      root.render(
        React.createElement(DebugPanel, {
          snapshots,
          onSyncAll: vi.fn(),
          onSyncPlatform: options.onSyncPlatform ?? vi.fn(),
          isSyncing: options.isSyncing ?? false,
          syncStates: options.syncStates ?? {},
          queuedPlatformIds: options.queuedPlatformIds ?? [],
          hasConfiguredPlatforms: true,
          metrics: [] satisfies StoredOverviewMetrics[],
          configuredPlatformIds: ['mintos', 'debitum'] satisfies PlatformId[],
          onMetricsUpdated: vi.fn(),
          onCleanupStaleSyncs:
            options.onCleanupStaleSyncs ?? vi.fn(async () => undefined),
        })
      );
    });
  }

  it('renders cleanup action without crashing and triggers callback once', async () => {
    let releaseCleanup!: () => void;
    const onCleanupStaleSyncs: () => Promise<void> = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCleanup = resolve;
        })
    );

    renderPanel({ onCleanupStaleSyncs });

    const cleanupButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Cleanup Stale Syncs')
    );

    expect(cleanupButton).not.toBeUndefined();

    flushSync(() => {
      cleanupButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCleanupStaleSyncs).toHaveBeenCalledTimes(1);
    expect(cleanupButton?.disabled).toBe(true);
    expect(cleanupButton?.textContent).toContain('Cleaning…');

    releaseCleanup();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cleanupButton?.disabled).toBe(false);
    expect(cleanupButton?.textContent).toContain('Cleanup Stale Syncs');
  });

  it('renders per-platform sync buttons and triggers callback for selected platform', () => {
    const onSyncPlatform = vi.fn();
    renderPanel({ onSyncPlatform });

    const mintosButton = container.querySelector<HTMLButtonElement>('[data-testid="debug-sync-mintos"]');
    const debitumButton = container.querySelector<HTMLButtonElement>('[data-testid="debug-sync-debitum"]');

    expect(mintosButton).not.toBeNull();
    expect(mintosButton?.textContent).toContain('Mintos');
    expect(debitumButton).not.toBeNull();
    expect(debitumButton?.textContent).toContain('Debitum');

    mintosButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onSyncPlatform).toHaveBeenCalledTimes(1);
    expect(onSyncPlatform).toHaveBeenCalledWith('mintos');
  });

  it('keeps unrelated platform sync buttons enabled while a sync run is active', () => {
    renderPanel({
      isSyncing: true,
      syncStates: { mintos: 'running' },
    });

    const mintosButton = container.querySelector<HTMLButtonElement>('[data-testid="debug-sync-mintos"]');
    const debitumButton = container.querySelector<HTMLButtonElement>('[data-testid="debug-sync-debitum"]');

    expect(mintosButton?.disabled).toBe(true);
    expect(debitumButton?.disabled).toBe(false);
  });

  it('shows and disables queued platform buttons', () => {
    renderPanel({
      isSyncing: true,
      syncStates: { mintos: 'running', debitum: 'pending' },
      queuedPlatformIds: ['debitum'],
    });

    const mintosButton = container.querySelector<HTMLButtonElement>('[data-testid="debug-sync-mintos"]');
    const debitumButton = container.querySelector<HTMLButtonElement>('[data-testid="debug-sync-debitum"]');

    expect(mintosButton?.disabled).toBe(true);
    expect(debitumButton?.disabled).toBe(true);
    expect(debitumButton?.textContent).toContain('In Queue #1');
  });

  it('right-aligns manual override numeric fields with their metric columns', () => {
    renderPanel();

    const overrideToggle = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Manual Value Override')
    );

    flushSync(() => {
      overrideToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'));

    expect(inputs).toHaveLength(6);
    for (const input of inputs) {
      expect(input.closest('td')?.className).toContain('text-right');
    }
  });

  it('resetSyncStates clears sync state without wiping debug snapshots', () => {
    useDashboardStore.setState({
      debugSnapshots: snapshots,
      syncStates: { mintos: 'running' },
    });

    useDashboardStore.getState().resetSyncStates();

    expect(useDashboardStore.getState().debugSnapshots).toEqual(snapshots);
    expect(useDashboardStore.getState().syncStates).toEqual({});
  });

  it('clearDebugSnapshots removes debug snapshots explicitly', () => {
    useDashboardStore.setState({ debugSnapshots: snapshots });

    useDashboardStore.getState().clearDebugSnapshots();

    expect(useDashboardStore.getState().debugSnapshots).toEqual([]);
  });

  it('shows Cancelled status for cancelled debug snapshots', () => {
    const cancelledSnapshots: DebugPlatformSnapshot[] = [
      {
        ...snapshots[0]!,
        loginSuccess: false,
        cancelled: true,
        logs: [
          {
            timestamp: '2026-03-09T10:00:00.000Z',
            step: 'Sync cancelled by user',
            level: 'warn',
          },
        ],
      },
    ];

    flushSync(() => {
      root.render(
        React.createElement(DebugPanel, {
          snapshots: cancelledSnapshots,
          onSyncAll: vi.fn(),
          onSyncPlatform: vi.fn(),
          isSyncing: false,
          syncStates: {},
          hasConfiguredPlatforms: true,
          metrics: [] satisfies StoredOverviewMetrics[],
          configuredPlatformIds: ['mintos', 'debitum'] satisfies PlatformId[],
          onMetricsUpdated: vi.fn(),
          onCleanupStaleSyncs: vi.fn(async () => undefined),
        }),
      );
    });

    expect(container.textContent).toContain('Cancelled');
    expect(container.textContent).not.toContain('Running');
  });

  it('renders separate login and dashboard HTML viewers and transfers them to the matching extractor tabs', () => {
    renderPanel();

    expect(container.textContent).toContain('Login Page HTML');
    expect(container.textContent).toContain('Dashboard HTML');

    const loginTransferButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="send-to-extractor-login"]',
    );
    const dashboardTransferButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="send-to-extractor-dashboard"]',
    );

    expect(loginTransferButton).not.toBeNull();
    expect(dashboardTransferButton).not.toBeNull();

    loginTransferButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(useDashboardStore.getState().view).toBe('login-extractor');
    expect(useDashboardStore.getState().extractorTransfer).toEqual(
      expect.objectContaining({
        platformId: 'mintos',
        platformName: 'Mintos',
        pageType: 'login',
        html: '<html><body>Login</body></html>',
      }),
    );

    useDashboardStore.setState({
      view: 'overview',
      extractorTransfer: null,
    });

    dashboardTransferButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(useDashboardStore.getState().view).toBe('dashboard-extractor');
    expect(useDashboardStore.getState().extractorTransfer).toEqual(
      expect.objectContaining({
        platformId: 'mintos',
        platformName: 'Mintos',
        pageType: 'dashboard',
        html: '<html><body>Dashboard</body></html>',
      }),
    );
  });
});
