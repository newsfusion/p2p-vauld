import { create } from "zustand";
import type {
  StoredOverviewMetrics,
  PlatformId,
  PlatformSyncState,
  DebugPlatformSnapshot,
  GeminiDownloadProgress,
  GeminiStatus,
  ExtractorTransfer,
  ExtractorPageType,
} from "../shared/types/index.js";
import type { LockStatusResponse } from "../shared/messages.js";

type View =
  | "overview"
  | "analytics"
  | "export"
  | "settings"
  | "debug"
  | "ai-test-lab"
  | "login-extractor"
  | "dashboard-extractor";

interface DashboardState {
  lockStatus: LockStatusResponse | null;
  metrics: StoredOverviewMetrics[];
  configuredPlatformIds: PlatformId[];
  credentialPlatformIds: PlatformId[];
  dataPlatformIds: PlatformId[];
  visiblePlatformIds: PlatformId[];
  syncablePlatformIds: PlatformId[];
  privacyMode: boolean;
  debugMode: boolean;
  geminiStatus: GeminiStatus | null;
  geminiDownloadProgress: GeminiDownloadProgress | null;
  geminiDownloadError: string | null;
  geminiBannerDismissed: boolean;
  geminiSettingsFocusRequest: number;

  isSyncing: boolean;
  queuedPlatformIds: PlatformId[];
  syncStates: Partial<Record<PlatformId, PlatformSyncState>>;
  syncSteps: Partial<Record<PlatformId, string>>;
  syncErrors: Partial<Record<PlatformId, string>>;
  debugSnapshots: DebugPlatformSnapshot[];

  view: View;
  extractorTransfer: ExtractorTransfer | null;
  extractorTransfers: Partial<Record<ExtractorPageType, ExtractorTransfer>>;
  showOnboarding: boolean;

  setLockStatus: (status: LockStatusResponse | null) => void;
  setMetrics: (metrics: StoredOverviewMetrics[]) => void;
  upsertMetric: (metric: StoredOverviewMetrics) => void;
  setConfiguredPlatformIds: (ids: PlatformId[]) => void;
  setCredentialPlatformIds: (ids: PlatformId[]) => void;
  setDataPlatformIds: (ids: PlatformId[]) => void;
  setVisiblePlatformIds: (ids: PlatformId[]) => void;
  setSyncablePlatformIds: (ids: PlatformId[]) => void;
  setIsSyncing: (syncing: boolean) => void;
  addQueuedPlatform: (platformId: PlatformId) => void;
  removeQueuedPlatform: (platformId: PlatformId) => void;
  setQueuedPlatformIds: (ids: PlatformId[]) => void;
  resetQueue: () => void;
  setSyncState: (platformId: PlatformId, state: PlatformSyncState) => void;
  setSyncStep: (platformId: PlatformId, stepText: string) => void;
  clearSyncStep: (platformId: PlatformId) => void;
  setSyncError: (platformId: PlatformId, message: string) => void;
  clearSyncError: (platformId: PlatformId) => void;
  resetSyncStates: () => void;
  resetSyncErrors: () => void;
  resetSyncSteps: () => void;
  setView: (view: View) => void;
  togglePrivacyMode: () => boolean;
  setDebugMode: (enabled: boolean) => void;
  setGeminiStatus: (status: GeminiStatus | null) => void;
  setGeminiDownloadProgress: (progress: GeminiDownloadProgress | null) => void;
  setGeminiDownloadError: (error: string | null) => void;
  setGeminiBannerDismissed: (dismissed: boolean) => void;
  requestGeminiSettingsFocus: () => void;
  setShowOnboarding: (show: boolean) => void;
  upsertDebugSnapshot: (snapshot: DebugPlatformSnapshot) => void;
  clearDebugSnapshots: () => void;
  setExtractorTransfer: (transfer: ExtractorTransfer | null) => void;
  clearExtractorTransfer: (pageType: ExtractorPageType) => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  lockStatus: null,
  metrics: [],
  configuredPlatformIds: [],
  credentialPlatformIds: [],
  dataPlatformIds: [],
  visiblePlatformIds: [],
  syncablePlatformIds: [],
  privacyMode: false,
  debugMode: false,
  geminiStatus: null,
  geminiDownloadProgress: null,
  geminiDownloadError: null,
  geminiBannerDismissed: false,
  geminiSettingsFocusRequest: 0,
  isSyncing: false,
  queuedPlatformIds: [],
  syncStates: {},
  syncSteps: {},
  syncErrors: {},
  debugSnapshots: [],
  view: "overview",
  extractorTransfer: null,
  extractorTransfers: {},
  showOnboarding: false,

