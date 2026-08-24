export interface FaviconUrlOptions {
  size?: number;
  runtimeGetURL?: (path: string) => string;
}

function getDefaultRuntimeGetURL(): ((path: string) => string) | undefined {
  if (typeof chrome === "undefined") return undefined;
  return chrome.runtime?.getURL?.bind(chrome.runtime);
}

function isValidSize(size: number): boolean {
  return Number.isInteger(size) && size > 0;
}

export function getFaviconUrl(
  pageUrl: string | URL,
  options: FaviconUrlOptions = {},
): string | null {
  const size = options.size ?? 32;
  if (!isValidSize(size)) return null;

  let parsedPageUrl: URL;
  try {
    parsedPageUrl = new URL(pageUrl.toString());
  } catch {
    return null;
  }

  if (parsedPageUrl.protocol !== "https:" && parsedPageUrl.protocol !== "http:") {
    return null;
  }

  const runtimeGetURL = options.runtimeGetURL ?? getDefaultRuntimeGetURL();
  if (!runtimeGetURL) return null;

  const faviconUrl = new URL(runtimeGetURL("/_favicon/"));
  faviconUrl.searchParams.set("pageUrl", parsedPageUrl.toString());
  faviconUrl.searchParams.set("size", String(size));

  return faviconUrl.toString();
}
