import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const SYNTHETIC_MARKER = "@p2p-synthetic-fixture";
const HISTORY_BASELINE_PATH = ".sensitive-data-history-baseline";

const TEXT_FILE_PATTERN =
  /\.(?:cjs|css|html|js|json|md|mjs|ts|tsx|txt|yaml|yml)$/i;
const SKIPPED_PATH_PATTERN =
  /^(?:pnpm-lock\.yaml$|(?:dist|node_modules|coverage|playwright-report|test-results|public\/icons|screenshots|docs\/design\/.*\.(?:png|jpg|jpeg|gif|webp))\/)/i;
const STRUCTURED_DATA_PATH_PATTERN = /\.(?:html?|json|txt|yaml|yml)$/i;
const SYNTHETIC_FINANCIAL_PATH_PATTERN = /(?:^|\/)(?:docs|tests)\//i;
const EURO_AMOUNT =
  String.raw`(?:\d{1,3}(?:[.,\s]\d{3})+|\d+)(?:[.,]\d{1,2})?`;

function isPasswordPlaceholder(match) {
  const value = match.startsWith("<")
    ? match.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1]
    : match.match(/[:=]\s*["']([^"']*)["']/i)?.[1];
  return (
    value === undefined ||
    /^(?:\[PASSWORD\]|\*+|•+|\$[a-z0-9]+)$/i.test(value) ||
    /\b(?:password|passwort)\b/i.test(value)
  );
}

const RULES = [
  {
    id: "email-address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    allow: (match) => {
      if (match.toLowerCase() === "privacy@vauld.de") return true;
      const [local = "", domain = ""] = match.toLowerCase().split("@");
      return (
        /^(?:demo|dein|example|name|test|user|you|your)(?:[._+-].*)?$/.test(
          local,
        ) ||
        /^(?:example\.(?:com|org|test)|example\.local|localhost|invalid)$/.test(
          domain,
        )
      );
    },
  },
  {
    id: "iban",
    pattern: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}\b/g,
  },
  {
    id: "password",
    pattern:
      /\b(?:password|passwort|pwd)\b["'\s]*[:=]\s*["'][^"'\r\n]{1,200}["']/gi,
    applies: ({ path }) => STRUCTURED_DATA_PATH_PATTERN.test(path),
    allow: isPasswordPlaceholder,
  },
  {
    id: "password",
    pattern:
      /<input\b(?=[^>]*\btype\s*=\s*["']password["'])(?=[^>]*\bvalue\s*=\s*["'][^"']+["'])[^>]*>/gi,
    applies: ({ path }) => STRUCTURED_DATA_PATH_PATTERN.test(path),
    allow: isPasswordPlaceholder,
  },
  {
    id: "financial-amount",
    pattern: new RegExp(
      `(?:\\b(?:EUR|Euro)\\b\\s*${EURO_AMOUNT}|€\\s*${EURO_AMOUNT}|${EURO_AMOUNT}\\s*(?:\\b(?:EUR|Euro)\\b|€))`,
      "gi",
    ),
    applies: ({ path }) =>
      STRUCTURED_DATA_PATH_PATTERN.test(path) &&
      !SYNTHETIC_FINANCIAL_PATH_PATTERN.test(path),
  },
];

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function shouldScanPath(path) {
  const normalized = normalizePath(path);
  if (SKIPPED_PATH_PATTERN.test(normalized)) return false;
  return TEXT_FILE_PATTERN.test(normalized);
}

function excerptAround(text, index, length) {
  const start = Math.max(0, index - 32);
  const end = Math.min(text.length, index + length + 32);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

export function scanText(input, options = {}) {
  const path = normalizePath(input.path);
  const text = input.text ?? "";
  const syntheticAllowed =
    options.allowSyntheticFixtures === true && text.includes(SYNTHETIC_MARKER);
  const findings = [];

  if (syntheticAllowed) return findings;

  for (const rule of RULES) {
    if (rule.applies && !rule.applies({ path, text })) continue;
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[0] ?? "";
      if (rule.allow?.(value)) continue;
      findings.push({
        ruleId: rule.id,
        path,
        excerpt: excerptAround(text, match.index ?? 0, value.length),
      });
    }
  }

  return findings;
}

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });
}

