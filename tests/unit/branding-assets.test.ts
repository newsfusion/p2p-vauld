import { existsSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

function brightestCompositedChannelInRow(
  pixels: Buffer,
  width: number,
  row: number,
): number {
  let brightest = 0;

  for (let column = 0; column < width; column += 1) {
    const offset = (row * width + column) * 4;
    const alpha = (pixels[offset + 3] ?? 0) / 255;
    brightest = Math.max(
      brightest,
      ((pixels[offset] ?? 0) / 255) * alpha,
      ((pixels[offset + 1] ?? 0) / 255) * alpha,
      ((pixels[offset + 2] ?? 0) / 255) * alpha,
    );
  }

  return brightest;
}

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
    const icon = PNG.sync.read(readFileSync("public/icons/icon16.png"));

    expect(icon.width).toBe(16);
    expect(icon.height).toBe(16);
    expect(brightestCompositedChannelInRow(icon.data, icon.width, 0)).toBeLessThan(
      0.98,
    );
    expect(
      brightestCompositedChannelInRow(icon.data, icon.width, icon.height - 1),
    ).toBeLessThan(0.98);
  });
});
