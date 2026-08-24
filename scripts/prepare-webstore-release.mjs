import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateExtensionManifest } from "./validate-extension-manifest.mjs";

const repoRoot = process.cwd();
const packagePath = join(repoRoot, "package.json");
const manifestPath = join(repoRoot, "manifest.json");
const distDir = join(repoRoot, "dist");
const releasesDir = join(repoRoot, "releases");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function parseReleaseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(
    version ?? "",
  );
  if (!match) {
    throw new Error(
      `Expected an explicit MAJOR.MINOR.PATCH version, got "${version ?? ""}"`,
    );
  }

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => part > 65_535) || parts.every((part) => part === 0)) {
    throw new Error(`Version "${version}" is not valid for Chrome`);
  }

  return version;
}

export function getReleaseVersionArgument(args) {
  return args[0] === "--" ? args[1] : args[0];
}

export function alignReleaseVersions(packageJson, manifest, version) {
  const releaseVersion = parseReleaseVersion(version);
  return {
    packageJson: { ...packageJson, version: releaseVersion },
    manifest: { ...manifest, version: releaseVersion },
  };
}

export function getReleaseArchiveArgs(archivePath) {
  return ["-qr", archivePath, ".", "-x", ".DS_Store", "*/.DS_Store"];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function getExpectedHosts() {
  const catalog = readJson(
    join(repoRoot, "src", "shared", "platforms", "platform-catalog.json"),
  );
  const hosts = new Set();
  for (const platform of catalog) {
    for (const domain of platform.domains) hosts.add(domain);
    hosts.add(new URL(platform.login.entryUrl).host);
  }
  return [...hosts].map((host) => `https://${host}/*`);
}

function prepareWebstoreRelease(version) {
  const packageJson = readJson(packagePath);
  const manifest = readJson(manifestPath);
  const aligned = alignReleaseVersions(packageJson, manifest, version);

  writeJson(packagePath, aligned.packageJson);
  writeJson(manifestPath, aligned.manifest);

  const expectedHostPermissions = getExpectedHosts();
  validateExtensionManifest(aligned.manifest, {
    rootDir: repoRoot,
    expectedVersion: version,
    expectedHostPermissions,
  });

  run("pnpm", ["build"]);

  validateExtensionManifest(readJson(join(distDir, "manifest.json")), {
    rootDir: distDir,
    expectedVersion: version,
    expectedHostPermissions,
    built: true,
  });

  mkdirSync(releasesDir, { recursive: true });

  const archiveName = `p2p-extension-webstore-v${version}.zip`;
  const archivePath = join(releasesDir, archiveName);

  if (existsSync(archivePath)) {
    unlinkSync(archivePath);
  }

  run("zip", getReleaseArchiveArgs(archivePath), { cwd: distDir });

  console.log(`Prepared Web Store release ${version}: ${archivePath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  prepareWebstoreRelease(getReleaseVersionArgument(process.argv.slice(2)));
}
