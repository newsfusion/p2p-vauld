import { describe, expect, it } from "vitest";
import {
  getConnectorStrategy,
  isConnectorStrategy,
} from "../../src/shared/platforms/connector-strategies.js";

describe("connector strategy registry", () => {
  it("resolves the universal connector strategy from the registry", () => {
    expect(getConnectorStrategy("universal")).toEqual({
      id: "universal",
      supportsCatalogSelectors: true,
    });
  });

  it("rejects unknown strategy ids", () => {
    expect(isConnectorStrategy("api")).toBe(false);
    expect(() => getConnectorStrategy("api")).toThrow(
      "Unknown connector strategy: api",
    );
  });
});
