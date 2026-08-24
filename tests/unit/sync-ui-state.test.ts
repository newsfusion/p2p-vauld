import { describe, expect, it } from "vitest";
import { hydrateSyncUiState } from "../../src/shared/sync-ui-state.js";
import type { StoredSyncRun } from "../../src/shared/types/index.js";

describe("hydrateSyncUiState", () => {
  it("returns an idle snapshot when there is no running sync", () => {
    expect(hydrateSyncUiState(undefined, ["mintos"])).toEqual({
      isSyncing: false,
      queuedPlatformIds: [],
      syncStates: {},
      syncSteps: {},
    });
  });

  it("merges running progress with queued platforms", () => {
    const run: StoredSyncRun = {
      runId: "run-queued",
      state: "running",
      startedAt: "2026-06-17T10:00:00.000Z",
      platformProgress: {
        mintos: "running",
        peerberry: "running",
      },
    };

    expect(hydrateSyncUiState(run, ["peerberry", "debitum"])).toEqual({
      isSyncing: true,
      queuedPlatformIds: ["peerberry", "debitum"],
      syncStates: {
        mintos: "running",
        peerberry: "pending",
        debitum: "pending",
      },
      syncSteps: {
        peerberry: "In Queue #1",
        debitum: "In Queue #2",
      },
    });
  });
});
