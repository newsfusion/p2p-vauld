import type { Page } from "@playwright/test";

type RuntimeMessage = { type?: string; payload?: unknown };

type MockMetric = {
  platformId: string;
  fetchedAt?: string;
  platformValue: number;
  freeCash: number;
  currency?: string;
  confidence?: number;
  netAnnualReturnPct?: number;
  sourceKind?: "sync" | "restore";
};

type MockCredential = {
  platformId: string;
  username?: string | undefined;
  safeMode?: boolean | undefined;
  stealthMode?: boolean | undefined;
  safeModeEnabled?: boolean | undefined;
  stealthModeEnabled?: boolean | undefined;
  active?: boolean | undefined;
};

type MockSnapshot = {
  platformId: string;
  date: string;
  platformValue: number;
  freeCash: number;
  fetchedAt?: string;
  currency?: string;
  confidence?: number;
  netAnnualReturnPct?: number;
  batchId?: number;
};

type MockOptions = {
  resetState?: boolean;
  onboardingComplete?: boolean;
  locked?: boolean;
  hasMasterPassword?: boolean;
  unlockPassword?: string;
  metrics?: MockMetric[];
  metricsHistory?: MockSnapshot[];
  credentials?: MockCredential[];
  dataPlatformIds?: string[];
  settings?: Record<string, unknown>;
  geminiStatus?: "available" | "downloadable" | "downloading" | "unavailable";
  backup?: Record<string, unknown>;
  syncRun?: Record<string, unknown>;
  queuedPlatformIds?: string[];
};

const defaultSettings = {
  privacyModeEnabled: false,
  stealthModeEnabled: false,
  debugModeEnabled: false,
  parallelSyncEnabled: false,
  disabledPlatformIds: [],
  lastUsedCredentialEmail: "",
  language: "en",
  syncReminderDays: 7,
  autoLockEnabled: true,
  sessionTimeoutMinutes: 15,
  historyRetentionDays: 0,
  geminiActivationBannerDismissed: true,
};

