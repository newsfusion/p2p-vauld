import { describe, expect, it } from "vitest";
import { isDbProxyRequest } from "../../src/shared/db-messages.js";

describe("db proxy message guards", () => {
  it("accepts DB-prefixed message types", () => {
    expect(isDbProxyRequest({ type: "DB_GET_SETTINGS" })).toBe(true);
    expect(
      isDbProxyRequest({
        type: "DB_CREATE_SYNC_RUN",
        payload: { runId: "run-1", platformIds: ["mintos"] },
      }),
    ).toBe(true);
  });

  it("rejects non-DB messages", () => {
    expect(isDbProxyRequest(null)).toBe(false);
    expect(isDbProxyRequest({})).toBe(false);
    expect(isDbProxyRequest({ type: "START_SYNC" })).toBe(false);
  });
});