function gitBlobs(objectIds) {
  const blobs = [];
  const chunkSize = 32;

  for (let index = 0; index < objectIds.length; index += chunkSize) {
    const chunk = objectIds.slice(index, index + chunkSize);
    const output = execFileSync("git", ["cat-file", "--batch"], {
      input: `${chunk.join("\n")}\n`,
      maxBuffer: 1024 * 1024 * 256,
    });
    let offset = 0;

    for (const objectId of chunk) {
      const headerEnd = output.indexOf(10, offset);
      const header = output.subarray(offset, headerEnd).toString("utf8");
      const [, type, sizeText] = header.split(" ");
      const size = Number(sizeText);
      const contentStart = headerEnd + 1;
      const contentEnd = contentStart + size;
      blobs.push(
        type === "blob"
          ? output.subarray(contentStart, contentEnd).toString("utf8")
          : null,
      );
      offset = contentEnd + 1;
    }
  }

  return blobs;
}

function trackedFiles() {
  return git(["ls-files", "-z"])
    .split("\0")
    .filter(Boolean)
    .map(normalizePath);
}

export function scanWorkingTree() {
  const findings = [];
  for (const path of trackedFiles()) {
    if (!shouldScanPath(path)) continue;
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    findings.push(
      ...scanText(
        { path, text },
        { allowSyntheticFixtures: path.startsWith("tests/fixtures/") },
      ),
    );
  }
  return findings;
}

function scanHistoricalTextBlobs() {
  const findings = [];
  const seen = new Set();
  const objects = [];

  const revisionArgs = ["rev-list", "--objects"];
  if (existsSync(HISTORY_BASELINE_PATH)) {
    const baseline = readFileSync(HISTORY_BASELINE_PATH, "utf8").trim();
    if (!/^[0-9a-f]{40}$/.test(baseline)) {
      throw new Error(`${HISTORY_BASELINE_PATH} must contain one full commit SHA`);
    }
    try {
      git(["cat-file", "-e", `${baseline}^{commit}`]);
    } catch {
      throw new Error(
        `${HISTORY_BASELINE_PATH} references a commit that is unavailable`,
      );
    }
    revisionArgs.push("HEAD", `^${baseline}`);
  } else {
    revisionArgs.push("--all");
  }

  for (const line of git(revisionArgs).split("\n")) {
    const separator = line.indexOf(" ");
    if (separator < 0) continue;

    const objectId = line.slice(0, separator);
    const path = normalizePath(line.slice(separator + 1));
    if (!shouldScanPath(path)) continue;
    objects.push({ objectId, path });
  }

  const blobs = gitBlobs(objects.map(({ objectId }) => objectId));
  for (const [index, { path }] of objects.entries()) {
    const text = blobs[index];
    if (text === null) continue;
    const blobFindings = scanText(
      { path, text },
      { allowSyntheticFixtures: path.startsWith("tests/fixtures/") },
    );
    for (const finding of blobFindings) {
      const historyFinding = {
        ...finding,
        ruleId: `history-${finding.ruleId}`,
      };
      const key = `${historyFinding.ruleId}\0${historyFinding.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(historyFinding);
    }
  }

  return findings;
}

export function scanHistory() {
  return scanHistoricalTextBlobs();
}

function printFindings(findings) {
  for (const finding of findings) {
    console.error(
      `[sensitive-data] ${finding.ruleId} ${finding.path}: ${finding.excerpt}`,
    );
  }
}

export function main(argv = process.argv.slice(2)) {
  const includeHistory = argv.includes("--history");
  const findings = [
    ...scanWorkingTree(),
    ...(includeHistory ? scanHistory() : []),
  ];

  if (findings.length > 0) {
    printFindings(findings);
    return 1;
  }

  console.log(
    includeHistory
      ? "Sensitive data scan passed for tracked files and git history."
      : "Sensitive data scan passed for tracked files.",
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
