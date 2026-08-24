import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("branding assets", () => {
  it("declares the extension favicon on visible HTML entrypoints", () => {
    for (const fileName of ["dashboard.html", "popup.html"]) {
      const html = readFileSync(fileName, "utf8");

      expect(html).toContain('<link rel="icon" type="image/png" href="/icons/icon16.png" />');
    }
  });

  it("keeps only optimized runtime banner assets under public", () => {
    expect(existsSync("public/vauld-banner.png")).toBe(true);
    expect(existsSync("public/vauld-banner-highres.png")).toBe(false);
    expect(existsSync("assets/source/vauld-banner-highres.png")).toBe(true);
  });

  it("fills the extension toolbar icon with visible brand color", () => {
    const topRowBrightestPixel = execFileSync("magick", [
      "public/icons/icon16.png",
      "-background",
      "black",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-crop",
      "16x1+0+0",
      "-format",
      "%[fx:maxima]",
      "info:",
    ], { encoding: "utf8" });
    const bottomRowBrightestPixel = execFileSync("magick", [
      "public/icons/icon16.png",
      "-background",
      "black",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-crop",
      "16x1+0+15",
      "-format",
      "%[fx:maxima]",
      "info:",
    ], { encoding: "utf8" });

    expect(Number(topRowBrightestPixel)).toBeLessThan(0.98);
    expect(Number(bottomRowBrightestPixel)).toBeLessThan(0.98);
  });
});
