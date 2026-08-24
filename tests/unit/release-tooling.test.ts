import { describe, expect, it } from "vitest";
import {
  alignReleaseVersions,
  getReleaseVersionArgument,
  getReleaseArchiveArgs,
  parseReleaseVersion,
} from "../../scripts/prepare-webstore-release.mjs";

describe("Web Store release tooling", () => {
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
