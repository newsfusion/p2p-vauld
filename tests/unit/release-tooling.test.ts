import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  alignReleaseVersions,
  getReleaseVersionArgument,
  getReleaseArchiveArgs,
  parseReleaseVersion,
} from "../../scripts/prepare-webstore-release.mjs";

describe("Web Store release tooling", () => {
  it("creates a GitHub release for manual Web Store upload without cloud credentials", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toContain("actions/download-artifact");
    expect(workflow).toContain("gh release create");
    expect(workflow).not.toContain("gh release upload");
    expect(workflow).not.toContain("--clobber");
    expect(workflow).not.toContain("google-github-actions/auth");
    expect(workflow).not.toMatch(/GCP_|CHROME_ACCESS_TOKEN|CHROME_PUBLISHER_ID|CHROME_EXTENSION_ID/);
  });

  it("creates a missing release tag from a manually entered version", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");

    expect(workflow).toMatch(/workflow_dispatch:[\s\S]*inputs:[\s\S]*version:/);
    expect(workflow).toContain("MAJOR.MINOR.PATCH version to release from main");
    expect(workflow).toContain('ref="refs/tags/$RELEASE_TAG"');
    expect(workflow).toContain('sha="$RELEASE_SHA"');
    expect(workflow).toContain("repos/$GH_REPO/git/refs");
  });

  it("requires an explicit three-part release version", () => {
    expect(parseReleaseVersion("1.2.0")).toBe("1.2.0");
    expect(() => parseReleaseVersion("v1.2.0")).toThrow(/MAJOR\.MINOR\.PATCH/);
    expect(() => parseReleaseVersion("1.2.0-beta.1")).toThrow(/MAJOR\.MINOR\.PATCH/);
    expect(() => parseReleaseVersion("1.2")).toThrow(/MAJOR\.MINOR\.PATCH/);
    expect(() => parseReleaseVersion("65536.0.0")).toThrow(/Chrome/);
  });

  it("accepts pnpm's preserved argument separator", () => {
    expect(getReleaseVersionArgument(["--", "1.2.0"])).toBe("1.2.0");
    expect(getReleaseVersionArgument(["1.2.0"])).toBe("1.2.0");
  });

  it("aligns package and manifest versions to the explicit release", () => {
    expect(
      alignReleaseVersions(
        { name: "p2p-extension", version: "1.1.0" },
        { manifest_version: 3, version: "1.1.0" },
        "2.0.0",
      ),
    ).toEqual({
      packageJson: { name: "p2p-extension", version: "2.0.0" },
      manifest: { manifest_version: 3, version: "2.0.0" },
    });
  });

  it("excludes macOS metadata from Web Store archives", () => {
    expect(getReleaseArchiveArgs("/tmp/release.zip")).toEqual([
      "-qr",
      "/tmp/release.zip",
      ".",
      "-x",
      ".DS_Store",
      "*/.DS_Store",
    ]);
  });
});
