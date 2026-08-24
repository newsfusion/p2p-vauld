import { beforeEach, describe, expect, it } from "vitest";
import { useDashboardStore } from "../../src/dashboard/store.js";

describe("dashboard store sync error state", () => {
  beforeEach(() => {
    useDashboardStore.setState({
      syncStates: {},
      syncSteps: {},
      syncErrors: {},
    });
  });

  it("stores and clears per-platform sync errors", () => {
    useDashboardStore.getState().setSyncError("mintos", "Login form fields not found");

    expect(useDashboardStore.getState().syncErrors).toEqual({
      mintos: "Login form fields not found",
    });

    useDashboardStore.getState().clearSyncError("mintos");

    expect(useDashboardStore.getState().syncErrors).toEqual({});
  });

  it("clears sync errors when resetSyncStates runs but keeps them after resetSyncSteps", () => {
    useDashboardStore.getState().setSyncError("mintos", "Login failed");
    useDashboardStore.getState().setSyncState("mintos", "failed_login");

    useDashboardStore.getState().resetSyncSteps();

    expect(useDashboardStore.getState().syncErrors).toEqual({
      mintos: "Login failed",
    });
    expect(useDashboardStore.getState().syncStates).toEqual({
      mintos: "failed_login",
    });

    useDashboardStore.getState().resetSyncStates();

    expect(useDashboardStore.getState().syncErrors).toEqual({});
    expect(useDashboardStore.getState().syncStates).toEqual({});
  });

  it("resets only sync errors with resetSyncErrors", () => {
    useDashboardStore.getState().setSyncError("mintos", "Login failed");
    useDashboardStore.getState().setSyncState("mintos", "failed_login");

    useDashboardStore.getState().resetSyncErrors();

    expect(useDashboardStore.getState().syncErrors).toEqual({});
    expect(useDashboardStore.getState().syncStates).toEqual({
      mintos: "failed_login",
    });
  });
});