export async function installDashboardMock(
  page: Page,
  options: MockOptions = {},
): Promise<void> {
  await page.addInitScript((mockOptions: MockOptions & { defaults: typeof defaultSettings }) => {
    if (
      mockOptions.resetState !== false &&
      !window.sessionStorage.getItem("p2p-e2e-mock-initialized")
    ) {
      window.localStorage.removeItem("p2p-e2e-mock-state");
      window.sessionStorage.setItem("p2p-e2e-mock-initialized", "true");
    }
    const listeners = new Set<(message: unknown) => void>();
    const sentMessages: RuntimeMessage[] = [];
    const downloads: Array<{ text: string; type: string }> = [];
    const persisted = JSON.parse(window.localStorage.getItem("p2p-e2e-mock-state") ?? "{}") as {
      onboardingComplete?: boolean;
      locked?: boolean;
      hasMasterPassword?: boolean;
    };
    const storedLocal: Record<string, unknown> = {
      p2p_onboarding_complete:
        persisted.onboardingComplete ?? mockOptions.onboardingComplete ?? true,
    };
    let locked = persisted.locked ?? mockOptions.locked ?? false;
    let hasMasterPassword =
      persisted.hasMasterPassword ?? mockOptions.hasMasterPassword ?? false;
    let metrics = mockOptions.metrics ?? [];
    let metricsHistory: MockSnapshot[] =
      mockOptions.metricsHistory ??
      metrics.map((metric) => {
        const snapshot: MockSnapshot = {
          platformId: metric.platformId,
          date: (metric.fetchedAt ?? "2026-06-08T10:00:00.000Z").slice(0, 10),
          platformValue: metric.platformValue,
          freeCash: metric.freeCash,
        };
        if (metric.fetchedAt !== undefined) snapshot.fetchedAt = metric.fetchedAt;
        if (metric.currency !== undefined) snapshot.currency = metric.currency;
        if (metric.confidence !== undefined) snapshot.confidence = metric.confidence;
        if (metric.netAnnualReturnPct !== undefined) {
          snapshot.netAnnualReturnPct = metric.netAnnualReturnPct;
        }
        return snapshot;
      });
    let credentials = mockOptions.credentials ?? [];
    let syncRun = mockOptions.syncRun;
    let queuedPlatformIds = mockOptions.queuedPlatformIds ?? [];

    function recomputeMetricsFromHistory(): void {
      const latestByPlatform = new Map<string, MockSnapshot>();
      for (const snapshot of metricsHistory) {
        const current = latestByPlatform.get(snapshot.platformId);
        if (!current || snapshot.date > current.date) {
          latestByPlatform.set(snapshot.platformId, snapshot);
        }
      }
      metrics = [...latestByPlatform.values()].map((snapshot) => ({
        platformId: snapshot.platformId,
        fetchedAt: snapshot.fetchedAt ?? `${snapshot.date}T00:00:00.000Z`,
        platformValue: snapshot.platformValue,
        freeCash: snapshot.freeCash,
        currency: snapshot.currency ?? "EUR",
        confidence: snapshot.confidence ?? 1,
        ...(snapshot.netAnnualReturnPct === undefined
          ? {}
          : { netAnnualReturnPct: snapshot.netAnnualReturnPct }),
      }));
    }

    function broadcastMetrics(): void {
      emit({
        type: "METRICS_UPDATED",
        payload: {
          metrics,
          dataPlatformIds: metrics.map((metric) => metric.platformId),
        },
      });
    }
    let settings = {
      ...mockOptions.defaults,
      ...(mockOptions.settings ?? {}),
    };
    const backup =
      mockOptions.backup ??
      {
        format: "p2p-portfolio-tracker-financial-backup",
        version: 1,
        exportedAt: "2026-06-08T10:00:00.000Z",
        appVersion: "0.12.86",
        payload: {
          overviewMetrics: metrics,
          metricsHistory: [],
          cashflows: [],
          positions: [],
          riskEvents: [],
          deltaLogs: [],
        },
      };

    function platformIds(): string[] {
      return credentials.map((credential) => credential.platformId);
    }

    function emit(message: unknown): void {
      const runtimeMessage = message as {
        type?: string;
        payload?: { type?: string; platformId?: string; state?: string };
      };
      const event = runtimeMessage.type === "SYNC_PROGRESS" ? runtimeMessage.payload : undefined;
      if (event?.platformId) {
        if (
          event.type === "platform_start" ||
          event.type === "platform_done" ||
          event.type === "platform_error" ||
          event.type === "platform_cancelled"
        ) {
          queuedPlatformIds = queuedPlatformIds.filter(
            (id) => id !== event.platformId,
          );
        }
        if (syncRun) {
          const runningProgress =
            ((syncRun as { platformProgress?: Record<string, string> }).platformProgress ?? {});
          if (event.type === "platform_start") {
            runningProgress[event.platformId] = "running";
          } else if (event.type === "platform_done") {
            runningProgress[event.platformId] = "success";
          } else if (event.type === "platform_error") {
            runningProgress[event.platformId] = event.state ?? "failed_login";
          } else if (event.type === "platform_cancelled") {
            runningProgress[event.platformId] = "cancelled";
          }
          syncRun = { ...syncRun, platformProgress: runningProgress };
        }
      }
      for (const listener of listeners) listener(message);
    }

    function persistState(): void {
      window.localStorage.setItem(
        "p2p-e2e-mock-state",
        JSON.stringify({
          onboardingComplete: storedLocal.p2p_onboarding_complete,
          locked,
          hasMasterPassword,
        }),
      );
    }

    const runtime = {
      getURL: (path: string) => `chrome-extension://p2p-e2e/${path}`,
      getManifest: () => ({ version: "0.12.86" }),
      sendMessage: async (message: RuntimeMessage) => {
        sentMessages.push(message);
        switch (message.type) {
          case "GET_LOCK_STATUS":
            return { locked, hasMasterPassword };
          case "INIT_INVISIBLE_KEY":
            hasMasterPassword = false;
            locked = false;
            persistState();
            return { success: true };
          case "SETUP_INVISIBLE_KEY":
            hasMasterPassword = false;
            locked = false;
            storedLocal.p2p_onboarding_complete = true;
            persistState();
            return { success: true };
          case "SETUP_MASTER_PASSWORD": {
            const payload = message.payload as { password?: string } | undefined;
            if (!payload?.password) {
              return { success: false, error: "Password is required." };
            }
            hasMasterPassword = true;
            locked = false;
            storedLocal.p2p_onboarding_complete = true;
            persistState();
            return { success: true };
          }
          case "UNLOCK": {
            const payload = message.payload as { password?: string } | undefined;
            if (payload?.password === (mockOptions.unlockPassword ?? "correct-password")) {
              locked = false;
              persistState();
              return { success: true };
            }
            return { success: false, error: "Incorrect password" };
          }
          case "LOCK":
            locked = true;
            persistState();
            return { success: true };
          case "GET_METRICS":
            return {
              metrics,
              dataPlatformIds: mockOptions.dataPlatformIds ?? metrics.map((metric) => metric.platformId),
            };
          case "GET_CREDENTIAL_STATUS":
            return { platformIds: platformIds(), credentials };
          case "GET_CREDENTIAL_EDIT_PREFILL": {
            const payload = message.payload as { platformId?: string } | undefined;
            const credential = credentials.find(
              (entry) => entry.platformId === payload?.platformId,
            );
            return { username: credential?.username ?? "" };
          }
          case "SAVE_CREDENTIALS": {
            const payload = message.payload as MockCredential & { platformId: string };
            credentials = [
              ...credentials.filter((credential) => credential.platformId !== payload.platformId),
              {
                ...payload,
                safeModeEnabled: payload.safeModeEnabled ?? payload.safeMode ?? false,
                stealthModeEnabled: payload.stealthModeEnabled ?? payload.stealthMode ?? false,
                active: payload.active ?? true,
              },
            ];
            return { success: true };
          }
          case "DELETE_CREDENTIALS": {
            const payload = message.payload as { platformId?: string } | undefined;
            credentials = credentials.filter((credential) => credential.platformId !== payload?.platformId);
            return { success: true };
          }
          case "TOGGLE_PLATFORM_ACTIVE": {
            const payload = message.payload as { platformId?: string; active?: boolean } | undefined;
            credentials = credentials.map((credential) =>
              credential.platformId === payload?.platformId
                ? { ...credential, active: payload.active }
                : credential,
            );
            return { success: true };
          }
          case "SAVE_SETTINGS": {
            settings = { ...settings, ...((message.payload as Record<string, unknown>) ?? {}) };
            return { success: true, settings };
          }
          case "GET_SETTINGS":
            return { settings };
          case "GET_SYNC_STATUS":
            return { run: syncRun, queuedPlatformIds };
          case "START_SYNC":
            if (syncRun && (syncRun as { state?: string }).state === "running") {
              const payload = message.payload as { platformIds?: string[] } | undefined;
              const requestedIds = payload?.platformIds ?? platformIds();
              const runningProgress =
                ((syncRun as { platformProgress?: Record<string, string> }).platformProgress ?? {});
              for (const id of requestedIds) {
                if (
                  queuedPlatformIds.includes(id) ||
                  runningProgress[id] === "pending" ||
                  runningProgress[id] === "running"
                ) {
                  continue;
                }
                queuedPlatformIds = [...queuedPlatformIds, id];
                runningProgress[id] = "pending";
                emit({
                  type: "SYNC_PROGRESS",
                  payload: {
                    type: "platform_queued",
                    platformId: id,
                    runId: (syncRun as { runId?: string }).runId ?? "e2e",
                    queuePosition: queuedPlatformIds.indexOf(id) + 1,
                  },
                });
              }
              syncRun = { ...syncRun, platformProgress: runningProgress };
              return { success: true, queued: true, queuedPlatformIds };
            } else {
              queueMicrotask(() => {
                const ids = platformIds().length > 0 ? platformIds() : ["mintos"];
                for (const id of ids) {
                  emit({ type: "SYNC_PROGRESS", payload: { type: "platform_start", platformId: id } });
                }
              });
              return { success: true };
            }
          case "START_PLATFORM_SYNC": {
            const payload = message.payload as { platformId?: string } | undefined;
            const platformId = payload?.platformId ?? "mintos";
            queueMicrotask(() =>
              emit({ type: "SYNC_PROGRESS", payload: { type: "platform_start", platformId } }),
            );
            return { success: true };
          }
          case "CANCEL_SYNC_ALL":
            queueMicrotask(() =>
              emit({ type: "SYNC_PROGRESS", payload: { type: "sync_cancelled", platformId: "", runId: "e2e" } }),
            );
            return { success: true };
          case "CANCEL_PLATFORM_SYNC": {
            const payload = message.payload as { platformId?: string } | undefined;
            queueMicrotask(() =>
              emit({
                type: "SYNC_PROGRESS",
                payload: { type: "platform_cancelled", platformId: payload?.platformId ?? "mintos" },
              }),
            );
            return { success: true };
          }
          case "CANCEL_SYNC_PLATFORM": {
            const payload = message.payload as { platformId?: string } | undefined;
            queuedPlatformIds = queuedPlatformIds.filter((id) => id !== payload?.platformId);
            if (syncRun && payload?.platformId) {
              const runningProgress =
                ((syncRun as { platformProgress?: Record<string, string> }).platformProgress ?? {});
              runningProgress[payload.platformId] = "cancelled";
              syncRun = { ...syncRun, platformProgress: runningProgress };
            }
            queueMicrotask(() =>
              emit({
                type: "SYNC_PROGRESS",
                payload: { type: "platform_cancelled", platformId: payload?.platformId ?? "mintos" },
              }),
            );
            return { success: true };
          }
          case "RESOLVE_EXTRACTION_CHOICE":
          case "RESOLVE_MANUAL_ACTION":
            return { success: true };
          case "UPDATE_PLATFORM_MODES": {
            const payload = message.payload as
              | { platformId?: string; config?: { safeModeEnabled?: boolean; stealthModeEnabled?: boolean } }
              | undefined;
            credentials = credentials.map((credential) =>
              credential.platformId === payload?.platformId
                ? {
                    ...credential,
                    safeModeEnabled:
                      payload.config?.safeModeEnabled ?? credential.safeModeEnabled,
                    stealthModeEnabled:
                      payload.config?.stealthModeEnabled ?? credential.stealthModeEnabled,
                  }
                : credential,
            );
            return { success: true };
          }
          case "GET_PLATFORM_BATCH_HISTORY": {
            const payload = message.payload as { platformId?: string } | undefined;
            const platformId = payload?.platformId ?? "mintos";
            const latest = metricsHistory
              .filter((snapshot) => snapshot.platformId === platformId)
              .sort((a, b) => b.date.localeCompare(a.date))[0];
            if (!latest) return { batches: [] };
            return {
              batches: [
                {
                  id: 7,
                  platformId,
                  appliedAt: latest.fetchedAt ?? `${latest.date}T10:00:00.000Z`,
                  sourceKind: "sync",
                  revertible: true,
                  legacyBackfilled: false,
                  cashflowCount: 0,
                  positionCount: 0,
                  riskEventCount: 0,
                  afterDailySnapshot: { ...latest, batchId: 7 },
                },
              ],
            };
          }
          case "REVERT_PLATFORM_BATCH":
            return { success: true };
          case "RESET_PLATFORM_SELECTORS":
            return { success: true };
          case "GET_METRICS_HISTORY": {
            const payload = message.payload as { platformId?: string } | undefined;
            const snapshots = metricsHistory
              .filter((snapshot) => snapshot.platformId === payload?.platformId)
              .sort((a, b) => b.date.localeCompare(a.date));
            return { snapshots };
          }
          case "UPDATE_METRICS_SNAPSHOT": {
            const payload = message.payload as
              | { platformId?: string; date?: string; platformValue?: number; freeCash?: number }
              | undefined;
            metricsHistory = metricsHistory.map((snapshot) =>
              snapshot.platformId === payload?.platformId && snapshot.date === payload?.date
                ? {
                    ...snapshot,
                    platformValue: payload?.platformValue ?? snapshot.platformValue,
                    freeCash: payload?.freeCash ?? snapshot.freeCash,
                    confidence: 1,
                  }
                : snapshot,
            );
            recomputeMetricsFromHistory();
            broadcastMetrics();
            return { success: true };
          }
          case "DELETE_METRICS_SNAPSHOT": {
            const payload = message.payload as { platformId?: string; date?: string } | undefined;
            metricsHistory = metricsHistory.filter(
              (snapshot) =>
                !(snapshot.platformId === payload?.platformId && snapshot.date === payload?.date),
            );
            recomputeMetricsFromHistory();
            broadcastMetrics();
            return { success: true };
          }
          case "GET_GEMINI_STATUS":
            return { status: mockOptions.geminiStatus ?? "unavailable" };
          case "TRIGGER_GEMINI_DOWNLOAD":
            return { status: "downloading" };
          case "GET_EXPORT_DATA":
            return { data: (backup as { payload?: unknown }).payload };
          case "CREATE_FINANCIAL_BACKUP":
            return { backup };
          case "VALIDATE_FINANCIAL_BACKUP": {
            const payload = message.payload as { backup?: { format?: string } } | undefined;
            if (payload?.backup?.format !== "p2p-portfolio-tracker-financial-backup") {
              return { valid: false, error: "Invalid backup format." };
            }
            return { valid: true, backup: payload.backup };
          }
          case "RESTORE_FINANCIAL_BACKUP": {
            const payload = message.payload as { backup?: { payload?: { overviewMetrics?: MockMetric[] } } } | undefined;
            metrics = payload?.backup?.payload?.overviewMetrics ?? [];
            return {
              success: true,
              metrics,
              dataPlatformIds: metrics.map((metric) => metric.platformId),
            };
          }
          case "CLEANUP_STALE_SYNCS":
            return { success: true };
          case "SAVE_MANUAL_METRICS": {
            const payload = message.payload as MockMetric & { platformId: string };
            metrics = [
              ...metrics.filter((metric) => metric.platformId !== payload.platformId),
              {
                ...payload,
                fetchedAt: payload.fetchedAt ?? "2026-06-08T10:00:00.000Z",
                currency: payload.currency ?? "EUR",
                confidence: payload.confidence ?? 1,
              },
            ];
            return { success: true, metrics };
          }
          case "OPEN_DASHBOARD":
            return { success: true };
          default:
            return {};
        }
      },
      onMessage: {
        addListener: (listener: (message: unknown) => void) => {
          listeners.add(listener);
        },
        removeListener: (listener: (message: unknown) => void) => {
          listeners.delete(listener);
        },
      },
    };

    const testWindow = window as unknown as {
      chrome?: unknown;
      __p2pE2e?: {
        sentMessages: RuntimeMessage[];
        downloads: Array<{ text: string; type: string }>;
        emit: (message: unknown) => void;
        getSettings: () => Record<string, unknown>;
        getCredentials: () => MockCredential[];
        getMetrics: () => MockMetric[];
      };
    };

    testWindow.__p2pE2e = {
      sentMessages,
      downloads,
      emit,
      getSettings: () => settings,
      getCredentials: () => credentials,
      getMetrics: () => metrics,
    };
    testWindow.chrome = {
      runtime,
      storage: {
        local: {
          get: async (key?: string | string[] | null) => {
            if (Array.isArray(key)) {
              return Object.fromEntries(key.map((item) => [item, storedLocal[item]]));
            }
            if (typeof key === "string") return { [key]: storedLocal[key] };
            return { ...storedLocal };
          },
          set: async (value: Record<string, unknown>) => {
            Object.assign(storedLocal, value);
            persistState();
          },
        },
      },
    };
    window.confirm = () => true;
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob) {
        void object.text().then((text) => downloads.push({ text, type: object.type }));
      }
      return `blob:p2p-e2e-export-${downloads.length}`;
    };
    URL.revokeObjectURL = () => undefined;
  }, { ...options, defaults: defaultSettings });
}