  setLockStatus: (lockStatus) => set({ lockStatus }),
  setMetrics: (metrics) => set({ metrics }),
  upsertMetric: (metric) =>
    set((s) => {
      const idx = s.metrics.findIndex(
        (existing) => existing.platformId === metric.platformId,
      );
      if (idx === -1) {
        return { metrics: [...s.metrics, metric] };
      }

      const next = [...s.metrics];
      next[idx] = metric;
      return { metrics: next };
    }),
  setConfiguredPlatformIds: (configuredPlatformIds) =>
    set({ configuredPlatformIds }),
  setCredentialPlatformIds: (credentialPlatformIds) =>
    set({ credentialPlatformIds }),
  setDataPlatformIds: (dataPlatformIds) => set({ dataPlatformIds }),
  setVisiblePlatformIds: (visiblePlatformIds) =>
    set({
      visiblePlatformIds,
      configuredPlatformIds: visiblePlatformIds,
    }),
  setSyncablePlatformIds: (syncablePlatformIds) =>
    set({ syncablePlatformIds }),
  setIsSyncing: (isSyncing) => set({ isSyncing }),
  addQueuedPlatform: (platformId) =>
    set((s) => {
      if (s.queuedPlatformIds.includes(platformId)) return {};
      return { queuedPlatformIds: [...s.queuedPlatformIds, platformId] };
    }),
  removeQueuedPlatform: (platformId) =>
    set((s) => ({
      queuedPlatformIds: s.queuedPlatformIds.filter((id) => id !== platformId),
    })),
  setQueuedPlatformIds: (queuedPlatformIds) => set({ queuedPlatformIds }),
  resetQueue: () => set({ queuedPlatformIds: [] }),
  setSyncState: (platformId, state) =>
    set((s) => ({ syncStates: { ...s.syncStates, [platformId]: state } })),
  setSyncStep: (platformId, stepText) =>
    set((s) => ({ syncSteps: { ...s.syncSteps, [platformId]: stepText } })),
  clearSyncStep: (platformId) =>
    set((s) => {
      const next = { ...s.syncSteps };
      delete next[platformId];
      return { syncSteps: next };
    }),
  setSyncError: (platformId, message) =>
    set((s) => ({ syncErrors: { ...s.syncErrors, [platformId]: message } })),
  clearSyncError: (platformId) =>
    set((s) => {
      const next = { ...s.syncErrors };
      delete next[platformId];
      return { syncErrors: next };
    }),
  resetSyncStates: () => set({ syncStates: {}, syncErrors: {} }),
  resetSyncErrors: () => set({ syncErrors: {} }),
  resetSyncSteps: () => set({ syncSteps: {} }),
  setView: (view) => set({ view }),
  togglePrivacyMode: () => {
    const next = !get().privacyMode;
    set({ privacyMode: next });
    return next;
  },
  setDebugMode: (enabled) => set({ debugMode: enabled }),
  setGeminiStatus: (geminiStatus) =>
    set((s) => ({
      geminiStatus,
      ...(geminiStatus === "available"
        ? { geminiDownloadProgress: null, geminiDownloadError: null }
        : s.geminiStatus === geminiStatus
          ? {}
          : {}),
    })),
  setGeminiDownloadProgress: (geminiDownloadProgress) =>
    set({ geminiDownloadProgress }),
  setGeminiDownloadError: (geminiDownloadError) =>
    set({ geminiDownloadError, geminiDownloadProgress: null }),
  setGeminiBannerDismissed: (geminiBannerDismissed) =>
    set({ geminiBannerDismissed }),
  requestGeminiSettingsFocus: () =>
    set((s) => ({
      geminiSettingsFocusRequest: s.geminiSettingsFocusRequest + 1,
    })),
  setExtractorTransfer: (extractorTransfer) =>
    set((s) => {
      if (!extractorTransfer) {
        return { extractorTransfer: null, extractorTransfers: {} };
      }
      return {
        extractorTransfer,
        extractorTransfers: {
          ...s.extractorTransfers,
          [extractorTransfer.pageType]: extractorTransfer,
        },
      };
    }),
  clearExtractorTransfer: (pageType) =>
    set((s) => {
      const nextTransfers = { ...s.extractorTransfers };
      delete nextTransfers[pageType];
      return {
        extractorTransfers: nextTransfers,
        extractorTransfer:
          s.extractorTransfer?.pageType === pageType
            ? null
            : s.extractorTransfer,
      };
    }),
  setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
  upsertDebugSnapshot: (snapshot) =>
    set((s) => {
      const idx = s.debugSnapshots.findIndex(
        (d) => d.platformId === snapshot.platformId,
      );
      if (idx === -1)
        return { debugSnapshots: [...s.debugSnapshots, snapshot] };
      const next = [...s.debugSnapshots];
      next[idx] = snapshot;
      return { debugSnapshots: next };
    }),
  clearDebugSnapshots: () => set({ debugSnapshots: [] }),
}));

if (typeof window !== "undefined") {
  // @ts-expect-error Exposed for E2E tests
  window.useDashboardStore = useDashboardStore;
}
