import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  validateExtensionManifest,
  type ExtensionManifest,
} from "../../scripts/validate-extension-manifest.mjs";

function createFixtureRoot(): string {
  const root = join(
    tmpdir(),
    `p2p-manifest-${process.pid}-${Math.random().toString(16).slice(2)}`,
  );
  mkdirSync(join(root, "icons"), { recursive: true });
  mkdirSync(join(root, "src", "background"), { recursive: true });
  mkdirSync(join(root, "src", "content"), { recursive: true });
  for (const file of [
    "icons/icon16.png",
    "src/background/index.js",
    "src/content/index.js",
  ]) {
    writeFileSync(join(root, file), "fixture");
  }
  return root;
}

function validManifest(): ExtensionManifest {
  return {
    manifest_version: 3,
    name: "Fixture",
    version: "1.2.3",
    permissions: ["storage"],
    host_permissions: ["https://example.com/*"],
    background: { service_worker: "src/background/index.js" },
    action: { default_icon: { "16": "icons/icon16.png" } },
    icons: { "16": "icons/icon16.png" },
    content_scripts: [
      {
        matches: ["https://example.com/*"],
        js: ["src/content/index.js"],
      },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self';",
    },
  };
}

describe("extension manifest validation", () => {
  it("accepts a valid production manifest and expected version", () => {
    expect(() =>
      validateExtensionManifest(validManifest(), {
        rootDir: createFixtureRoot(),
        expectedVersion: "1.2.3",
        expectedHostPermissions: ["https://example.com/*"],
      }),
    ).not.toThrow();
  });

  it("rejects MV2, version drift, localhost access, and missing assets", () => {
    const manifest = validManifest();
    manifest.manifest_version = 2;
    manifest.version = "1.2.4";
    manifest.host_permissions = ["http://localhost:4180/*"];
    manifest.icons = { "16": "icons/missing.png" };

    expect(() =>
      validateExtensionManifest(manifest, {
        rootDir: createFixtureRoot(),
        expectedVersion: "1.2.3",
        expectedHostPermissions: ["https://example.com/*"],
      }),
    ).toThrow(/Manifest V3.*version.*localhost.*host permissions.*missing/s);
  });

  it("validates the repository source manifest against the platform catalog", () => {
    const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
    const catalog = JSON.parse(
      readFileSync("src/shared/platforms/platform-catalog.json", "utf8"),
    );
    const expectedHosts = catalog
      .flatMap((platform: { domains: string[]; login: { entryUrl: string } }) => [
        ...platform.domains,
        new URL(platform.login.entryUrl).host,
      ])
      .map((domain: string) => `https://${domain}/*`);

    validateExtensionManifest(manifest, {
      rootDir: process.cwd(),
      expectedHostPermissions: expectedHosts,
    });

    expect(existsSync("manifest.json")).toBe(true);
  });

  it("checks optional pages and web-accessible resources without allowing path escapes", () => {
    const manifest = validManifest();
    manifest.options_ui = { page: "options/missing.html" };
    manifest.side_panel = { default_path: "side-panel/missing.html" };
    manifest.web_accessible_resources = [
      { resources: ["assets/missing.png", "../outside.txt"] },
    ];

    expect(() =>
      validateExtensionManifest(manifest, {
        rootDir: createFixtureRoot(),
        expectedHostPermissions: ["https://example.com/*"],
      }),
    ).toThrow(/options\/missing.*side-panel\/missing.*assets\/missing.*escapes/s);
  });

  it("rejects permissions outside the extension allowlist", () => {
    const manifest = validManifest();
    manifest.permissions = ["storage", "cookies"];
    manifest.optional_permissions = ["management"];

    expect(() =>
      validateExtensionManifest(manifest, {
        rootDir: createFixtureRoot(),
        expectedHostPermissions: ["https://example.com/*"],
      }),
    ).toThrow(/permission.*cookies.*optional permission.*management/s);
  });

  it("rejects unsafe extension CSP and externally connectable pages", () => {
    const manifest = validManifest();
    manifest.content_security_policy = {
      extension_pages:
        "script-src 'self' 'unsafe-eval' https://cdn.example; object-src 'self';",
    };
    manifest.externally_connectable = { matches: ["https://example.com/*"] };

    expect(() =>
      validateExtensionManifest(manifest, {
        rootDir: createFixtureRoot(),
        expectedHostPermissions: ["https://example.com/*"],
      }),
    ).toThrow(/CSP.*externally_connectable/s);
  });

  it("rejects broad web-accessible resources", () => {
    const rootDir = createFixtureRoot();
    mkdirSync(join(rootDir, "assets"), { recursive: true });
    writeFileSync(join(rootDir, "assets", "icon.png"), "fixture");
    const manifest = validManifest();
    manifest.web_accessible_resources = [
      { resources: ["assets/*"], matches: ["<all_urls>"] },
    ];

    expect(() =>
      validateExtensionManifest(manifest, {
        rootDir,
        expectedHostPermissions: ["https://example.com/*"],
      }),
    ).toThrow(/web-accessible resource.*wildcard.*match.*all_urls/s);
  });

  it("rejects wildcard hosts for web-accessible resources", () => {
    const rootDir = createFixtureRoot();
    const manifest = validManifest();
    manifest.web_accessible_resources = [
      { resources: ["icons/icon16.png"], matches: ["https://*/*"] },
    ];

    expect(() =>
      validateExtensionManifest(manifest, {
        rootDir,
        expectedHostPermissions: ["https://example.com/*"],
      }),
    ).toThrow(/web-accessible resource match.*https:\/\/\*\/\*/s);
  });

  it("rejects remote code execution patterns in production bundles", () => {
    const rootDir = createFixtureRoot();
    writeFileSync(
      join(rootDir, "src", "content", "index.js"),
      "const load = () => import('https://cdn.example/remote.js');",
    );

    expect(() =>
      validateExtensionManifest(validManifest(), {
        rootDir,
        expectedHostPermissions: ["https://example.com/*"],
        built: true,
      }),
    ).toThrow(/remote code.*src\/content\/index\.js/s);
  });

  it("rejects unexpected files in production bundles", () => {
    const rootDir = createFixtureRoot();
    writeFileSync(join(rootDir, "debug-capture.html"), "captured page");

    expect(() =>
      validateExtensionManifest(validManifest(), {
        rootDir,
        expectedHostPermissions: ["https://example.com/*"],
        built: true,
      }),
    ).toThrow(/unexpected file.*debug-capture\.html/s);
  });
});
