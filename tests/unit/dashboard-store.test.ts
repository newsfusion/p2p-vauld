import { beforeEach, describe, expect, it } from "vitest";
import { useDashboardStore } from "../../src/dashboard/store.js";

describe("dashboard store extractor transfer state", () => {
  beforeEach(() => {
    useDashboardStore.setState({
      extractorTransfer: null,
      extractorTransfers: {},
    });
  });

  it("clears keyed extractor transfers when legacy null clear is used", () => {
    useDashboardStore.getState().setExtractorTransfer({
      platformId: "mintos",
      platformName: "Mintos",
      pageType: "login",
      html: "<html><body>Login</body></html>",
      timestamp: "2026-06-17T10:00:00.000Z",
    });

    expect(useDashboardStore.getState().extractorTransfers.login).toBeDefined();

    useDashboardStore.getState().setExtractorTransfer(null);

    expect(useDashboardStore.getState().extractorTransfer).toBeNull();
    expect(useDashboardStore.getState().extractorTransfers).toEqual({});
  });
});
