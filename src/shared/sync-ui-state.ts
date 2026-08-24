import type {
  PlatformId,
  PlatformSyncState,
  StoredSyncRun,
} from "./types/index.js";

export interface SyncUiStateSnapshot {
  isSyncing: boolean;
  queuedPlatformIds: PlatformId[];
  syncStates: Partial<Record<PlatformId, PlatformSyncState>>;
  syncSteps: Partial<Record<PlatformId, string>>;
}

function getQueueStep(platformId: PlatformId, queuedPlatformIds: PlatformId[]): string {
  const index = queuedPlatformIds.indexOf(platformId);
  return index === -1 ? "In Queue" : `In Queue #${index + 1}`;
}

export function hydrateSyncUiState(
  run: StoredSyncRun | undefined,
  queuedPlatformIds: PlatformId[] = [],
): SyncUiStateSnapshot {
  if (!run || run.state !== "running") {
    return {
      isSyncing: false,
      queuedPlatformIds: [],
      syncStates: {},
      syncSteps: {},
    };
  }

  return {
    isSyncing: true,
    queuedPlatformIds,
    syncStates: {
      ...(run.platformProgress ?? {}),
      ...Object.fromEntries(
        queuedPlatformIds.map((platformId) => [platformId, "pending"]),
      ),
    },
    syncSteps: Object.fromEntries(
      queuedPlatformIds.map((platformId) => [
        platformId,
        getQueueStep(platformId, queuedPlatformIds),
      ]),
    ),
  };
}
