import { describe, expect, it } from "vitest";
import type { ConfigEnv, UserConfig } from "vite";
import viteConfig from "../../vite.config.js";

describe("Vite extension configuration", () => {
  it("rejects the CSP-incompatible Vite dev server", () => {
    expect(() =>
      (viteConfig as (env: ConfigEnv) => UserConfig)({
        command: "serve",
        mode: "development",
        isSsrBuild: false,
        isPreview: false,
      }),
    ).toThrow(/pnpm dev/);
  });
});
