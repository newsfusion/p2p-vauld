import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const metadataPath = path.join(projectRoot, "src/shared/platforms/platform-metadata.json");
const assetMapPath = path.join(projectRoot, "src/shared/platforms/platform-icon-assets.json");
const iconOutputDir = path.join(projectRoot, "public/icons/platforms");
const manifestUrlOverrides = {
  estateguru: "https://beta.estateguru.co/manifest.webmanifest",
};
const requestHeaders = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? "";
  }
  return attributes;
}

function findManifestUrl(html, pageUrl) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const relTokens = (attributes.rel ?? "").toLowerCase().split(/\s+/);
    if (!relTokens.includes("manifest") || !attributes.href) continue;
    return new URL(attributes.href, pageUrl).toString();
  }
  return new URL("/manifest.json", pageUrl).toString();
}

function getLargestDeclaredSize(sizes, type) {
  if (!sizes) return 0;
  const tokens = sizes.split(/\s+/).filter(Boolean);
  if (tokens.some((token) => token.toLowerCase() === "any") && type?.toLowerCase().includes("svg")) {
    return Number.POSITIVE_INFINITY;
  }
  return tokens.reduce((largest, token) => {
    const match = /^(\d+)x(\d+)$/i.exec(token);
    if (!match) return largest;
    return Math.max(largest, Math.min(Number(match[1]), Number(match[2])));
  }, 0);
}

function selectLargestManifestIcon(icons) {
  let selected = null;
  for (const icon of Array.isArray(icons) ? icons : []) {
    if (!icon?.src) continue;
    const size = getLargestDeclaredSize(icon.sizes, icon.type);
    if (size <= 0) continue;
    if (!selected || size > selected.size) selected = { ...icon, size };
  }
  return selected;
}

function selectLargestHtmlIcon(icons) {
  let selected = null;
  for (const icon of icons) {
    if (!icon.href) continue;
    const size = getLargestDeclaredSize(icon.sizes, icon.type) || (icon.rel.includes("apple-touch-icon") ? 180 : 32);
    if (!selected || size > selected.size) selected = { ...icon, src: icon.href, size };
  }
  return selected;
}

function findHtmlIcons(html, pageUrl) {
  const icons = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0]);
    const rel = (attributes.rel ?? "").toLowerCase();
    if (!/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel)) continue;
    if (!attributes.href) continue;
    icons.push({
      rel,
      href: new URL(attributes.href, pageUrl).toString(),
      sizes: attributes.sizes,
      type: attributes.type,
    });
  }
  return icons;
}

function extensionFromData(data) {
  const asciiPrefix = data.subarray(0, 16).toString("ascii");
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (asciiPrefix.startsWith("RIFF") && asciiPrefix.slice(8, 12) === "WEBP") return "webp";
  if (data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x01 && data[3] === 0x00) return "ico";
  if (asciiPrefix.startsWith("BM")) return "bmp";
  if (data.subarray(0, 256).toString("utf8").trimStart().startsWith("<svg")) return "svg";
  return null;
}

function extensionFromUrlOrType(iconUrl, contentType, data) {
  const dataExtension = extensionFromData(data);
  if (dataExtension) return dataExtension;

  const pathname = new URL(iconUrl).pathname.toLowerCase();
  const ext = path.extname(pathname).replace(/^\./, "");
  if (["png", "jpg", "jpeg", "webp", "svg", "ico", "bmp"].includes(ext)) return ext;
  if (contentType.includes("bmp")) return "bmp";
  if (contentType.includes("svg")) return "svg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("x-icon") || contentType.includes("icon")) return "ico";
  return "png";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timeout);
  }
}

async function curlDownload(url) {
  const { stdout } = await execFileAsync(
    "curl",
    ["-L", "--fail", "--max-time", "20", "-sS", "-A", requestHeaders["user-agent"], "-H", "Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8", url],
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
  );
  return Buffer.from(stdout);
}

async function pythonDownload(url) {
  const script = `
import sys
import urllib.request
url = sys.argv[1]
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "image/*,*/*;q=0.8"})
with urllib.request.urlopen(req, timeout=20) as response:
    sys.stdout.buffer.write(response.read())
`;
  const { stdout } = await execFileAsync(
    "python3",
    ["-c", script, url],
    { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 },
  );
  return Buffer.from(stdout);
}

