import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APPROVED_PERMISSIONS = new Set([
  "alarms",
  "favicon",
  "notifications",
  "offscreen",
  "scripting",
  "storage",
  "tabs",
]);

const APPROVED_OPTIONAL_PERMISSIONS = new Set();

const APPROVED_BUILD_FILES = new Set([
  "dashboard.css",
  "dashboard.html",
  "dashboard.js",
  "db.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
  "manifest.json",
  "offscreen.html",
  "offscreen.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "runtime-names.js",
  "src/background/index.js",
  "src/content/index.js",
  "sync-ui-state.js",
  "theme-init.js",
  "vauld-banner-dark.png",
  "vauld-banner.png",
]);

function isApprovedBuildFile(file) {
  return (
    APPROVED_BUILD_FILES.has(file) ||
    /^icons\/platforms\/[a-z0-9_.-]+\.(?:ico|png|svg)$/i.test(file)
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function validateChromeVersion(version) {
  if (typeof version !== "string") return false;
  const parts = version.split(".");
  if (parts.length < 1 || parts.length > 4) return false;
  if (!parts.every((part) => /^(0|[1-9]\d*)$/.test(part))) return false;
  const numbers = parts.map(Number);
  return (
    numbers.some((part) => part !== 0) &&
    numbers.every((part) => part <= 65_535)
  );
}

function isLocalPattern(pattern) {
  return /:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i.test(pattern);
}

function isBroadMatchPattern(pattern) {
  return (
    pattern === "<all_urls>" ||
    /^\*:\/\//.test(pattern) ||
    /^https?:\/\/\*\//i.test(pattern)
  );
}

function hasWildcardPath(path) {
  return /[*?]/.test(path);
}

function hasSelfOnlyCspDirective(csp, directive) {
  const entry = csp
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive);
  return entry?.length === 2 && entry[1] === "'self'";
}

function listFiles(rootDir, prefix = "") {
  const entries = readdirSync(join(rootDir, prefix), { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(rootDir, path) : [path];
  });
}

function referencedFiles(manifest) {
  const files = [];
  if (typeof manifest.background?.service_worker === "string") {
    files.push(manifest.background.service_worker);
  }
  for (const icon of Object.values(manifest.icons ?? {})) {
    if (typeof icon === "string") files.push(icon);
  }
  for (const icon of Object.values(manifest.action?.default_icon ?? {})) {
    if (typeof icon === "string") files.push(icon);
  }
  if (typeof manifest.action?.default_popup === "string") {
    files.push(manifest.action.default_popup);
  }
  for (const script of manifest.content_scripts ?? []) {
    files.push(...(script.js ?? []), ...(script.css ?? []));
  }
  for (const page of [
    manifest.options_page,
    manifest.options_ui?.page,
    manifest.devtools_page,
    manifest.side_panel?.default_path,
  ]) {
    if (typeof page === "string") files.push(page);
  }
  for (const page of Object.values(manifest.chrome_url_overrides ?? {})) {
    if (typeof page === "string") files.push(page);
  }
  files.push(...(manifest.sandbox?.pages ?? []));
  for (const resourceGroup of manifest.web_accessible_resources ?? []) {
    files.push(...(resourceGroup.resources ?? []));
  }
  return [...new Set(files)];
}

export function validateExtensionManifest(manifest, options) {
  const errors = [];
  const rootDir = resolve(options.rootDir);

  if (!isRecord(manifest)) {
    throw new Error("Manifest must be a JSON object");
  }
  if (manifest.manifest_version !== 3) errors.push("Manifest V3 is required");
  if (typeof manifest.name !== "string" || manifest.name.trim() === "") {
    errors.push("Manifest name is required");
  }
  if (!validateChromeVersion(manifest.version)) {
    errors.push("Manifest version is not Chrome-compatible");
  }
  if (options.expectedVersion && manifest.version !== options.expectedVersion) {
    errors.push(
      `Manifest version ${manifest.version ?? "<missing>"} does not match expected version ${options.expectedVersion}`,
    );
  }
  if (!Array.isArray(manifest.permissions)) {
    errors.push("Manifest permissions must be an array");
  } else {
    for (const permission of manifest.permissions) {
      if (!APPROVED_PERMISSIONS.has(permission)) {
        errors.push(`Manifest permission is not approved: ${permission}`);
      }
    }
  }
  for (const permission of manifest.optional_permissions ?? []) {
    if (!APPROVED_OPTIONAL_PERMISSIONS.has(permission)) {
      errors.push(`Manifest optional permission is not approved: ${permission}`);
    }
  }
  if (typeof manifest.background?.service_worker !== "string") {
    errors.push("Manifest background service worker is required");
  }
  if (!isRecord(manifest.icons) || Object.keys(manifest.icons).length === 0) {
    errors.push("Manifest icons are required");
  }
  if (
    !Array.isArray(manifest.content_scripts) ||
    manifest.content_scripts.length === 0
  ) {
    errors.push("Manifest content scripts are required");
  }
  const extensionCsp = manifest.content_security_policy?.extension_pages;
  if (
    typeof extensionCsp !== "string" ||
    !hasSelfOnlyCspDirective(extensionCsp, "script-src") ||
    !hasSelfOnlyCspDirective(extensionCsp, "object-src")
  ) {
    errors.push(
      "Manifest extension CSP must restrict scripts and objects exclusively to self",
    );
  }

  if (manifest.externally_connectable !== undefined) {
    errors.push("Manifest externally_connectable is not approved");
  }

  const hostPermissions = Array.isArray(manifest.host_permissions)
    ? manifest.host_permissions
    : [];
  const contentMatches = Array.isArray(manifest.content_scripts)
    ? manifest.content_scripts.flatMap((script) => script.matches ?? [])
    : [];
  if ([...hostPermissions, ...contentMatches].some(isLocalPattern)) {
    errors.push("Production manifest must not contain localhost permissions");
  }
  if ([...hostPermissions, ...contentMatches].some(isBroadMatchPattern)) {
    errors.push("Production manifest must not contain broad host match patterns");
  }
  if (options.expectedHostPermissions) {
    const expected = uniqueSorted(options.expectedHostPermissions);
    if (
      JSON.stringify(uniqueSorted(hostPermissions)) !== JSON.stringify(expected)
    ) {
      errors.push("Manifest host permissions do not match the enabled platform catalog");
    }
    if (
      JSON.stringify(uniqueSorted(contentMatches)) !== JSON.stringify(expected)
    ) {
      errors.push(
        "Manifest content-script matches do not match the enabled platform catalog",
      );
    }
  }

  for (const resourceGroup of manifest.web_accessible_resources ?? []) {
    for (const resource of resourceGroup.resources ?? []) {
      if (hasWildcardPath(resource)) {
        errors.push(
          `Manifest web-accessible resource contains a wildcard: ${resource}`,
        );
      }
    }
    for (const match of resourceGroup.matches ?? []) {
      if (isBroadMatchPattern(match)) {
        errors.push(`Manifest web-accessible resource match is too broad: ${match}`);
      }
    }
    if ((resourceGroup.extension_ids ?? []).includes("*")) {
      errors.push("Manifest web-accessible resource extension_ids must not contain *");
    }
  }

  for (const file of referencedFiles(manifest)) {
    const resolvedFile = resolve(rootDir, file);
    const relativeFile = relative(rootDir, resolvedFile);
    if (isAbsolute(file) || relativeFile.startsWith("..") || isAbsolute(relativeFile)) {
      errors.push(`Referenced file escapes the extension root: ${file}`);
    } else if (
      !existsSync(resolvedFile) &&
      (options.built || !existsSync(resolve(rootDir, "public", file)))
    ) {
      errors.push(`Referenced file is missing: ${file}`);
    }
  }

  if (options.built) {
    for (const file of listFiles(rootDir)) {
      if (!isApprovedBuildFile(file)) {
        errors.push(`Production build contains unexpected file: ${file}`);
      }
      if (
        file.endsWith(".map") ||
        file.endsWith(".DS_Store") ||
        /(^|[/\\])\.env(?:\.|$)/.test(file) ||
        /(^|[/\\])p2p-testdata([/\\]|$)/.test(file)
      ) {
        errors.push(`Production build contains forbidden file: ${file}`);
      }
      if (/\.(?:html|js|mjs)$/i.test(file)) {
        const contents = readFileSync(join(rootDir, file), "utf8");
        if (
          /\beval\s*\(/.test(contents) ||
          /\bnew\s+Function\s*\(/.test(contents)
        ) {
          errors.push(`Production build contains dynamic code execution: ${file}`);
        }
        if (
          /(?:\bimport\s*\(|\bimportScripts\s*\()\s*["']https?:\/\//i.test(
            contents,
          ) ||
          /<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(contents)
        ) {
          errors.push(`Production build contains remote code reference: ${file}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid extension manifest:\n- ${errors.join("\n- ")}`);
  }
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function runCli() {
  const args = process.argv.slice(2);
  const manifestPath = args[0];
  if (!manifestPath) {
    throw new Error(
      "Usage: validate-extension-manifest.mjs <manifest> [--root dir] [--catalog file] [--expected-version version] [--built]",
    );
  }
  const rootDir = optionValue(args, "--root") ?? dirname(manifestPath);
  const catalogPath = optionValue(args, "--catalog");
  const catalog = catalogPath
    ? JSON.parse(readFileSync(catalogPath, "utf8"))
    : undefined;
  const catalogHosts = new Set();
  for (const platform of catalog ?? []) {
    for (const domain of platform.domains) catalogHosts.add(domain);
    catalogHosts.add(new URL(platform.login.entryUrl).host);
  }
  const expectedHostPermissions = catalog
    ? [...catalogHosts].map((host) => `https://${host}/*`)
    : undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateExtensionManifest(manifest, {
    rootDir,
    expectedVersion: optionValue(args, "--expected-version"),
    expectedHostPermissions,
    built: args.includes("--built"),
  });
  console.log(`Validated extension manifest: ${manifestPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
