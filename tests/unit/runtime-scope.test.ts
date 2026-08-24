import { describe, expect, it } from "vitest";
import { createRuntimeScope } from "../../src/shared/runtime-scope.js";

const RUNTIME_NAMES = [
  "p2p_tracker",
  "p2p_keystore",
  "p2p_has_master_password",
  "p2p_session_key_b64",
  "p2p-vauld-theme",
  "p2p_sync_reminder",
] as const;

describe("runtime storage scope", () => {
  it("preserves every production storage name", () => {
    const scope = createRuntimeScope(false);

    expect(RUNTIME_NAMES.map((name) => scope.name(name))).toEqual(RUNTIME_NAMES);
  });

  it("places every demo storage name in a distinct namespace", () => {
    const scope = createRuntimeScope(true);

    expect(RUNTIME_NAMES.map((name) => scope.name(name))).toEqual(
      RUNTIME_NAMES.map((name) => `demo:${name}`),
    );
  });

  it("keeps production and demo values isolated in one storage area", () => {
    const production = createRuntimeScope(false);
    const demo = createRuntimeScope(true);
    const storage = new Map<string, string>();

    storage.set(production.name("p2p_has_master_password"), "production");
    storage.set(demo.name("p2p_has_master_password"), "demo");

    expect(storage.get(production.name("p2p_has_master_password"))).toBe(
      "production",
    );
    expect(storage.get(demo.name("p2p_has_master_password"))).toBe("demo");
  });
});