async function fetchIconFromCandidates(icon, bases) {
  const errors = [];
  const candidates = [...new Set(bases.map((base) => new URL(icon.src, base).toString()))];
  for (const iconUrl of candidates) {
    try {
      const response = await fetchWithTimeout(iconUrl, { headers: requestHeaders });
      if (response.ok) {
        return {
          iconUrl,
          contentType: response.headers.get("content-type")?.toLowerCase() ?? "",
          data: Buffer.from(await response.arrayBuffer()),
        };
      }
      errors.push(`${iconUrl} HTTP ${response.status}`);
    } catch (error) {
      errors.push(`${iconUrl} ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      return { iconUrl, contentType: "", data: await curlDownload(iconUrl) };
    } catch (error) {
      errors.push(`${iconUrl} curl ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      return { iconUrl, contentType: "", data: await pythonDownload(iconUrl) };
    } catch (error) {
      errors.push(`${iconUrl} python ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`icon fetch failed: ${errors.join("; ")}`);
}

async function writeDownloadedIcon(entry, icon, iconBases, manifestUrl, source) {
  const { iconUrl, contentType, data } = await fetchIconFromCandidates(icon, iconBases);
  const ext = extensionFromUrlOrType(iconUrl, contentType, data);
  const relativeAssetPath = `/icons/platforms/${entry.id}.${ext}`;
  const outputPath = path.join(iconOutputDir, `${entry.id}.${ext}`);
  await writeFile(outputPath, data);

  return {
    id: entry.id,
    assetPath: relativeAssetPath,
    manifestUrl,
    iconUrl,
    size: icon.size === Number.POSITIVE_INFINITY ? "any" : icon.size,
    source,
  };
}

async function downloadDefaultIcon(entry, siteOrigin, manifestUrl) {
  const defaultIcons = [
    { src: "/favicon/apple-touch-icon.png", size: 180 },
    { src: "/apple-touch-icon.png", size: 180 },
    { src: "/favicon/favicon-32x32.png", size: 32 },
    { src: "/favicon-32x32.png", size: 32 },
    { src: "/favicon.ico", size: 16 },
  ];
  const errors = [];
  for (const icon of defaultIcons) {
    try {
      return await writeDownloadedIcon(entry, icon, [siteOrigin], manifestUrl, "default-favicon");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(errors.at(-1) ?? "default favicon not found");
}

async function downloadPlatformIcon(entry) {
  const siteOrigin = new URL(entry.websiteUrl).origin;
  let pageResponse;
  try {
    pageResponse = await fetchWithTimeout(entry.websiteUrl, { headers: requestHeaders });
  } catch (error) {
    return downloadDefaultIcon(entry, siteOrigin, `${siteOrigin}/manifest.json`);
  }
  if (!pageResponse.ok) {
    return downloadDefaultIcon(entry, siteOrigin, `${siteOrigin}/manifest.json`);
  }
  const pageUrl = pageResponse.url || entry.websiteUrl;
  const html = await pageResponse.text();
  const manifestUrl = manifestUrlOverrides[entry.id] ?? findManifestUrl(html, pageUrl);
  const htmlIcon = selectLargestHtmlIcon(findHtmlIcons(html, pageUrl));
  const defaultIcon = { src: "/favicon.ico", size: 16 };

  let icon = null;
  let source = "html";
  let iconBases = [pageUrl];
  try {
    const manifestResponse = await fetchWithTimeout(manifestUrl, {
      headers: { ...requestHeaders, accept: "application/manifest+json,application/json,*/*" },
    });
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    icon = selectLargestManifestIcon(manifest.icons);
    if (!icon) throw new Error("no usable manifest icon");
    source = "manifest";
    iconBases = [manifestResponse.url || manifestUrl, pageUrl, siteOrigin];
  } catch (error) {
    icon = htmlIcon ?? defaultIcon;
    source = htmlIcon ? "html" : "default-favicon";
    iconBases = [pageUrl, siteOrigin];
  }

  if (!icon) throw new Error("no usable icon");
  try {
    return await writeDownloadedIcon(entry, icon, iconBases, manifestUrl, source);
  } catch (error) {
    if (source === "manifest" && htmlIcon) {
      return writeDownloadedIcon(entry, htmlIcon, [pageUrl, siteOrigin], manifestUrl, "html");
    }
    if (source !== "default-favicon") {
      return downloadDefaultIcon(entry, siteOrigin, manifestUrl);
    }
    throw error;
  }
}

async function main() {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  await mkdir(iconOutputDir, { recursive: true });

  const iconAssets = {};
  const successes = [];
  const failures = [];

  for (const entry of metadata) {
    try {
      const result = await downloadPlatformIcon(entry);
      iconAssets[entry.connectorPlatformId ?? entry.id] = result.assetPath;
      successes.push(result);
      console.log(`✓ ${entry.id} ${result.assetPath} (${result.size}, ${result.source})`);
    } catch (error) {
      failures.push({ id: entry.id, error: error instanceof Error ? error.message : String(error) });
      console.warn(`× ${entry.id}: ${failures.at(-1).error}`);
    }
  }

  await writeFile(assetMapPath, `${JSON.stringify(iconAssets, null, 2)}\n`);
  console.log(`Downloaded ${successes.length}/${metadata.length} manifest icons.`);
  if (failures.length > 0) {
    console.log("Failures:");
    for (const failure of failures) console.log(`- ${failure.id}: ${failure.error}`);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
