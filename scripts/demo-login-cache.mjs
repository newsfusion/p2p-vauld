import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

export const DEMO_LOGIN_CACHE_DIR = path.join(
  repoRoot,
  "tests",
  "fixtures",
  "demo-login-cache",
);

export function parseDemoLoginPageMode(value) {
  return value === "catalog-cache" ? "catalog-cache" : "mock";
}

export function getDemoLoginSnapshotPath(platformId, cacheDir = DEMO_LOGIN_CACHE_DIR) {
  return path.join(cacheDir, `${platformId}.html`);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function removeAttribute(tag, namePattern) {
  return tag.replace(
    new RegExp(`\\s${namePattern}(?:\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, "gi"),
    "",
  );
}

function cleanTagAttributes(tag) {
  return removeAttribute(
    removeAttribute(removeAttribute(tag, "on[a-z0-9_-]+"), "target"), "src(?:set)?",
  );
}

function rewriteForms(html, platformId) {
  let sawForm = false;
  const rewritten = html.replace(/<form\b([^>]*)>/gi, (_match, attrs = "") => {
    sawForm = true;
    let cleanedAttrs = ` ${attrs}`;
    cleanedAttrs = removeAttribute(cleanedAttrs, "action");
    cleanedAttrs = removeAttribute(cleanedAttrs, "method");
    cleanedAttrs = removeAttribute(cleanedAttrs, "target");
    cleanedAttrs = removeAttribute(cleanedAttrs, "on[a-z0-9_-]+").trim();
    const suffix = cleanedAttrs ? ` ${cleanedAttrs}` : "";
    return `<form${suffix} method="POST" action="/demo/${platformId}/authenticated" data-p2p-demo-rewritten="true">`;
  });

  if (sawForm) return rewritten;
  return rewritten.replace(
    /<body\b([^>]*)>/i,
    `<body$1><form method="POST" action="/demo/${platformId}/authenticated" data-p2p-demo-rewritten="true">`,
  ).replace(/<\/body>/i, "</form></body>");
}

export function sanitizeCachedLoginHtml(html, input) {
  const sourceUrl = escapeHtml(input.sourceUrl);
  let output = String(html);

  output = output.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  output = output.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");
  output = output.replace(/<iframe\b[^>]*\/?>/gi, "");
  output = output.replace(/<link\b[^>]*>/gi, "");
  output = output.replace(/<img\b[^>]*>/gi, "");
  output = output.replace(/<picture\b[^>]*>[\s\S]*?<\/picture>/gi, "");
  output = output.replace(/<source\b[^>]*>/gi, "");
  output = output.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, "");
  output = output.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, "");
  output = output.replace(/<([a-z][a-z0-9:-]*)\b[^>]*>/gi, (tag) =>
    cleanTagAttributes(tag),
  );
  output = rewriteForms(output, input.platformId);

  const marker = `<meta name="p2p-demo-login-cache" content="sanitized"><meta name="p2p-demo-login-source" content="${sourceUrl}">`;
  if (/<head\b[^>]*>/i.test(output)) {
    output = output.replace(/<head\b([^>]*)>/i, `<head$1>${marker}`);
  } else {
    output = `<!doctype html><html><head>${marker}</head><body>${output}</body></html>`;
  }

  output = output.replace(
    /<html\b([^>]*)>/i,
    `<html$1 data-p2p-demo-login-cache="sanitized" data-p2p-demo-platform="${escapeHtml(input.platformId)}">`,
  );

  return output;
}

export function renderFallbackCachedLoginPage({
  platformId,
  platformName,
  sourceUrl,
  error = "Cached login snapshot unavailable",
}) {
  return `<!doctype html>
<html lang="en" data-p2p-demo-login-cache="fallback" data-p2p-demo-platform="${escapeHtml(platformId)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="p2p-demo-login-source" content="${escapeHtml(sourceUrl)}" />
    <title>${escapeHtml(platformName)} Login</title>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(platformName)} Login</h1>
      <p data-p2p-demo-cache-error="${escapeHtml(error)}">${escapeHtml(error)}</p>
      <form method="POST" action="/demo/${escapeHtml(platformId)}/authenticated" class="login-form" data-p2p-demo-rewritten="true">
        <label for="login-username">Email</label>
        <input id="login-username" name="email" type="email" autocomplete="username" />
        <label for="login-password">Password</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" />
        <button data-testid="login-button" type="submit">Sign in</button>
      </form>
    </main>
  </body>
</html>`;
}

export function renderCachedLoginPage(platformId, options = {}) {
  const cacheDir = options.cacheDir ?? DEMO_LOGIN_CACHE_DIR;
  const snapshotPath = getDemoLoginSnapshotPath(platformId, cacheDir);
  if (existsSync(snapshotPath)) {
    return readFileSync(snapshotPath, "utf8");
  }

  return renderFallbackCachedLoginPage({
    platformId,
    platformName: options.platformName ?? platformId,
    sourceUrl: options.sourceUrl ?? "",
    error: `Cached login snapshot missing for ${platformId}`,
  });
}
