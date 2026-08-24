import platformIconAssets from "./platform-icon-assets.json";

export interface ManifestIconCandidate {
  src?: string;
  sizes?: string;
  type?: string;
  purpose?: string;
}

export interface SelectedManifestIcon {
  src: string;
  size: number;
}

const iconAssets = platformIconAssets as Record<string, string>;
const ICON_SIZE_PATTERN = /^(\d+)x(\d+)$/i;

function getLargestDeclaredSize(sizes: string | undefined, type: string | undefined): number {
  if (!sizes) return 0;
  const sizeTokens = sizes.split(/\s+/).filter(Boolean);

  if (
    sizeTokens.some((token) => token.toLowerCase() === "any") &&
    type?.toLowerCase().includes("svg")
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return sizeTokens.reduce((largest, token) => {
    const match = ICON_SIZE_PATTERN.exec(token);
    if (!match) return largest;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return largest;
    return Math.max(largest, Math.min(width, height));
  }, 0);
}

export function selectLargestManifestIcon(
  icons: ManifestIconCandidate[],
): SelectedManifestIcon | null {
  let selected: SelectedManifestIcon | null = null;

  for (const icon of icons) {
    if (!icon.src) continue;
    const size = getLargestDeclaredSize(icon.sizes, icon.type);
    if (size <= 0) continue;

    if (!selected || size > selected.size) {
      selected = { src: icon.src, size };
    }
  }

  return selected;
}

export function getPlatformIconUrl(platformId: string): string | null {
  return iconAssets[platformId] ?? null;
}
