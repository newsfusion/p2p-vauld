import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import platformIconAssets from "../../src/shared/platforms/platform-icon-assets.json";
import { getPlatformCatalog } from "../../src/shared/platforms/index.js";
import {
  getPlatformIconUrl,
  selectLargestManifestIcon,
} from "../../src/shared/platforms/manifest-icons.js";

const NEW_EU_PLATFORM_IDS = [
  "goparity",
  "wiwin",
  "bettervest",
  "dagobertinvest",
  "rendity",
] as const;

function detectAssetType(assetPath: string): string {
  const fullPath = join(process.cwd(), "public", assetPath);
  const bytes = readFileSync(fullPath).subarray(0, 256);
  const ascii = bytes.toString("ascii");

  if ([...bytes.subarray(0, 8)].join(",") === "137,80,78,71,13,10,26,10") {
    return "png";
  }
  if ([...bytes.subarray(0, 4)].join(",") === "0,0,1,0") return "ico";
  if ([...bytes.subarray(0, 3)].join(",") === "255,216,255") return "jpg";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "webp";
  if (ascii.trimStart().startsWith("<svg")) return "svg";
  if (ascii.startsWith("BM")) return "bmp";
  if (ascii.trimStart().startsWith("<!DOCTYPE") || ascii.trimStart().startsWith("<html")) {
    return "html";
  }
  return "unknown";
}

function expectAssetMatchesExtension(assetPath: string): void {
  const extension = assetPath.split(".").pop()?.toLowerCase();
  const detectedType = detectAssetType(assetPath);

  expect(detectedType, assetPath).toBe(extension === "jpeg" ? "jpg" : extension);
}

describe("platform manifest icons", () => {
  it("selects the largest concrete manifest icon", () => {
    const icon = selectLargestManifestIcon([
      { src: "/icon-64.png", sizes: "64x64", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "", sizes: "1024x1024", type: "image/png" },
    ]);

    expect(icon).toEqual({ src: "/icon-512.png", size: 512 });
  });

  it("uses SVG any-size icons before smaller raster icons", () => {
    const icon = selectLargestManifestIcon([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ]);

    expect(icon).toEqual({ src: "/icon.svg", size: Number.POSITIVE_INFINITY });
  });

  it("selects maskable icons when they are the highest-resolution manifest icon", () => {
    const icon = selectLargestManifestIcon([
      { src: "/icon-180.png", sizes: "180x180", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ]);

    expect(icon).toEqual({ src: "/icon-512.png", size: 512 });
  });

  it("returns null when no usable manifest icon is available", () => {
    expect(selectLargestManifestIcon([{ src: "", sizes: "512x512" }])).toBeNull();
    expect(selectLargestManifestIcon([])).toBeNull();
  });

  it("points Mintos to a downloaded local icon asset", () => {
    const assetPath = getPlatformIconUrl("mintos");

    expect(assetPath).toMatch(/^\/icons\/platforms\/mintos\.(png|jpg|jpeg|webp|svg|ico)$/);
    expect(existsSync(join(process.cwd(), "public", assetPath as string))).toBe(true);
  });

  it("keeps every mapped platform icon as a non-empty local asset", () => {
    for (const assetPath of Object.values(platformIconAssets)) {
      const fullPath = join(process.cwd(), "public", assetPath);

      expect(existsSync(fullPath), assetPath).toBe(true);
      expect(statSync(fullPath).size, assetPath).toBeGreaterThan(0);
    }
  });

  it("maps local platform icons only by enabled catalog ids", () => {
    const catalogIds = new Set<string>(getPlatformCatalog().map((entry) => entry.id));

    expect(Object.keys(platformIconAssets).filter((id) => !catalogIds.has(id))).toEqual([]);
  });

  it("keeps every mapped platform icon file type aligned with its extension", () => {
    for (const assetPath of Object.values(platformIconAssets)) {
      expectAssetMatchesExtension(assetPath);
    }
  });

  it("points Estateguru to a real PNG icon from its web manifest", () => {
    const assetPath = getPlatformIconUrl("estateguru");

    expect(assetPath).toBe("/icons/platforms/estateguru.png");
    expectAssetMatchesExtension(assetPath as string);
  });

  it("maps the selected EU and DACH platform additions to downloaded local icons", () => {
    for (const platformId of NEW_EU_PLATFORM_IDS) {
      const assetPath = getPlatformIconUrl(platformId);

      expect(assetPath, `${platformId} icon asset`).not.toBeNull();
      expect(assetPath).toMatch(
        new RegExp(`^/icons/platforms/${platformId}\\.(png|jpg|jpeg|webp|svg|ico)$`),
      );
      expect(existsSync(join(process.cwd(), "public", assetPath as string))).toBe(true);
    }
  });

  it("returns null for platforms without a downloaded icon asset", () => {
    expect(getPlatformIconUrl("unknown_platform")).toBeNull();
  });
});
