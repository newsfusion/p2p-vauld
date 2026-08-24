export const DEMO_LOCAL_MATCH_PATTERNS = [
  "http://localhost/*",
  "http://127.0.0.1/*",
] as const;

type ExtensionManifest = {
  host_permissions?: string[];
  content_scripts?: Array<{
    matches?: string[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

function withoutDemoLocalPatterns(patterns: string[] | undefined): string[] | undefined {
  if (!patterns) return patterns;
  return patterns.filter(
    (pattern) =>
      !DEMO_LOCAL_MATCH_PATTERNS.includes(
        pattern as (typeof DEMO_LOCAL_MATCH_PATTERNS)[number],
      ),
  );
}

export function isDemoManifestModeEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function transformExtensionManifest<T extends ExtensionManifest>(
  manifest: T,
  demoMode: boolean,
): T {
  return {
    ...manifest,
    host_permissions: demoMode
      ? [...DEMO_LOCAL_MATCH_PATTERNS]
      : withoutDemoLocalPatterns(manifest.host_permissions),
    content_scripts: manifest.content_scripts?.map((script) => ({
      ...script,
      matches: demoMode
        ? [...DEMO_LOCAL_MATCH_PATTERNS]
        : withoutDemoLocalPatterns(script.matches),
    })),
  };
}