export async function openMockedDashboard(
  page: Page,
  options?: MockOptions,
): Promise<void> {
  await installDashboardMock(page, options);
  await page.goto("/dashboard.html");
}

export async function openMockedPopup(
  page: Page,
  options?: MockOptions,
): Promise<void> {
  await installDashboardMock(page, options);
  await page.goto("/popup.html");
}

export async function sentMessageTypes(page: Page): Promise<Array<string | undefined>> {
  return page.evaluate(() =>
    ((window as Window & { __p2pE2e?: { sentMessages: RuntimeMessage[] } }).__p2pE2e
      ?.sentMessages ?? []
    ).map((message) => message.type),
  );
}

export async function sentMessages(page: Page): Promise<RuntimeMessage[]> {
  return page.evaluate(() =>
    ((window as Window & { __p2pE2e?: { sentMessages: RuntimeMessage[] } }).__p2pE2e
      ?.sentMessages ?? []
    ),
  );
}

export async function capturedDownloadTexts(page: Page): Promise<string[]> {
  await page.waitForFunction(
    () => ((window as Window & { __p2pE2e?: { downloads: unknown[] } }).__p2pE2e?.downloads ?? []).length > 0,
  );
  return page.evaluate(() =>
    ((window as Window & { __p2pE2e?: { downloads: Array<{ text: string }> } }).__p2pE2e
      ?.downloads ?? []
    ).map((download) => download.text),
  );
}
